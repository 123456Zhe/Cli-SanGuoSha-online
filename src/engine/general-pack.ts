import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CardColor, CardSuit, CardType } from "./cards.js";
import { isSlashCard, responseKindToCardType } from "./card-utils.js";
import { getBuiltinGenerals, resetLoadedGenerals, setLoadedGenerals } from "./generals.js";
import {
  CONVERSION_RESPONSE_KINDS,
  CONVERTIBLE_CARD_TYPES,
  SKILL_TARGET_INTENTS,
  SkillConversion,
  SkillKind,
  SkillRules,
  SkillTargetIntent,
  TargetImmunityCard,
} from "./skill-registry.js";
import { registerPackSkill, resetPackSkills, PackSkillEntry, SkillModule } from "./skill-module.js";
import { GeneralDefinition, SKILL_TRIGGERS, SkillId, SkillTrigger } from "./types.js";
import { ResponseKind } from "./interaction.js";

/**
 * 外部武将包 loader（Phase 2）。
 *
 * 目录结构（相对 `dir`，默认项目根的 `generals/`）：
 *   generals/吕蒙/general.json
 *   generals/吕蒙/克己.skill.json
 *   generals/吕蒙/涉猎.skill.ts        （或 .skill.mjs）
 *
 * 规则：
 * - 技能身份 = `<文件夹名>/<技能名>`（命名空间 id），快照/协议里存命名空间 id，展示用 displayName。
 * - 每包 try/catch 隔离：坏包只记录错误，不影响其他包；`strict` 时末尾抛错。
 * - `.ts` 技能依赖 bun/tsx 运行时（dev），跨环境分发用 `.mjs`；`jsonOnly` 时拒绝代码技能。
 */

export type GeneralPackLoadOptions = {
  /** 武将包根目录，默认 `generals`（相对 process.cwd()）。 */
  dir?: string;
  /** `all`（默认）合并外部包；`builtin` 只保留内置池并清空外部技能。 */
  pool?: "all" | "builtin";
  /** 只允许声明式 JSON 技能，遇到 .ts/.mjs 报错。 */
  jsonOnly?: boolean;
  /** 有任一包加载失败时抛错（CI / 主机严格模式）。 */
  strict?: boolean;
  log?: (line: string) => void;
};

export type GeneralPackLoadReport = {
  loaded: string[];
  errors: { pack: string; message: string }[];
};

/** `kind` 允许值；`schema/skill.schema.json` 与校验器读同一份（防漂移测试见 `src/tools/pack-schema.test.ts`）。 */
export const SKILL_KINDS: SkillKind[] = ["active", "triggered", "conversion", "passive", "lord"];
/** `rules.targetImmunity.cards` 允许值（同上，schema 的单一真相）。 */
export const TARGET_IMMUNITY_CARDS: TargetImmunityCard[] = ["slash", "duel", "snatch", "indulgence", "supplies-cut"];
/** `conversion.from.suit` 允许的花色（`none` 是无花色的技术值，不作为筛选条件）；schema 的单一真相。 */
export const CONVERSION_SUITS: CardSuit[] = ["heart", "diamond", "club", "spade"];

const isString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** 校验可选的 targetIntent（AI 选目标取向）。缺省合法，非法值即抛错。 */
const parseTargetIntent = (raw: unknown, label: string): SkillTargetIntent | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "string" || !SKILL_TARGET_INTENTS.includes(raw as SkillTargetIntent)) {
    throw new Error(`${label} 的 targetIntent 非法（允许：${SKILL_TARGET_INTENTS.join("/")}）`);
  }
  return raw as SkillTargetIntent;
};

