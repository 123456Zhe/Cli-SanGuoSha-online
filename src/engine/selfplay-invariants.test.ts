import assert from "node:assert/strict";
import { test } from "node:test";
import { runSelfPlay } from "../tools/selfplay.js";

/** 违规转成可读文本，失败时能直接看到是哪个技能炸的。 */
const formatViolations = (report: Awaited<ReturnType<typeof runSelfPlay>>): string =>
  report.violations
    .map((item) => `[${item.rule}] seed=${item.seed} 第${item.turn}回合 ${item.message}\n  最近动作：\n  ${item.context.join("\n  ")}`)
    .join("\n\n");

void test("headless 自对弈不变量：内置武将池连续对局不崩、不卡死、状态自洽", async () => {
  const report = await runSelfPlay({ games: 3, playerCount: 4, maxStepsPerGame: 400 });
  assert.deepEqual(report.violations, [], `自对弈发现违规：\n${formatViolations(report)}`);
  assert.ok(report.steps > 50, `自对弈步数过少（${report.steps}），可能没真正跑起来`);
  assert.ok(report.turns >= report.games, `回合数（${report.turns}）不应少于局数`);
});

void test("headless 自对弈：同一 seed 必然复现同一局（可复现性）", async () => {
  const first = await runSelfPlay({ games: 1, playerCount: 3, maxStepsPerGame: 120, seed: 12345 });
  const second = await runSelfPlay({ games: 1, playerCount: 3, maxStepsPerGame: 120, seed: 12345 });
  assert.equal(first.steps, second.steps, "同 seed 的步数应完全一致");
  assert.equal(first.turns, second.turns, "同 seed 的回合数应完全一致");
  assert.deepEqual(first.violations, second.violations);
});
