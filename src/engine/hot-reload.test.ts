import assert from "node:assert/strict";
import { test } from "node:test";
import { SanGuoGame } from "./game.js";
import { hotReloadEngine } from "./hot-reload.js";

const fixedRng = (): number => 0;

void test("热重载：原型切换到新模块，方法来自新加载的代码", async () => {
  const game = new SanGuoGame(fixedRng);
  await game.initDefaultGame({ aiCount: 1 });
  const { gameClass, report } = await hotReloadEngine(game);
  assert.equal(report.ok, true);
  assert.match(report.sourceHash, /^[0-9a-f]{12}$/);
  // 原型已换成新模块的类
  assert.equal(Object.getPrototypeOf(game), gameClass.prototype);
  assert.notEqual(Object.getPrototypeOf(game), SanGuoGame.prototype);
  assert.ok(game instanceof gameClass);
  // 方法是新模块加载的函数对象，不是旧原型上的
  assert.notEqual(
    (game as unknown as { playAction: unknown }).playAction,
    (SanGuoGame.prototype as unknown as { playAction: unknown }).playAction,
  );
});

void test("热重载：进行中的对局状态完整保留且可继续", async () => {
  const game = new SanGuoGame(fixedRng);
  await game.initDefaultGame({ aiCount: 1 });
  const before = game.getSnapshot();
  const beforeJson = JSON.stringify(before);
  const { gameClass } = await hotReloadEngine(game);
  const after = game.getSnapshot();
  assert.equal(JSON.stringify(after), beforeJson);
  // 重载后对局能继续推进：用新方法取当前玩家
  const current = game.getCurrentPlayer();
  assert.ok(current.alive, "当前玩家应存活");
  // 新类可用于开新局
  const fresh = new gameClass(fixedRng);
  await fresh.initDefaultGame({ aiCount: 1 });
  assert.ok(fresh.getSnapshot().players.length > 0);
});

void test("热重载：技能钩子闭包已重建", async () => {
  const game = new SanGuoGame(fixedRng);
  await game.initDefaultGame({ aiCount: 1 });
  const hooksBefore = (game as unknown as { skillHooks: Record<string, Array<(...args: never[]) => unknown>> }).skillHooks;
  const flatBefore = Object.values(hooksBefore).flat();
  await hotReloadEngine(game);
  const hooksAfter = (game as unknown as { skillHooks: Record<string, Array<(...args: never[]) => unknown>> }).skillHooks;
  const flatAfter = Object.values(hooksAfter).flat();
  assert.equal(flatAfter.length, flatBefore.length);
  for (let i = 0; i < flatAfter.length; i++) {
    assert.notEqual(flatAfter[i], flatBefore[i], "技能钩子应来自新模块");
  }
});