/** 校验声明式 rules：键名必须在词汇表内、类型正确；未知键/类型不符即抛错。 */
const validateRules = (raw: unknown, label: string): SkillRules => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${label} 的 rules 必须是对象`);
  }
  const obj = raw as Record<string, unknown>;
  const rules: SkillRules = {};
  for (const [key, value] of Object.entries(obj)) {
    switch (key) {
      case "distanceDelta":
      case "responseMultiplier":
      case "drawPhaseDelta":
      case "damageDelta":
      case "peachSaveBonus":
      case "handLimitDelta": {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new Error(`${label} 的 rules.${key} 必须是数字`);
        }
        rules[key] = value;
        break;
      }
      case "trickDistanceExempt":
      case "slashLimitExempt":
      case "skipDiscardPhaseIfNoSlash": {
        if (typeof value !== "boolean") {
          throw new Error(`${label} 的 rules.${key} 必须是布尔`);
        }
        rules[key] = value;
        break;
      }
      case "targetImmunity": {
        if (typeof value !== "object" || value === null) {
          throw new Error(`${label} 的 rules.targetImmunity 必须是对象`);
        }
        const immunity = value as Record<string, unknown>;
        if (
          !Array.isArray(immunity.cards) ||
          immunity.cards.length === 0 ||
          immunity.cards.some((card) => !TARGET_IMMUNITY_CARDS.includes(card as TargetImmunityCard))
        ) {
          throw new Error(`${label} 的 rules.targetImmunity.cards 非法（允许：${TARGET_IMMUNITY_CARDS.join("/")}）`);
        }
        if ("requireEmptyHand" in immunity && typeof immunity.requireEmptyHand !== "boolean") {
          throw new Error(`${label} 的 rules.targetImmunity.requireEmptyHand 必须是布尔`);
        }
        rules.targetImmunity = {
          cards: immunity.cards as TargetImmunityCard[],
          ...("requireEmptyHand" in immunity ? { requireEmptyHand: immunity.requireEmptyHand as boolean } : {}),
        };
        break;
      }
      default:
        throw new Error(`${label} 的 rules.${key} 不是已知字段`);
    }
  }
  return rules;
};

/** 校验当牌转换数组（`conversions`）：每条单独校验。 */
const parseConversions = (raw: unknown, label: string): SkillConversion[] => {
  const list = Array.isArray(raw) ? raw : [raw];
  if (list.length === 0) {
    throw new Error(`${label} 的 conversions 不能是空数组`);
  }
  return list.map((item, index) => parseConversion(item, list.length > 1 ? `${label} 的 conversions[${index}]` : `${label} 的 conversions`));
};

/** 校验当牌转换（`conversions.to` 必须是引擎能结算的牌类；`from` 条件与 `asResponse` 值都要合法）。 */
const parseConversion = (raw: unknown, label: string): SkillConversion => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${label} 必须是对象`);
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.to !== "string" || !CONVERTIBLE_CARD_TYPES.includes(obj.to as CardType)) {
    throw new Error(
      `${label} 的 to 非法（允许：${CONVERTIBLE_CARD_TYPES.join("/")}；` +
        `其他牌类需要目标/距离/判定区逻辑，暂不支持）`,
    );
  }
  if (typeof obj.from !== "object" || obj.from === null || Array.isArray(obj.from)) {
    throw new Error(`${label} 的 from 必须是对象`);
  }
  const from = obj.from as Record<string, unknown>;
  const filter: SkillConversion["from"] = {};
  for (const key of Object.keys(from)) {
    if (key !== "suit" && key !== "color" && key !== "type") {
      throw new Error(`${label} 的 from.${key} 不是已知字段（允许：suit/color/type）`);
    }
  }
  if (from.suit !== undefined) {
    if (
      !Array.isArray(from.suit) ||
      from.suit.length === 0 ||
      from.suit.some((suit) => !CONVERSION_SUITS.includes(suit as CardSuit))
    ) {
      throw new Error(`${label} 的 from.suit 非法（允许：${CONVERSION_SUITS.join("/")}）`);
    }
    filter.suit = from.suit as CardSuit[];
  }
  if (from.color !== undefined) {
    if (!Array.isArray(from.color) || from.color.length === 0 || from.color.some((color) => color !== "red" && color !== "black")) {
      throw new Error(`${label} 的 from.color 非法（允许：red/black）`);
    }
    filter.color = from.color as CardColor[];
  }
  if (from.type !== undefined) {
    if (
      !Array.isArray(from.type) ||
      from.type.length === 0 ||
      from.type.some((type) => !Object.values(CardType).includes(type as CardType))
    ) {
      throw new Error(`${label} 的 from.type 含有未知牌类`);
    }
    filter.type = from.type as CardType[];
  }
  if (filter.suit === undefined && filter.color === undefined && filter.type === undefined) {
    throw new Error(`${label} 的 from 至少要给 suit/color/type 之一（否则任何牌都能变，几乎肯定是写错了）`);
  }
  let asResponse: ResponseKind[] | undefined;
  if (obj.asResponse !== undefined) {
    if (
      !Array.isArray(obj.asResponse) ||
      obj.asResponse.length === 0 ||
      obj.asResponse.some((kind) => !CONVERSION_RESPONSE_KINDS.includes(kind as ResponseKind))
    ) {
      throw new Error(`${label} 的 asResponse 非法（允许：${CONVERSION_RESPONSE_KINDS.join("/")}）`);
    }
    asResponse = obj.asResponse as ResponseKind[];
    const to = obj.to as CardType;
    // asResponse 里的时机必须与 to 对得上：闪↔dodge、无懈↔negate、桃↔peach；杀↔slash 允许杀/火杀/雷杀。
    for (const kind of asResponse) {
      const ok = kind === "slash" ? isSlashCard(to) : responseKindToCardType(kind) === to;
      if (!ok) {
        throw new Error(`${label} 的 asResponse 含 ${kind}，但 to 是 ${obj.to}，对不上`);
      }
    }
  }
  return {
    from: filter,
    to: obj.to as CardType,
    ...(asResponse ? { asResponse } : {}),
  };
};

