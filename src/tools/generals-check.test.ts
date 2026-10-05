import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { resetGeneralPacks } from "../engine/general-pack.js";
import { checkGeneralPacks } from "./generals-check.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sgs-check-"));
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

void test("校验器：仓库自带的示例包零错误，且只报神赵云龙魂那两条已知缺口警告", async () => {
  const report = await checkGeneralPacks({ dir: join(process.cwd(), "examples", "generals") });

  assert.equal(report.errors, 0, `不应有错误：${report.issues.map((issue) => issue.message).join(" | ")}`);
  assert.equal(report.scanned, 2);
  assert.deepEqual(
    report.packs.map((pack) => pack.name).sort(),
    ["吕蒙", "神赵云"].sort(),
  );
  const lvMeng = report.packs.find((pack) => pack.name === "吕蒙");
  assert.equal(lvMeng?.loaded, true);
  assert.deepEqual(
    lvMeng?.skillsLoaded.map((skill) => `${skill.id}:${skill.kind}`),
    ["吕蒙/克己:triggered", "吕蒙/涉猎:active"],
  );
  const shenZhaoYun = report.packs.find((pack) => pack.name === "神赵云");
  assert.equal(shenZhaoYun?.loaded, true);
  assert.deepEqual(
    shenZhaoYun?.skillsLoaded.map((skill) => `${skill.id}:${skill.kind}`),
    ["神赵云/绝境:triggered", "神赵云/龙魂:conversion"],
  );

  // 这两条警告**钉住已知缺口**：`kind: "conversion"`（当牌转换）引擎尚未执行。
  // 一旦实现了 conversions，这个用例会失败——那时应当把龙魂改成可真执行的形式并更新这里。
  assert.deepEqual(
    report.issues.map((issue) => ({ level: issue.level, pack: issue.pack, message: issue.message })),
    [
      {
        level: "warning",
        pack: "神赵云",
        message: '龙魂：kind = "conversion"（当牌转换）目前不会被引擎枚举为可玩动作，写了也不会生效（已知缺口，优先待补）',
      },
      {
        level: "warning",
        pack: "神赵云",
        message: "龙魂：既没有 triggers 也没有 rules，这个技能不会有任何效果",
      },
    ],
  );
  assert.equal(report.warnings, 2);
});

void test("校验器：未知触发点被报错（loader 只会静默丢弃）", async () => {
  writePack(
    "测试将",
    validGeneral({ name: "测试将", skills: ["假触发"] }),
    { 假触发: { kind: "triggered", description: "触发点名拼错", triggers: ["on_play_phase"] } },
  );

  const report = await checkGeneralPacks({ dir: root });
  const messages = report.issues.map((issue) => issue.message);
  assert.ok(
    messages.some((message) => message.includes("on_play_phase") && message.includes("不存在")),
    `应报出未知触发点，实际：${messages.join(" | ")}`,
  );
  assert.ok(report.errors > 0);
});

void test("校验器：未知 rules 键被报错，且给出允许清单", async () => {
  writePack(
    "测试将",
    validGeneral({ name: "测试将", skills: ["拼错"] }),
    { 拼错: { kind: "passive", description: "拼错规则键", rules: { drawPhaseDelat: 1 } } },
  );

  const report = await checkGeneralPacks({ dir: root });
  assert.ok(
    report.issues.some((issue) => issue.message.includes("rules.drawPhaseDelat 不是已知规则")),
    "应报出未知规则键",
  );
  assert.ok(report.issues.some((issue) => issue.message.includes("drawPhaseDelta")));
});

void test("校验器：conversion / 无 play 的主动技能 / 空技能都被点名", async () => {
  writePack(
    "测试将",
    validGeneral({ name: "测试将", skills: ["转换", "空主动", "空触发"] }),
    {
      转换: { kind: "conversion", description: "当牌转换", displayName: "转换" },
      空主动: { kind: "active", description: "没有 play", displayName: "空主动", requiresTarget: true },
      空触发: { kind: "triggered", description: "没有 triggers", displayName: "空触发" },
    },
  );

  const report = await checkGeneralPacks({ dir: root });
  const messages = report.issues.map((issue) => issue.message);
  assert.ok(messages.some((message) => message.includes("conversion") && message.includes("不会被引擎枚举")));
  assert.ok(messages.some((message) => message.includes("空主动") && message.includes("没有 play()")));
  assert.ok(messages.some((message) => message.includes("空触发") && message.includes("不会有任何效果")));
  assert.equal(report.warnings >= 3, true, "这些是警告而非错误（包仍能加载）");
});

void test("校验器：general.json 拼错字段/重名/文件夹不一致告警，且不重复报同一个技能", async () => {
  writePack(
    "文件夹名",
    validGeneral({ name: "武将名", skills: ["技", "技"], titel: "拼错了" }),
    { 技: { kind: "passive", description: "说明", displayName: "技", rules: { slashLimitExempt: true } } },
  );

  const report = await checkGeneralPacks({ dir: root });
  const messages = report.issues.map((issue) => issue.message);
  assert.ok(messages.some((message) => message.includes('"titel"') && message.includes("不是已知字段")));
  assert.ok(messages.some((message) => message.includes("与文件夹名") && message.includes("不一致")));
  const duplicates = messages.filter((message) => message.includes("重复声明"));
  assert.equal(duplicates.length, 1, "重复声明只报一次");
  assert.ok(duplicates[0]?.includes('"技"'), "重复声明应点名是哪个技能");
  // skills 里重复声明的技能只 lint 一次（否则同一个技能的问题会重复输出）。
  assert.equal(report.packs[0]?.skills.length, 1);
});

void test("校验器：代码技能的 onTrigger 用了未知触发点时报错", async () => {
  writePack(
    "测试将",
    validGeneral({ name: "测试将", skills: ["代码技"] }),
    {
      代码技: `export default { kind: "triggered", description: "钩子键拼错", triggers: ["turn_start"], onTrigger: { not_a_trigger: () => {} } };`,
    },
  );

  const report = await checkGeneralPacks({ dir: root });
  assert.ok(
    report.issues.some((issue) => issue.message.includes("onTrigger 的键") && issue.message.includes("not_a_trigger")),
    "应报出未知钩子键",
  );
});

void test("校验器：目录不存在时给出明确的全局错误", async () => {
  const report = await checkGeneralPacks({ dir: join(root, "不存在") });
  assert.equal(report.scanned, 0);
  assert.ok(report.issues.some((issue) => issue.pack === "（全局）" && issue.message.includes("目录不存在")));
  assert.equal(report.errors, 1);
});

void test("校验器：--selfplay 用自对弈跑通整局且零违规", async () => {
  writePack(
    "测试将",
    validGeneral({ name: "测试将", skills: ["克己"] }),
    {
      克己: {
        kind: "triggered",
        description: "若你未于出牌阶段使用或打出过杀，你可以跳过弃牌阶段。",
        displayName: "克己",
        triggers: ["discard_phase_start"],
        optional: true,
        rules: { skipDiscardPhaseIfNoSlash: true },
      },
    },
  );

  const report = await checkGeneralPacks({ dir: root, selfplayGames: 2, seed: 20240101 });
  assert.deepEqual(report.selfplay.map((run) => run.general), ["测试将"]);
  assert.equal(report.selfplay[0]?.violations.length, 0, "自对弈不应有任何不变量违规");
  assert.equal(report.errors, 0, `不应有错误：${report.issues.map((issue) => issue.message).join(" | ")}`);
});
