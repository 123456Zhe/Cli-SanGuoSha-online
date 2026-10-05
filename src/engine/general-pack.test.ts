import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { GENERAL_LIBRARY, getBuiltinGenerals, resolveGeneralByName } from "./generals.js";
import { loadGeneralPacks, resetGeneralPacks } from "./general-pack.js";
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

void test("示例包 examples/generals/吕蒙 可加载，克己带 skipDiscardPhaseIfNoSlash", async () => {
  const report = await loadGeneralPacks({ dir: join(process.cwd(), "examples", "generals"), pool: "all" });
  assert.deepEqual(report.loaded, ["吕蒙"]);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(getPackSkill("吕蒙/克己")?.rules, { skipDiscardPhaseIfNoSlash: true });
  assert.equal(getPackSkill("吕蒙/涉猎")?.kind, "active");
});