const validateGeneralJson = (raw: unknown, packName: string): Omit<GeneralDefinition, "skills"> & { skills: string[] } => {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("general.json 不是对象");
  }
  const obj = raw as Record<string, unknown>;
  if (obj.apiVersion !== 1) {
    throw new Error(`general.json apiVersion 必须为 1（收到 ${String(obj.apiVersion)}）`);
  }
  if (!isString(obj.name)) {
    throw new Error("general.json 缺少 name");
  }
  if (!isString(obj.kingdom)) {
    throw new Error(`${packName}: general.json 缺少 kingdom`);
  }
  if (obj.gender !== "男" && obj.gender !== "女") {
    throw new Error(`${packName}: general.json gender 必须为 男/女`);
  }
  if (typeof obj.maxHp !== "number" || !Number.isInteger(obj.maxHp) || obj.maxHp < 1) {
    throw new Error(`${packName}: general.json maxHp 必须为正整数`);
  }
  if (!Array.isArray(obj.skills) || obj.skills.some((skill) => !isString(skill))) {
    throw new Error(`${packName}: general.json skills 必须为字符串数组`);
  }
  if ("description" in obj && typeof obj.description !== "string") {
    throw new Error(`${packName}: general.json description 必须为字符串`);
  }
  return {
    kingdom: obj.kingdom,
    name: obj.name,
    gender: obj.gender,
    maxHp: obj.maxHp,
    skills: obj.skills as string[],
    ...(typeof obj.description === "string" ? { description: obj.description } : {}),
  };
};

