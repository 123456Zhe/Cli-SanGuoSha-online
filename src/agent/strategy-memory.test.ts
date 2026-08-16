import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DOCTRINE_MAX_LENGTH,
  EXECUTION_MAX_LENGTH,
  LESSON_MAX_LENGTH,
  LESSONS_MAX_COUNT,
  mergeDoctrine,
  parseStrategyReview,
  StrategyMemory,
  STRATEGY_BLOCK_MAX_LENGTH,
  TACTICAL_NOTE_MAX_LENGTH,
} from "./strategy-memory.js";

void test("parseStrategyReview：普通 JSON / 围栏 JSON 均可解析，缺关键字段或垃圾文本返回 null", () => {
  const valid = '{"execution":"执行顺利","lesson":"别浪费杀","tactical":"集火主公","doctrineUpdate":"主公疑似装弱"}';
  assert.deepEqual(parseStrategyReview(valid), {
    execution: "执行顺利",
    lesson: "别浪费杀",
    tactical: "集火主公",
    doctrineUpdate: "主公疑似装弱",
  });

  const fenced = '```json\n{"execution":"无","lesson":"","tactical":"保留闪","doctrineUpdate":"不变"}\n```';
  assert.deepEqual(parseStrategyReview(fenced), {
    execution: "无",
    lesson: "",
    tactical: "保留闪",
    doctrineUpdate: "不变",
  });

  assert.equal(parseStrategyReview("完全不是 JSON"), null);
  assert.equal(parseStrategyReview('{"execution":"","tactical":""}'), null, "关键字段全空视为不可用");
  assert.equal(parseStrategyReview('{"execution":123,"tactical":"x"}'), null, "非字符串字段视为不可用");
});

void test("StrategyMemory.applyReviewResult：首次复盘填充三层与执行回看，并记录轮次", () => {
  const memory = new StrategyMemory();
  assert.ok(memory.isEmpty, "初始记忆应为空");
  memory.applyReviewResult(
    {
      execution: "上轮按计划压了主公血线",
      lesson: "集火前先拆防御装备",
      tactical: "先过拆主公八卦阵，再补一刀",
      doctrineUpdate: "2号位疑似反贼",
    },
    5,
  );
  assert.equal(memory.tactical, "先过拆主公八卦阵，再补一刀");
  assert.equal(memory.doctrine, "2号位疑似反贼");
  assert.deepEqual(memory.lessons, ["集火前先拆防御装备"]);
  assert.equal(memory.lastExecution, "上轮按计划压了主公血线");
  assert.equal(memory.lastReviewRound, 5);
  assert.ok(!memory.isEmpty);
});

void test("StrategyMemory.applyReviewResult：教训滚动队列最多 2 条且去重相邻重复", () => {
  const memory = new StrategyMemory();
  const base = { execution: "无", lesson: "", tactical: "保留闪", doctrineUpdate: "不变" };
  memory.applyReviewResult({ ...base, lesson: "教训A" }, 1);
  memory.applyReviewResult({ ...base, lesson: "教训B" }, 2);
  memory.applyReviewResult({ ...base, lesson: "教训C" }, 3);
  assert.equal(memory.lessons.length, LESSONS_MAX_COUNT);
  assert.deepEqual(memory.lessons, ["教训B", "教训C"], "超出上限应滚动淘汰最旧教训");

  const memory2 = new StrategyMemory();
  memory2.applyReviewResult({ ...base, lesson: "重复" }, 1);
  memory2.applyReviewResult({ ...base, lesson: "重复" }, 2);
  assert.deepEqual(memory2.lessons, ["重复"], "相邻重复教训不应重复入队");

  const memory3 = new StrategyMemory();
  memory3.applyReviewResult({ ...base, lesson: "" }, 1);
  assert.deepEqual(memory3.lessons, [], "空教训不入队");
});

void test("StrategyMemory.applyReviewResult：字段按上限截断；空战术不覆写旧战术", () => {
  const memory = new StrategyMemory();
  memory.applyReviewResult(
    { execution: "x".repeat(500), lesson: "y".repeat(500), tactical: "z".repeat(500), doctrineUpdate: "w".repeat(500) },
    1,
  );
  assert.equal(memory.lastExecution.length, EXECUTION_MAX_LENGTH);
  assert.equal(memory.lessons[0]?.length, LESSON_MAX_LENGTH);
  assert.equal(memory.tactical.length, TACTICAL_NOTE_MAX_LENGTH);
  assert.equal(memory.doctrine.length, DOCTRINE_MAX_LENGTH);

  memory.applyReviewResult({ execution: "无", lesson: "", tactical: "", doctrineUpdate: "不变" }, 2);
  assert.equal(memory.tactical.length, TACTICAL_NOTE_MAX_LENGTH, "空战术不应覆盖已有战术");
});

void test("StrategyMemory.composePromptBlock：空记忆为空串；有记忆按 方针→执行→教训→战术 顺序且总长有界", () => {
  const memory = new StrategyMemory();
  assert.equal(memory.composePromptBlock(), "");

  memory.applyReviewResult(
    { execution: "执行平稳", lesson: "教训一", tactical: "下回合保留无懈", doctrineUpdate: "3号位是忠臣" },
    3,
  );
  const block = memory.composePromptBlock();
  assert.ok(block.includes("你上回合末的策略笔记（分层记忆）"));
  const doctrineIndex = block.indexOf("【战略方针·跨回合】");
  const executionIndex = block.indexOf("【上轮执行】");
  const lessonIndex = block.indexOf("【经验教训】");
  const tacticalIndex = block.indexOf("【上回合战术】");
  assert.ok(doctrineIndex < executionIndex && executionIndex < lessonIndex && lessonIndex < tacticalIndex, "区块应按固定顺序排列");
  assert.ok(block.includes("3号位是忠臣"));
  assert.ok(block.includes("下回合保留无懈"));
  assert.ok(block.length <= STRATEGY_BLOCK_MAX_LENGTH);
});

void test("mergeDoctrine：空更新/「不变」保留旧方针；新信息优先；超限裁剪时保住最新更新", () => {
  assert.equal(mergeDoctrine("旧方针", ""), "旧方针");
  assert.equal(mergeDoctrine("旧方针", "不变"), "旧方针");
  assert.equal(mergeDoctrine("", "新方针"), "新方针");
  assert.equal(mergeDoctrine("旧", "新"), "新；旧", "更新应置于旧方针之前");

  const longOld = "a".repeat(DOCTRINE_MAX_LENGTH);
  const merged = mergeDoctrine(longOld, "最新结论");
  assert.ok(merged.startsWith("最新结论；"), "合并超限时最新更新应完整保留");
  assert.ok(merged.length <= DOCTRINE_MAX_LENGTH);
});
