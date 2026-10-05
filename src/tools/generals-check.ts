import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadGeneralPacks } from "../engine/general-pack.js";
import { getPackSkill, SkillModule } from "../engine/skill-module.js";
import { SKILL_RULE_KEY_KINDS } from "../engine/skill-registry.js";
import { SKILL_TRIGGERS, SkillTrigger } from "../engine/types.js";
import { runSelfPlay, SelfPlayViolation } from "./selfplay.js";

/**
 * 独立武将包校验器（计划 M4 / §四 row 16）。
 *
 * 目标：让"只拿 API 文档写武将"的人有一条**不读 `src/`** 也能用的反馈通道——
 * 写完一个包跑 `npm run generals:check -- --dir=<目录>`，就能知道哪里写错了、
 * 哪里"没报错但其实是空的"（loader 会静默忽略的问题）。
 *
 * 两类检查：
 * 1. **权威检查**：直接调用真实 loader（`loadGeneralPacks`），拿到 schema/文件缺失/rules 非法等错误；
 * 2. **静态 lint**：读原始 JSON，抓 loader 会静默吞掉的东西——
 *    未知触发点名（会被 `triggers.filter` 丢掉）、未知顶层字段（拼错 `rule`/`trigers`）、
 *    什么都没干的技能（`kind: "triggered"` 但无 triggers/规则）、尚未被引擎消费的 `kind: "conversion"`……
 * 3. **可选自对弈**：`--selfplay=N` 时对每个成功加载的武将强制指派给全场，跑 N 局不变量断言。
 *
 * 用法：
 *   npm run generals:check                       # 默认校验仓库根的 generals/
 *   npm run generals:check -- --dir=examples/generals
 *   npm run generals:check -- --json             # 机器可读（CI/agent 消费）
 *   npm run generals:check -- --strict           # 警告也视为失败
 *   npm run generals:check -- --selfplay=3       # 每个武将跑 3 局自对弈
 */

const KNOWN_GENERAL_KEYS = ["apiVersion", "name", "kingdom", "gender", "maxHp", "skills", "description"];
const KNOWN_SKILL_KEYS = [
  "id",
  "displayName",
  "kind",
  "description",
  "triggers",
  "optional",
  "priority",
  "requiresTarget",
  "targetIntent",
  "label",
  "rules",
  "canUse",
  "getTargets",
  "play",
  "onTrigger",
];

export type CheckIssueLevel = "error" | "warning";

export type GeneralCheckIssue = {
  level: CheckIssueLevel;
  /** 武将包文件夹名；跨包/全局问题用 `（全局）`。 */
  pack: string;
  message: string;
};

export type GeneralCheckPack = {
  folder: string;
  name?: string;
  kingdom?: string;
  /** 声明在 `general.json` 里的原始技能名（不是命名空间 id）。 */
  skills: string[];
  /** loader 是否成功加载该包。 */
  loaded: boolean;
  skillsLoaded: { id: string; kind: string; displayName: string }[];
};

export type GeneralCheckSelfPlay = {
  general: string;
  games: number;
  finished: number;
  violations: SelfPlayViolation[];
};

export type GeneralCheckReport = {
  dir: string;
  /** 扫描到的包数量（含加载失败的）。 */
  scanned: number;
  packs: GeneralCheckPack[];
  issues: GeneralCheckIssue[];
  errors: number;
  warnings: number;
  selfplay: GeneralCheckSelfPlay[];
};