const parseDeclarativeSkill = (raw: unknown, fallbackId: string, namespacedId: string): SkillModule => {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`${fallbackId}.skill.json 不是对象`);
  }
  const obj = raw as Record<string, unknown>;
  if (!isString(obj.kind) || !SKILL_KINDS.includes(obj.kind as SkillKind)) {
    throw new Error(`${fallbackId}.skill.json kind 非法`);
  }
  if (!isString(obj.description)) {
    throw new Error(`${fallbackId}.skill.json 缺少 description`);
  }
  const triggers = Array.isArray(obj.triggers)
    ? obj.triggers.filter((item): item is SkillTrigger => SKILL_TRIGGERS.includes(item as SkillTrigger))
    : undefined;
  const targetIntent = parseTargetIntent(obj.targetIntent, `${fallbackId}.skill.json`);
  return {
    id: namespacedId,
    displayName: isString(obj.displayName) ? obj.displayName : fallbackId,
    kind: obj.kind as SkillKind,
    description: obj.description,
    ...(triggers && triggers.length > 0 ? { triggers } : {}),
    ...(typeof obj.optional === "boolean" ? { optional: obj.optional } : {}),
    ...(typeof obj.priority === "number" ? { priority: obj.priority } : {}),
    ...(typeof obj.requiresTarget === "boolean" ? { requiresTarget: obj.requiresTarget } : {}),
    ...(targetIntent ? { targetIntent } : {}),
    ...(isString(obj.label) ? { label: obj.label } : {}),
    ...("rules" in obj ? { rules: validateRules(obj.rules, `${fallbackId}.skill.json`) } : {}),
    ...("conversions" in obj ? { conversions: parseConversions(obj.conversions, `${fallbackId}.skill.json`) } : {}),
  };
};

const parseCodeSkill = (mod: unknown, fallbackId: string, namespacedId: string): SkillModule => {
  const raw = (mod as { default?: unknown } | undefined)?.default ?? mod;
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`${fallbackId}.skill 未 default 导出技能对象`);
  }
  const obj = raw as Record<string, unknown>;
  if (!isString(obj.kind) || !SKILL_KINDS.includes(obj.kind as SkillKind)) {
    throw new Error(`${fallbackId}.skill kind 非法`);
  }
  if (!isString(obj.description)) {
    throw new Error(`${fallbackId}.skill 缺少 description`);
  }
  const triggers = Array.isArray(obj.triggers)
    ? obj.triggers.filter((item): item is SkillTrigger => SKILL_TRIGGERS.includes(item as SkillTrigger))
    : undefined;
  const targetIntent = parseTargetIntent(obj.targetIntent, `${fallbackId}.skill`);
  const entry: SkillModule = {
    id: namespacedId,
    displayName: isString(obj.displayName) ? obj.displayName : fallbackId,
    kind: obj.kind as SkillKind,
    description: obj.description,
    ...(triggers && triggers.length > 0 ? { triggers } : {}),
    ...(typeof obj.optional === "boolean" ? { optional: obj.optional } : {}),
    ...(typeof obj.priority === "number" ? { priority: obj.priority } : {}),
    ...(typeof obj.requiresTarget === "boolean" ? { requiresTarget: obj.requiresTarget } : {}),
    ...(targetIntent ? { targetIntent } : {}),
    ...(isString(obj.label) ? { label: obj.label } : {}),
    ...("rules" in obj ? { rules: validateRules(obj.rules, `${fallbackId}.skill`) } : {}),
    ...("conversions" in obj ? { conversions: parseConversions(obj.conversions, `${fallbackId}.skill`) } : {}),
    ...(typeof obj.canUse === "function" ? { canUse: obj.canUse as NonNullable<SkillModule["canUse"]> } : {}),
    ...(typeof obj.getTargets === "function"
      ? { getTargets: obj.getTargets as NonNullable<SkillModule["getTargets"]> }
      : {}),
    ...(typeof obj.play === "function" ? { play: obj.play as NonNullable<SkillModule["play"]> } : {}),
    ...(typeof obj.handLimit === "function" ? { handLimit: obj.handLimit as NonNullable<SkillModule["handLimit"]> } : {}),
    ...(typeof obj.onTrigger === "object" && obj.onTrigger !== null ? { onTrigger: obj.onTrigger } : {}),
  };
  return entry;
};

