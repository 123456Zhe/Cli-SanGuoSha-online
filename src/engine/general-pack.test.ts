import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { GENERAL_LIBRARY, getBuiltinGenerals, resolveGeneralByName } from "./generals.js";
import { loadGeneralPacks, resetGeneralPacks } from "./general-pack.js";
import { SKILL_RULE_KEY_KINDS, SkillRuleKey } from "./skill-registry.js";
import { getPackSkill, getPackSkills } from "./skill-module.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sgs-pack-"));
  resetGeneralPacks();
});

afterEach(() => {
  resetGeneralPacks();
  rmSync(root, { recursive: true, force: true });
});

type SkillContent = Record<string, unknown> | string;

const writePack = (
  folder: string,
  general: Record<string, unknown>,
  skills: Record<string, SkillContent> = {},
): void => {
  const dir = join(root, folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "general.json"), JSON.stringify(general));
  for (const [name, content] of Object.entries(skills)) {
    const isCode = typeof content === "string";
    writeFileSync(join(dir, `${name}${isCode ? ".skill.ts" : ".skill.json"}`), isCode ? content : JSON.stringify(content));
  }
};

const validGeneral = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  apiVersion: 1,
  name: "测试将",
  kingdom: "吴",
  gender: "男",
  maxHp: 4,
  skills: [],
  ...overrides,
});

void test("加载外部包：武将入池、技能用命名空间 id 注册", async () => {
  writePack(
    "吕蒙",
    validGeneral({ name: "吕蒙", skills: ["克己"] }),
    { 克己: { id: "克己", kind: "triggered", description: "测试技能" } },
  );

  const report = await loadGeneralPacks({ dir: root, pool: "all" });
  assert.deepEqual(report.loaded, ["吕蒙"]);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(resolveGeneralByName("吕蒙").skills, ["吕蒙/克己"]);
  assert.ok(getPackSkill("吕蒙/克己"), "外部技能应可用命名空间 id 查询");
  assert.equal(GENERAL_LIBRARY.length, getBuiltinGenerals().length + 1, "外部武将应并入已加载池");
});

void test("坏包隔离：坏包记录错误但不影响好包", async () => {
  writePack("好将", validGeneral({ name: "好将", skills: [] }));
  writePack("坏将", validGeneral({ name: "坏将", kingdom: undefined }));

  const report = await loadGeneralPacks({ dir: root, pool: "all" });
  assert.deepEqual(report.loaded, ["好将"]);
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0]?.pack, "坏将");
  assert.ok(resolveGeneralByName("好将"), "好包应正常入池");
});

void test("strict：任一包失败即抛出", async () => {
  writePack("坏将", validGeneral({ name: "坏将", kingdom: undefined }));
  await assert.rejects(() => loadGeneralPacks({ dir: root, pool: "all", strict: true }), /strict/);
});

void test("路径穿越：skills 里带 ../ 的包被拒绝，不跳出包目录", async () => {
  writePack("好将", validGeneral({ name: "好将", skills: [] }));
  writePack("坏将", validGeneral({ name: "坏将", skills: ["../../evil", "a/b"] }));

  const report = await loadGeneralPacks({ dir: root, pool: "all" });
  assert.deepEqual(report.loaded, ["好将"]);
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0]?.pack, "坏将");
  assert.match(report.errors[0]?.message ?? "", /非法/);
  assert.ok(resolveGeneralByName("好将"), "好包应正常入池");
});

void test("jsonOnly：拒绝代码技能", async () => {
  writePack(
    "吕蒙",
    validGeneral({ name: "吕蒙", skills: ["涉猎"] }),
    { 涉猎: "export default { kind: 'active', description: 'x' };" },
  );

  const report = await loadGeneralPacks({ dir: root, pool: "all", jsonOnly: true });
  assert.deepEqual(report.loaded, []);
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0]?.message ?? "", /json-only/);
});

void test("pool=builtin：忽略目录、仅保留内置池", async () => {
  writePack(
    "吕蒙",
    validGeneral({ name: "吕蒙", skills: ["克己"] }),
    { 克己: { id: "克己", kind: "triggered", description: "测试技能" } },
  );

  const report = await loadGeneralPacks({ dir: root, pool: "builtin" });
  assert.deepEqual(report.loaded, []);
  assert.equal(getPackSkills().length, 0);
  assert.equal(GENERAL_LIBRARY.length, getBuiltinGenerals().length);
  assert.throws(() => resolveGeneralByName("吕蒙"));
});