export type GeneralCheckOptions = {
  /** 武将包根目录，默认 `generals`。 */
  dir?: string;
  /** 每个武将跑几局自对弈（0 = 不跑）。 */
  selfplayGames?: number;
  seed?: number;
  playerCount?: number;
  /** 只允许声明式 JSON 技能（等价于 `--generals-json-only`）。 */
  jsonOnly?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readJson = (path: string): { value?: unknown; error?: string } => {
  try {
    return { value: JSON.parse(readFileSync(path, "utf-8")) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

/** 静态 lint：一个武将包目录（loader 的失败项由 loader 自己报告，这里只补"静默忽略"的部分）。 */
const lintPack = (dir: string, folder: string, push: (level: CheckIssueLevel, message: string) => void): GeneralCheckPack => {
  const skills: string[] = [];
  const generalPath = join(dir, folder, "general.json");
  const parsed = readJson(generalPath);
  if (!isRecord(parsed.value)) {
    // general.json 本身解析失败/不是对象：loader 已报错，这里只留骨架。
    return { folder, skills, loaded: false, skillsLoaded: [] };
  }
  const general = parsed.value;
  const name = typeof general.name === "string" ? general.name : undefined;
  const declared = Array.isArray(general.skills) ? general.skills.filter((item): item is string => typeof item === "string") : [];

  for (const key of Object.keys(general)) {
    if (!KNOWN_GENERAL_KEYS.includes(key)) {
      push("warning", `general.json 的字段 "${key}" 不是已知字段（允许：${KNOWN_GENERAL_KEYS.join("/")}），会被 loader 忽略`);
    }
  }
  if (name !== undefined && name !== folder) {
    push("warning", `general.json 的 name（${name}）与文件夹名（${folder}）不一致：技能 id 以文件夹名为命名空间前缀`);
  }
  const duplicates = declared.filter((item, index) => declared.indexOf(item) !== index);
  for (const item of new Set(duplicates)) {
    push("error", `general.json 的 skills 里 "${item}" 重复声明`);
  }

  for (const skill of new Set(declared)) {
    skills.push(skill);
    const base = join(dir, folder, skill);
    const hasJson = existsSync(`${base}.skill.json`);
    const hasTs = existsSync(`${base}.skill.ts`);
    const hasMjs = existsSync(`${base}.skill.mjs`);
    if (hasJson && (hasTs || hasMjs)) {
      push("error", `${skill}：同时存在 .skill.json 与 .skill.{ts,mjs}，双源真相（loader 只用 JSON），请删掉一个`);
    }
    if (!hasJson) {
      continue;
    }
    const skillParsed = readJson(`${base}.skill.json`);
    if (!isRecord(skillParsed.value)) {
      push("error", `${skill}.skill.json 不是合法 JSON：${skillParsed.error ?? "内容不是对象"}`);
      continue;
    }
    lintDeclarativeSkill(skillParsed.value, skill, push);
  }

  return {
    folder,
    ...(name !== undefined ? { name } : {}),
    ...(typeof general.kingdom === "string" ? { kingdom: general.kingdom } : {}),
    skills,
    loaded: false,
    skillsLoaded: [],
  };
};

/** 静态 lint：一个 `.skill.json`。 */
const lintDeclarativeSkill = (
  skill: Record<string, unknown>,
  skillName: string,
  push: (level: CheckIssueLevel, message: string) => void,
): void => {
  for (const key of Object.keys(skill)) {
    if (!KNOWN_SKILL_KEYS.includes(key)) {
      push("warning", `${skillName}.skill.json 的字段 "${key}" 不是已知字段（允许：${KNOWN_SKILL_KEYS.join("/")}），会被 loader 忽略`);
    }
  }
  if (typeof skill.id === "string" && skill.id !== skillName) {
    push("warning", `${skillName}.skill.json 的 id（${skill.id}）与文件名不一致：引擎只用命名空间 id，id 会被忽略`);
  }
  if (typeof skill.displayName !== "string") {
    push("warning", `${skillName}：未声明 displayName，UI/AI 会直接显示"${skillName}"`);
  }
  if (typeof skill.description === "string" && skill.description.length > 160) {
    push("warning", `${skillName}：description 长 ${skill.description.length} 字，会整段进 AI 上下文，建议压到 160 字以内`);
  }
  if (typeof skill.kind !== "string") {
    return;
  }
  if (skill.kind === "conversion") {
    push(
      "warning",
      `${skillName}：kind = "conversion"（当牌转换）目前不会被引擎枚举为可玩动作，写了也不会生效（已知缺口，优先待补）`,
    );
  }
  const rawTriggers = Array.isArray(skill.triggers) ? skill.triggers : undefined;
  if (rawTriggers) {
    for (const trigger of rawTriggers) {
      if (typeof trigger !== "string" || !SKILL_TRIGGERS.includes(trigger as SkillTrigger)) {
        push(
          "error",
          `${skillName}：触发点 "${String(trigger)}" 不存在，loader 会静默丢弃它（允许：${SKILL_TRIGGERS.join("/")}）`,
        );
      }
    }
  }
  const hasRules = isRecord(skill.rules) && Object.keys(skill.rules).length > 0;
  const triggerCount = rawTriggers?.length ?? 0;
  if (skill.kind === "triggered" && triggerCount === 0) {
    push("warning", `${skillName}：kind = "triggered" 但没有 triggers，钩子不会被调用（声明式技能也没有代码可挂）`);
  }
  if (triggerCount === 0 && !hasRules) {
    push("warning", `${skillName}：既没有 triggers 也没有 rules，这个技能不会有任何效果`);
  }
  if (skill.targetIntent !== undefined && skill.kind !== "active") {
    push(
      "warning",
      `${skillName}：targetIntent 只影响主动技能（kind = "active"）的 AI 选目标，当前 kind = "${skill.kind}" 下不会生效`,
    );
  }
  if (skill.kind === "active" && skill.requiresTarget !== true) {
    push(
      "warning",
      `${skillName}：主动技能但没有 requiresTarget: true；需要指定目标的技能必须显式声明（否则 AI/UI 不会给目标，play 拿不到 targetId）`,
    );
  }
  if (isRecord(skill.rules)) {
    for (const key of Object.keys(skill.rules)) {
      if (!Object.prototype.hasOwnProperty.call(SKILL_RULE_KEY_KINDS, key)) {
        push("error", `${skillName}：rules.${key} 不是已知规则（允许：${Object.keys(SKILL_RULE_KEY_KINDS).join("/")}）`);
      }
    }
  }
};

/** 模块级 lint：loader 解析出来的 `SkillModule`（能查 `onTrigger` 这种只有导入后才看得到的字段）。 */
const lintLoadedSkill = (
  module: SkillModule,
  skillName: string,
  push: (level: CheckIssueLevel, message: string) => void,
): void => {
  const hooks = module.onTrigger;
  if (hooks) {
    for (const key of Object.keys(hooks)) {
      if (!SKILL_TRIGGERS.includes(key as SkillTrigger)) {
        push("error", `${skillName}：onTrigger 的键 "${key}" 不是已知触发点，该钩子永远不会被调用`);
      }
    }
  }
  const hasRules = module.rules !== undefined && Object.keys(module.rules).length > 0;
  const hasBehavior = Boolean(hooks) || hasRules;
  if (module.kind === "active" && typeof module.play !== "function") {
    push(
      hasBehavior ? "warning" : "error",
      `${skillName}：kind = "active" 但没有 play()，出牌阶段发动它不会有任何事发生`,
    );
  }
  if (module.kind === "passive" && !hasBehavior) {
    push("warning", `${skillName}：kind = "passive" 但既没有 rules 也没有 onTrigger，没有任何效果`);
  }
  if (module.kind === "lord" && !hasBehavior) {
    push("warning", `${skillName}：kind = "lord" 但既没有 rules 也没有 onTrigger，没有任何效果`);
  }
};

/** 扫描包目录（与 loader 同口径：含 `general.json` 的子目录）。 */
const listPackFolders = (dir: string): string[] => {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return [];
  }
  return readdirSync(dir).filter((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() && existsSync(join(full, "general.json"));
  });
};

const describeSkill = (module: SkillModule): { id: string; kind: string; displayName: string } => ({
  id: module.id,
  kind: module.kind,
  displayName: module.displayName ?? module.id,
});

export async function checkGeneralPacks(options: GeneralCheckOptions = {}): Promise<GeneralCheckReport> {
  const dir = resolve(process.cwd(), options.dir ?? "generals");
  const issues: GeneralCheckIssue[] = [];
  const packs: GeneralCheckPack[] = [];
  const selfplay: GeneralCheckSelfPlay[] = [];

  const push = (pack: string, level: CheckIssueLevel, message: string): void => {
    issues.push({ level, pack, message });
  };

  const folders = listPackFolders(dir);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    push("（全局）", "error", `目录不存在或不是目录：${dir}`);
  }

  // 1) 权威检查：真实 loader（会同时完成"能否进游戏"的判定与技能注册）。
  const loadReport = await loadGeneralPacks({ dir, pool: "all", jsonOnly: options.jsonOnly ?? false });
  for (const error of loadReport.errors) {
    push(error.pack, "error", `加载失败：${error.message}`);
  }

  // 2) 静态 lint（每个扫描到的包都跑，包括加载失败的）。
  for (const folder of folders) {
    const pack = lintPack(dir, folder, (level, message) => push(folder, level, message));
    pack.loaded = loadReport.loaded.includes(pack.name ?? "") || loadReport.loaded.includes(folder);
    for (const skillName of pack.skills) {
      const module = getPackSkill(`${folder}/${skillName}`);
      if (!module) {
        continue;
      }
      pack.skillsLoaded.push(describeSkill(module));
      lintLoadedSkill(module, skillName, (level, message) => push(folder, level, message));
    }
    packs.push(pack);
  }

  // 3) 可选自对弈：每个成功加载的包各跑 N 局（强制把该武将指派给全场，保证技能一定被走到）。
  const games = options.selfplayGames ?? 0;
  if (games > 0) {
    for (const pack of packs) {
      if (!pack.loaded || pack.name === undefined) {
        continue;
      }
      const report = await runSelfPlay({
        games,
        seed: options.seed ?? 20240101,
        playerCount: options.playerCount ?? 4,
        forceGeneral: pack.name,
      });
      selfplay.push({ general: pack.name, games, finished: report.finished, violations: report.violations });
      for (const violation of report.violations) {
        push(pack.folder, "error", `自对弈违规（${violation.rule}，seed=${violation.seed}，第 ${violation.turn} 回合）：${violation.message.split("\n")[0] ?? ""}`);
      }
    }
  }

  return {
    dir,
    scanned: folders.length,
    packs,
    issues,
    errors: issues.filter((issue) => issue.level === "error").length,
    warnings: issues.filter((issue) => issue.level === "warning").length,
    selfplay,
  };
}

const renderText = (report: GeneralCheckReport, strict: boolean): void => {
  console.log(`[generals-check] 目录：${report.dir}`);
  if (report.scanned === 0) {
    console.log("[generals-check] 未扫描到任何武将包（子目录里要有 general.json）");
  }
  for (const pack of report.packs) {
    const meta = [pack.kingdom, `技能 ${pack.skills.length}`].filter(Boolean).join(" / ");
    const mark = pack.loaded ? "✔" : "✖";
    console.log(`${mark} ${pack.folder}${pack.name && pack.name !== pack.folder ? `（${pack.name}）` : ""}：${meta}`);
    if (pack.skillsLoaded.length > 0) {
      console.log(`    ${pack.skillsLoaded.map((skill) => `${skill.displayName}[${skill.kind}]`).join("、")}`);
    }
  }
  const byPack = new Map<string, GeneralCheckIssue[]>();
  for (const issue of report.issues) {
    byPack.set(issue.pack, [...(byPack.get(issue.pack) ?? []), issue]);
  }
  for (const [pack, list] of byPack) {
    console.log(`\n${pack}`);
    for (const issue of list) {
      console.log(`  ${issue.level === "error" ? "✖" : "⚠"} ${issue.message}`);
    }
  }
  for (const run of report.selfplay) {
    console.log(`[selfplay] ${run.general}：${run.games} 局，分出胜负 ${run.finished} 局，违规 ${run.violations.length} 条`);
  }
  console.log(
    `\n[generals-check] ${report.scanned} 个包：${report.errors} 个错误 / ${report.warnings} 个警告` +
      (strict ? "（--strict：警告也视为失败）" : ""),
  );
};

const parseArgs = (argv: string[]): { options: GeneralCheckOptions; json: boolean; strict: boolean } => {
  const options: GeneralCheckOptions = {};
  let json = false;
  let strict = false;
  for (const arg of argv) {
    const [key, value] = arg.split("=", 2);
    switch (key) {
      case "--json":
        json = true;
        break;
      case "--strict":
        strict = true;
        break;
      case "--json-only":
        options.jsonOnly = true;
        break;
      case "--dir":
        if (value !== undefined) {
          options.dir = value;
        }
        break;
      case "--selfplay":
        options.selfplayGames = Number.parseInt(value ?? "1", 10);
        break;
      case "--seed":
        if (value !== undefined) {
          options.seed = Number.parseInt(value, 10);
        }
        break;
      case "--players":
        if (value !== undefined) {
          options.playerCount = Number.parseInt(value, 10);
        }
        break;
      default:
        if (key?.startsWith("--")) {
          console.error(`[generals-check] 未知参数：${arg}`);
          process.exitCode = 2;
        }
    }
  }
  return { options, json, strict };
};

const main = async (): Promise<void> => {
  const { options, json, strict } = parseArgs(process.argv.slice(2));
  if (process.exitCode === 2) {
    return;
  }
  const report = await checkGeneralPacks(options);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    renderText(report, strict);
  }
  const failed = report.errors > 0 || (strict && report.warnings > 0);
  if (failed) {
    process.exitCode = 1;
  }
};

// 仅在被当作脚本执行时跑 main（被测试 import 时不产生副作用）。
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMainModule) {
  await main();
}
