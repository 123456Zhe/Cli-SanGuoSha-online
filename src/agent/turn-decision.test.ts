import assert from "node:assert/strict";
import { test } from "node:test";
import { computeAiTurnActionLimit } from "./turn-decision.js";

void test("computeAiTurnActionLimit：保证下限 20，随可用牌数放宽（兼容甄姬/黄月英摸牌流）", () => {
  // 手牌很少时（木牛流马空转场景）至少给 20 个动作，不会无限制空转
  assert.equal(computeAiTurnActionLimit(0, 0), 20);
  assert.equal(computeAiTurnActionLimit(2, 1), 20);
  // 手牌较多时放宽，避免误伤正常的多动作回合
  assert.equal(computeAiTurnActionLimit(6, 0), 20);
  assert.equal(computeAiTurnActionLimit(8, 4), 36);
  // 摸牌流长回合：洛神/集智后手牌 10+ 也留有充足动作空间
  assert.equal(computeAiTurnActionLimit(12, 0), 36);
  assert.equal(computeAiTurnActionLimit(10, 2), 36);
});