void test("与内置武将重名：该包被拒绝", async () => {
  writePack("孙策", validGeneral({ name: "孙策", skills: [] }));

  const report = await loadGeneralPacks({ dir: root, pool: "all" });
  assert.deepEqual(report.loaded, []);
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0]?.message ?? "", /重复/);
});

void test("代码技能：.skill.ts 可被加载", async () => {
  writePack(
    "吕蒙",
    validGeneral({ name: "吕蒙", skills: ["涉猎"] }),
    {
      涉猎: "export default { id: '涉猎', kind: 'active', description: '代码技能', play: async () => [] };",
    },
  );

  const report = await loadGeneralPacks({ dir: root, pool: "all" });
  assert.deepEqual(report.loaded, ["吕蒙"]);
  assert.equal(typeof getPackSkill("吕蒙/涉猎")?.play, "function");
});

void test("latentSkills：潜在技能被加载注册但不开局持有", async () => {
  writePack(
    "杜预",
    validGeneral({ name: "杜预", kingdom: "群", skills: ["武库", "三陈"], latentSkills: ["滅吳"] }),
    {
      武库: { id: "武库", kind: "triggered", description: "测试" },
      三陈: { id: "三陈", kind: "triggered", description: "测试" },
      滅吳: {
        id: "滅吳",
        kind: "conversion",
        description: "测试",
        conversions: [{ from: { suit: ["heart", "diamond", "club", "spade"] }, to: "杀" }],
      },
    },
  );

  const report = await loadGeneralPacks({ dir: root, pool: "all" });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.loaded, ["杜预"]);
  const general = resolveGeneralByName("杜预");
  assert.deepEqual(general.skills, ["杜预/武库", "杜预/三陈"]);
  assert.deepEqual(general.latentSkills, ["杜预/滅吳"]);
  // 潜在技能已注册（可解析），但不在开局技能表里。
  assert.ok(getPackSkill("杜预/滅吳"));
  assert.equal(general.skills.includes("杜预/滅吳"), false);
});

void test("latentSkills 与 skills 重叠：包被拒绝", async () => {
  writePack(
    "杜预",
    validGeneral({ name: "杜预", skills: ["武库"], latentSkills: ["武库"] }),
    { 武库: { id: "武库", kind: "triggered", description: "测试" } },
  );
  const report = await loadGeneralPacks({ dir: root, pool: "all" });
  assert.equal(report.loaded.length, 0);
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0]?.message ?? "", /重叠/);
});

void test("latentSkills 文件缺失：包被拒绝", async () => {
  writePack(
    "杜预",
    validGeneral({ name: "杜预", skills: ["武库"], latentSkills: ["滅吳"] }),
    { 武库: { id: "武库", kind: "triggered", description: "测试" } },
  );
  const report = await loadGeneralPacks({ dir: root, pool: "all" });
  assert.equal(report.loaded.length, 0);
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0]?.message ?? "", /技能文件缺失/);
});

void test("rules 校验：合法 rules 被接受并保留", async () => {
  writePack(
    "吕蒙",
    validGeneral({ name: "吕蒙", skills: ["克己"] }),
    {
      克己: {
        id: "克己",
        kind: "passive",
        description: "测试",
        rules: { slashLimitExempt: true, targetImmunity: { cards: ["slash"] } },
      },
    },
  );

  const report = await loadGeneralPacks({ dir: root, pool: "all" });
  assert.deepEqual(report.loaded, ["吕蒙"]);
  assert.deepEqual(getPackSkill("吕蒙/克己")?.rules, {
    slashLimitExempt: true,
    targetImmunity: { cards: ["slash"] },
  });
});

void test("rules 校验：未知键被拒绝（隔离进 errors）", async () => {
  writePack(
    "吕蒙",
    validGeneral({ name: "吕蒙", skills: ["克己"] }),
    {
      克己: { id: "克己", kind: "passive", description: "测试", rules: { notARule: true } },
    },
  );

  const report = await loadGeneralPacks({ dir: root, pool: "all" });
  assert.deepEqual(report.loaded, []);
  assert.match(report.errors[0]?.message ?? "", /不是已知字段/);
});

void test("rules 校验：类型不符在 strict 下抛错", async () => {
  writePack(
    "吕蒙",
    validGeneral({ name: "吕蒙", skills: ["克己"] }),
    {
      克己: { id: "克己", kind: "passive", description: "测试", rules: { distanceDelta: "1" } },
    },
  );

  await assert.rejects(() => loadGeneralPacks({ dir: root, pool: "all", strict: true }), /distanceDelta/);
});

