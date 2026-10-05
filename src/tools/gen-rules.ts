import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getBuiltinGenerals } from "../engine/generals.js";
import { resolveSkillDescriptor } from "../engine/skill-registry.js";
import type { GeneralDefinition } from "../engine/types.js";

/**
 * 从**武将库 + 技能注册表**生成 `rules.md` 的两段内容（计划 Step 5 / M4）：
 * - §14 全部武将与技能说明（详细版，技能说明取注册表 `description`，即"以代码行为为准"的唯一定义）
 * - §16.3 武将速查（短版，只有武将名）
 *
 * 只读**内置**武将池（`getBuiltinGenerals`），外部武将包不会改写随项目发布的规则文档。
 * 生成区域用 `<!-- GENERATED:... -->` 标记括起来，其余正文仍是手写：脚本只替换标记之间的内容，
 * 标记缺失即报错（宁可失败也不误删文档）。
 *
 * 用法：
 *   npm run rules:gen          # 就地重写 rules.md
 *   npm run rules:check        # 只校验是否已同步（CI / npm test 用），不同步则非零退出
 */

const RULES_PATH = resolve(process.cwd(), "rules.md");

const DETAIL_START = "<!-- GENERATED:generals-detail（由 npm run rules:gen 从武将库 + 技能注册表生成，请勿手改） -->";
const DETAIL_END = "<!-- /GENERATED:generals-detail -->";
const SHORT_START = "<!-- GENERATED:generals-short（由 npm run rules:gen 从武将库生成，请勿手改） -->";
const SHORT_END = "<!-- /GENERATED:generals-short -->";

/** 势力展示顺序；未列出的势力按武将库出现顺序追加（保证新势力也能生成）。 */
const KINGDOM_ORDER = ["魏", "蜀", "吴", "群雄"];

const orderedKingdoms = (generals: GeneralDefinition[]): string[] => {
  const seen: string[] = [];
  for (const general of generals) {
    if (!seen.includes(general.kingdom)) {
      seen.push(general.kingdom);
    }
  }
  const known = KINGDOM_ORDER.filter((kingdom) => seen.includes(kingdom));
  const unknown = seen.filter((kingdom) => !KINGDOM_ORDER.includes(kingdom));
  return [...known, ...unknown];
};

/** 技能展示名 + 说明；说明缺失（未登记的技能）直接抛错，避免生成"未知技能"。 */
const describeSkillForRules = (skillId: string, generalName: string): string => {
  const descriptor = resolveSkillDescriptor(skillId);
  if (descriptor.description.startsWith("未知技能")) {
    throw new Error(`${generalName} 的技能 ${skillId} 未在技能注册表中登记，无法生成 rules.md`);
  }
  const name = descriptor.displayName ?? skillId;
  // 说明本身以句号收尾，去掉它再套括号，避免出现「…。）。」
  const detail = descriptor.description.replace(/。$/, "");
  return `${name}（${detail}）`;
};

/** §14 生成区域的内容（不含 GENERATED 标记，标记由 rules.md 持有、脚本只替换其间内容）。 */
export const renderGeneralsDetail = (generals: GeneralDefinition[] = getBuiltinGenerals()): string => {
  const blocks: string[] = [];
  orderedKingdoms(generals).forEach((kingdom, index) => {
    const members = generals.filter((general) => general.kingdom === kingdom);
    if (members.length === 0) {
      return;
    }
    const lines = members.map((general) => {
      const skills = general.skills.map((skillId) => describeSkillForRules(skillId, general.name)).join("、");
      return `- ${general.name}：${skills}。`;
    });
    blocks.push(`### 14.${index + 1} ${kingdom}\n\n${lines.join("\n")}`);
  });
  return `\n\n${blocks.join("\n\n")}\n\n`;
};

/** §16.3 生成区域的内容（不含 GENERATED 标记）。 */
export const renderGeneralsShort = (generals: GeneralDefinition[] = getBuiltinGenerals()): string => {
  const lines = orderedKingdoms(generals)
    .map((kingdom) => {
      const names = generals.filter((general) => general.kingdom === kingdom).map((general) => general.name);
      return names.length > 0 ? `- ${kingdom}：${names.join("、")}。` : null;
    })
    .filter((line): line is string => line !== null);
  lines.push("- 技能详情：查看第14节“全部武将与技能说明”。");
  return `\n\n${lines.join("\n")}\n`;
};

const replaceRegion = (text: string, startMarker: string, endMarker: string, body: string): string => {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  if (start < 0 || end < 0) {
    throw new Error(`rules.md 缺少生成标记：${start < 0 ? startMarker : endMarker}`);
  }
  if (end < start) {
    throw new Error(`rules.md 的生成标记顺序颠倒：${endMarker}`);
  }
  return `${text.slice(0, start + startMarker.length)}${body}${text.slice(end)}`;
};

/** 生成整份 rules.md（纯函数，便于测试与 --check）。 */
export const renderRules = (original: string, generals: GeneralDefinition[] = getBuiltinGenerals()): string => {
  const withDetail = replaceRegion(original, DETAIL_START, DETAIL_END, renderGeneralsDetail(generals));
  return replaceRegion(withDetail, SHORT_START, SHORT_END, renderGeneralsShort(generals));
};

/** 首个不同的行，用于 --check 的可读报错。 */
const firstDiffLine = (expected: string, actual: string): string => {
  const a = expected.split("\n");
  const b = actual.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) {
      return `第 ${i + 1} 行：\n  期望：${a[i] ?? "<无>"}\n  实际：${b[i] ?? "<无>"}`;
    }
  }
  return "（内容相同但行尾/长度不同）";
};

const main = (): void => {
  const checkOnly = process.argv.includes("--check");
  const original = readFileSync(RULES_PATH, "utf-8");
  const generated = renderRules(original);

  if (checkOnly) {
    if (generated === original) {
      console.log("[rules] rules.md 的武将章节已与武将库/注册表同步");
      return;
    }
    console.error(`[rules] rules.md 的武将章节已过期，请运行 npm run rules:gen\n${firstDiffLine(generated, original)}`);
    process.exitCode = 1;
    return;
  }

  if (generated === original) {
    console.log("[rules] rules.md 无需改动");
    return;
  }
  writeFileSync(RULES_PATH, generated, "utf-8");
  console.log("[rules] 已重新生成 rules.md §14 与 §16.3");
};

// 仅在被当作脚本执行时跑 main（被测试 import 时不产生副作用）；tsx 与编译后的 dist 都适用。
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMainModule) {
  main();
}