const loadOnePack = async (
  dir: string,
  folderName: string,
  options: Required<Pick<GeneralPackLoadOptions, "jsonOnly">>,
): Promise<{ general: GeneralDefinition; skills: PackSkillEntry[] }> => {
  const generalPath = join(dir, folderName, "general.json");
  const meta = validateGeneralJson(JSON.parse(readFileSync(generalPath, "utf-8")), folderName);
  const skills: PackSkillEntry[] = [];
  const namespacedSkills: SkillId[] = [];
  for (const declared of meta.skills) {
    // 安全：技能名只允许字母、数字、下划线、连字符与中文，杜绝 `../../evil` 类路径穿越。
    if (!/^[\w\u4e00-\u9fa5-]+$/u.test(declared)) {
      throw new Error(`技能名非法（只允许字母、数字、下划线、连字符与中文）：${folderName}/${declared}`);
    }
    const base = join(dir, folderName, declared);
    const jsonPath = `${base}.skill.json`;
    const tsPath = `${base}.skill.ts`;
    const mjsPath = `${base}.skill.mjs`;
    const hasJson = existsSync(jsonPath);
    const hasCode = existsSync(tsPath) || existsSync(mjsPath);
    if (!hasJson && !hasCode) {
      throw new Error(`技能文件缺失：${folderName}/${declared}.skill.{json,ts,mjs}`);
    }
    const namespacedId = `${folderName}/${declared}`;
    let module: SkillModule;
    if (hasJson) {
      module = parseDeclarativeSkill(JSON.parse(readFileSync(jsonPath, "utf-8")), declared, namespacedId);
    } else {
      if (options.jsonOnly) {
        throw new Error(`${folderName}/${declared} 是代码技能，但启用了 --generals-json-only`);
      }
      const codePath = existsSync(tsPath) ? tsPath : mjsPath;
      const imported: unknown = await import(pathToFileURL(resolve(codePath)).href);
      module = parseCodeSkill(imported, declared, namespacedId);
    }
    skills.push({ ...module, generalName: meta.name });
    namespacedSkills.push(namespacedId);
  }
  return {
    general: {
      kingdom: meta.kingdom,
      name: meta.name,
      gender: meta.gender,
      maxHp: meta.maxHp,
      skills: namespacedSkills,
      ...(meta.description !== undefined ? { description: meta.description } : {}),
    },
    skills,
  };
};

export async function loadGeneralPacks(options: GeneralPackLoadOptions = {}): Promise<GeneralPackLoadReport> {
  const dir = resolve(process.cwd(), options.dir ?? "generals");
  const pool = options.pool ?? "all";
  const jsonOnly = options.jsonOnly ?? false;
  const strict = options.strict ?? false;
  const log = options.log ?? (() => undefined);

  // 幂等：每次加载先清空外部技能并还原内置池。
  resetPackSkills();
  resetLoadedGenerals();

  const report: GeneralPackLoadReport = { loaded: [], errors: [] };
  if (pool === "builtin" || !existsSync(dir) || !statSync(dir).isDirectory()) {
    return report;
  }

  const builtinNames = new Set(getBuiltinGenerals().map((general) => general.name));
  const external: GeneralDefinition[] = [];
  const packFolders = readdirSync(dir).filter((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() && existsSync(join(full, "general.json"));
  });

  for (const folderName of packFolders) {
    try {
      const { general, skills } = await loadOnePack(dir, folderName, { jsonOnly });
      if (builtinNames.has(general.name) || external.some((item) => item.name === general.name)) {
        throw new Error(`武将名重复：${general.name}`);
      }
      for (const skill of skills) {
        registerPackSkill(skill);
      }
      external.push(general);
      report.loaded.push(general.name);
      log(`[generals] 已加载 ${general.name}（${folderName}，${skills.length} 个技能）`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.errors.push({ pack: folderName, message });
      log(`[generals] 加载失败 ${folderName}：${message}`);
    }
  }

  external.sort((a, b) => a.name.localeCompare(b.name));
  setLoadedGenerals([...getBuiltinGenerals(), ...external]);

  if (strict && report.errors.length > 0) {
    throw new Error(`武将包加载失败（strict）：${report.errors.map((item) => `${item.pack}: ${item.message}`).join("; ")}`);
  }
  return report;
}

/** 测试用：清空外部技能并还原内置池。 */
export function resetGeneralPacks(): void {
  resetPackSkills();
  resetLoadedGenerals();
}