void test("rules 校验：Phase 6 新增的 skipDiscardPhaseIfNoSlash 被接受", async () => {
  writePack(
    "吕蒙",
    validGeneral({ name: "吕蒙", skills: ["克己"] }),
    {
      克己: {
        id: "克己",
        kind: "triggered",
        description: "若你未于出牌阶段使用或打出过杀，你可以跳过弃牌阶段。",
        triggers: ["discard_phase_start"],
        optional: true,
        rules: { skipDiscardPhaseIfNoSlash: true },
      },
    },
  );

  const report = await loadGeneralPacks({ dir: root, pool: "all" });
  assert.deepEqual(report.loaded, ["吕蒙"]);
  const skill = getPackSkill("吕蒙/克己");
  assert.deepEqual(skill?.rules, { skipDiscardPhaseIfNoSlash: true });
  assert.deepEqual(skill?.triggers, ["discard_phase_start"], "Phase 6 拦截点应通过 triggers 校验");
});

void test("rules 校验：skipDiscardPhaseIfNoSlash 类型不符被拒绝", async () => {
  writePack(
    "吕蒙",
    validGeneral({ name: "吕蒙", skills: ["克己"] }),
    {
      克己: { id: "克己", kind: "passive", description: "测试", rules: { skipDiscardPhaseIfNoSlash: "yes" } },
    },
  );

  const report = await loadGeneralPacks({ dir: root, pool: "all" });
  assert.deepEqual(report.loaded, []);
  assert.match(report.errors[0]?.message ?? "", /skipDiscardPhaseIfNoSlash/);
});

void test("targetIntent 校验：合法值被保留", async () => {
  writePack(
    "吕蒙",
    validGeneral({ name: "吕蒙", skills: ["支援"] }),
    {
      支援: {
        id: "支援",
        kind: "active",
        description: "测试",
        requiresTarget: true,
        targetIntent: "ally",
      },
    },
  );

  const report = await loadGeneralPacks({ dir: root, pool: "all" });
  assert.deepEqual(report.loaded, ["吕蒙"]);
  assert.equal(getPackSkill("吕蒙/支援")?.targetIntent, "ally");
  assert.equal(getPackSkill("吕蒙/支援")?.requiresTarget, true);
});

void test("targetIntent 校验：非法值被拒绝（隔离进 errors）", async () => {
  writePack(
    "吕蒙",
    validGeneral({ name: "吕蒙", skills: ["支援"] }),
    {
      支援: { id: "支援", kind: "active", description: "测试", targetIntent: "enemy-ish" },
    },
  );

  const report = await loadGeneralPacks({ dir: root, pool: "all" });
  assert.deepEqual(report.loaded, []);
  assert.match(report.errors[0]?.message ?? "", /targetIntent/);
});

/** gallery（`examples/generals/`）的武将名；新增参考武将时同步这里（测试只要求"都加载成功"，不要求恰好这些）。 */
const GALLERY_GENERALS = ["吕蒙", "神赵云", "张角", "凌统", "荀彧", "卧龙诸葛亮", "刘禅"];

void test("示例包 examples/generals 可整体加载（含全部 gallery 武将）", async () => {
  const report = await loadGeneralPacks({ dir: join(process.cwd(), "examples", "generals"), pool: "all" });
  assert.deepEqual(report.errors, []);
  for (const name of GALLERY_GENERALS) {
    assert.ok(report.loaded.includes(name), `${name} 应该被加载（实际 loaded=${report.loaded.join("/")}）`);
  }
  assert.deepEqual(getPackSkill("吕蒙/克己")?.rules, { skipDiscardPhaseIfNoSlash: true });
  assert.equal(getPackSkill("吕蒙/涉猎")?.kind, "active");
  // 神赵云「绝境」：声明式表达不了运行时数值，用 before_draw 钩子的代码技能实现。
  const juejing = getPackSkill("神赵云/绝境");
  assert.equal(juejing?.kind, "triggered");
  assert.deepEqual(juejing?.triggers, ["before_draw"]);
  assert.equal(typeof juejing?.onTrigger?.before_draw, "function");
  // 神赵云「龙魂」：声明式当牌转换（Phase 7 起真正生效）。
  assert.equal(getPackSkill("神赵云/龙魂")?.kind, "conversion");
  // gallery 新样例的机制抽查：改判 / 失去装备 / 取消杀 / 声明式转换。
  assert.equal(typeof getPackSkill("张角/鬼道")?.onTrigger?.judgment, "function");
  assert.equal(typeof getPackSkill("凌统/旋风")?.onTrigger?.equip_lost, "function");
  assert.equal(typeof getPackSkill("刘禅/享乐")?.onTrigger?.slash_targeted, "function");
  assert.equal(getPackSkill("卧龙诸葛亮/看破")?.conversions?.[0]?.to, "无懈可击");
});

/** 按 SKILL_RULE_KEY_KINDS 生成一个该键的合法取值（词汇表与 validateRules 必须同步）。 */
const sampleRuleValue = (kind: (typeof SKILL_RULE_KEY_KINDS)[SkillRuleKey]): unknown => {
  switch (kind) {
    case "number":
      return 1;
    case "boolean":
      return true;
    case "targetImmunity":
      return { cards: ["slash"] };
  }
};

void test("rules 词汇表 SKILL_RULE_KEY_KINDS 与 validateRules 完全同步", async () => {
  for (const [key, kind] of Object.entries(SKILL_RULE_KEY_KINDS)) {
    writePack(
      "吕蒙",
      validGeneral({ name: "吕蒙", skills: ["克己"] }),
      { 克己: { kind: "passive", description: "词汇表一致性", rules: { [key]: sampleRuleValue(kind) } } },
    );
    const report = await loadGeneralPacks({ dir: root, pool: "all" });
    assert.deepEqual(report.errors, [], `词汇表里的 ${key} 应被 validateRules 接受`);
    assert.ok(getPackSkill("吕蒙/克己")?.rules && key in (getPackSkill("吕蒙/克己")?.rules ?? {}), `${key} 应被保留`);
    rmSync(join(root, "吕蒙"), { recursive: true, force: true });
    resetGeneralPacks();
  }
});

void test("武将包的 general.json description 会被保留进已加载池（不再被静默丢弃）", async () => {
  writePack(
    "吕蒙",
    validGeneral({ name: "吕蒙", skills: ["克己"], description: "吴国武将，善于据守与突袭。" }),
    { 克己: { kind: "passive", description: "测试", rules: { slashLimitExempt: true } } },
  );

  const report = await loadGeneralPacks({ dir: root, pool: "all" });
  assert.deepEqual(report.loaded, ["吕蒙"]);
  assert.equal(resolveGeneralByName("吕蒙").description, "吴国武将，善于据守与突袭。");
});

void test("loader 保留 Phase 8 字段：代码技能的 canUseConversion/onConversionUsed/globalHook 不被 parse 丢掉", async () => {
  // 2026-11-12 实测：parseCodeSkill 重建对象时漏抄这三项，矢志门控/灭吴扣费/
  // 武库与挽危的 globalHook 在真实加载路径上全部静默失效，而 conversions.test.ts
  // 因绕开 loader 直接注册模块，始终没测出来。
  writePack(
    "测试将",
    validGeneral({ name: "测试将", skills: ["测试技"] }),
    {
      测试技: `export default {
        id: "测试技",
        kind: "triggered",
        description: "测试技能",
        triggers: ["provide_response"],
        conversions: [{ from: { type: ["闪"] }, to: "杀", asResponse: ["slash"] }],
        canUseConversion: () => false,
        onConversionUsed: () => {},
        globalHook: true,
        onTrigger: {},
      };`,
    },
  );

  const report = await loadGeneralPacks({ dir: root, pool: "all" });
  assert.deepEqual(report.errors, []);
  const entry = getPackSkill("测试将/测试技");
  assert.ok(entry, "技能应注册");
  assert.equal(typeof entry.canUseConversion, "function", "canUseConversion 不应被 loader 丢掉（矢志门控依赖它）");
  assert.equal(typeof entry.onConversionUsed, "function", "onConversionUsed 不应被 loader 丢掉（灭吴扣费依赖它）");
  assert.equal(entry.globalHook, true, "globalHook 不应被 loader 丢掉（武库/挽危监听他人事件依赖它）");
});

void test("loader 保留声明式技能的 globalHook", async () => {
  writePack(
    "测试将",
    validGeneral({ name: "测试将", skills: ["测试技"] }),
    { 测试技: { id: "测试技", kind: "triggered", description: "测试技能", globalHook: true } },
  );

  const report = await loadGeneralPacks({ dir: root, pool: "all" });
  assert.deepEqual(report.errors, []);
  assert.equal(getPackSkill("测试将/测试技")?.globalHook, true, "JSON 技能的 globalHook 也应保留");
});
