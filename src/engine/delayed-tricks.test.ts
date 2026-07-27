import { test } from "node:test";
import assert from "node:assert/strict";
import { CardType } from "./cards.js";
import { SanGuoGame } from "./game.js";

const zeroRng = (): number => 0;

// 乐不思蜀测试：直接用已有的测试方式（预置判定区+手动startTurn）
// 跳过复杂的"使用→轮到目标→判定"全流程，用"判定区已有+手动startTurn"简化

void test("乐不思蜀：判定不为红桃时跳过出牌阶段", async () => {
  const game = new SanGuoGame(() => 0.999);
  await game.initDefaultGame({ aiCount: 2 });
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hp: number;
      hand: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
      delayedTricks: Array<{ cardType: CardType; sourcePlayerId: string }>;
    }>;
    deck: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
    currentPlayerIndex: number;
  };
  // 先结束 human 的回合，轮到 ai-1 后再预置乐不思蜀并测试
  // 使用更直接的方式 - 在 ai-1 判定区预置乐不思蜀
  const ai1 = runtime.players.find((p) => p.id === "ai-1")!;
  ai1.delayedTricks = [{ cardType: CardType.Indulgence, sourcePlayerId: "human" }];

  // 判定牌不为红桃（黑桃5）
  runtime.deck.unshift({ id: "judge-spade", type: CardType.Slash, suit: "spade", rank: 5, color: "black" });

  const ai1Idx = runtime.players.findIndex((p) => p.id === "ai-1");
  runtime.currentPlayerIndex = ai1Idx;

  const logs = await game.startTurn();

  assert.ok(logs.some((l) => l.includes("乐不思蜀")), "应有乐不思蜀的判定日志");
  assert.ok(logs.some((l) => l.includes("跳过出牌阶段")), "判定不为红桃应跳过出牌阶段");
});

void test("乐不思蜀：判定为红桃时不跳过出牌阶段", async () => {
  const game = new SanGuoGame(() => 0.999);
  await game.initDefaultGame({ aiCount: 2 });
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hp: number;
      hand: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
      delayedTricks: Array<{ cardType: CardType; sourcePlayerId: string }>;
    }>;
    deck: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
    currentPlayerIndex: number;
  };
  const ai1 = runtime.players.find((p) => p.id === "ai-1")!;
  ai1.delayedTricks = [{ cardType: CardType.Indulgence, sourcePlayerId: "human" }];

  // 判定牌为红桃
  runtime.deck.unshift({ id: "judge-heart", type: CardType.Peach, suit: "heart", rank: 7, color: "red" });

  const ai1Idx = runtime.players.findIndex((p) => p.id === "ai-1");
  runtime.currentPlayerIndex = ai1Idx;
  const logs = await game.startTurn();

  assert.ok(logs.some((l) => l.includes("乐不思蜀")), "应有乐不思蜀的判定日志");
  assert.ok(logs.some((l) => l.includes("红桃")), "判定为红桃应提示");
  assert.equal(ai1.delayedTricks.length, 0, "判定后乐不思蜀应移除");
  assert.equal(game.getSnapshot().phase, "出牌阶段", "应正常进入出牌阶段");
});

void test("兵粮寸断：判定不为梅花则跳过摸牌阶段", async () => {
  const game = new SanGuoGame(() => 0.999);
  await game.initDefaultGame({ aiCount: 2 });
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hp: number;
      hand: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
      delayedTricks: Array<{ cardType: CardType; sourcePlayerId: string }>;
    }>;
    deck: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
    currentPlayerIndex: number;
  };
  const ai1 = runtime.players.find((p) => p.id === "ai-1")!;

  ai1.delayedTricks = [{ cardType: CardType.SuppliesCut, sourcePlayerId: "human" }];

  // 判定牌不为梅花（红桃）
  runtime.deck.unshift({ id: "judge-heart", type: CardType.Peach, suit: "heart", rank: 7, color: "red" });

  const handBefore = ai1.hand.length;
  const ai1Idx = runtime.players.findIndex((p) => p.id === "ai-1");
  runtime.currentPlayerIndex = ai1Idx;
  const logs = await game.startTurn();

  assert.ok(logs.some((l) => l.includes("兵粮寸断")), "应有兵粮寸断的判定日志");
  assert.ok(logs.some((l) => l.includes("跳过摸牌阶段")), "应跳过摸牌阶段");
  assert.equal(ai1.hand.length, handBefore, "手牌不应增加（未摸牌）");
});

void test("兵粮寸断：判定为梅花时正常摸牌", async () => {
  const game = new SanGuoGame(() => 0.999);
  await game.initDefaultGame({ aiCount: 2 });
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hp: number;
      hand: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
      delayedTricks: Array<{ cardType: CardType; sourcePlayerId: string }>;
    }>;
    deck: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
    currentPlayerIndex: number;
  };
  const ai1 = runtime.players.find((p) => p.id === "ai-1")!;

  ai1.delayedTricks = [{ cardType: CardType.SuppliesCut, sourcePlayerId: "human" }];

  // 判定牌为梅花
  runtime.deck.unshift({ id: "judge-club", type: CardType.Slash, suit: "club", rank: 3, color: "black" });

  const handBefore = ai1.hand.length;
  const ai1Idx = runtime.players.findIndex((p) => p.id === "ai-1");
  runtime.currentPlayerIndex = ai1Idx;
  const logs = await game.startTurn();

  assert.ok(logs.some((l) => l.includes("兵粮寸断")), "应有兵粮寸断的判定日志");
  assert.ok(logs.some((l) => l.includes("梅花")), "判定为梅花应提示");
  assert.ok(ai1.hand.length > handBefore, "手牌应增加（正常摸牌）");
});

void test("闪电：判定黑桃2-9时受到3点伤害", async () => {
  const game = new SanGuoGame(() => 0.999);
  await game.initDefaultGame({ aiCount: 1 });
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hp: number;
      hand: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
      delayedTricks: Array<{ cardType: CardType; sourcePlayerId: string }>;
    }>;
    deck: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
    currentPlayerIndex: number;
  };
  const human = runtime.players.find((p) => p.id === "human")!;

  human.delayedTricks = [{ cardType: CardType.Lightning, sourcePlayerId: "human" }];

  // 判定牌为黑桃5（2-9范围内）
  runtime.deck.unshift({ id: "judge-spade5", type: CardType.Slash, suit: "spade", rank: 5, color: "black" });

  const hpBefore = human.hp;
  const logs = await game.startTurn();

  assert.ok(logs.some((l) => l.includes("闪电")), "应有闪电的判定日志");
  assert.ok(logs.some((l) => l.includes("3 点")), "应受到3点伤害");
  assert.equal(human.hp, hpBefore - 3, "应损失3点体力");
});

void test("闪电：判定非黑桃2-9时移至下家", async () => {
  const game = new SanGuoGame(() => 0.999);
  await game.initDefaultGame({ aiCount: 2 });
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hp: number;
      hand: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
      delayedTricks: Array<{ cardType: CardType; sourcePlayerId: string }>;
    }>;
    deck: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
    currentPlayerIndex: number;
  };
  const human = runtime.players.find((p) => p.id === "human")!;
  const ai1 = runtime.players.find((p) => p.id === "ai-1")!;
  const ai2 = runtime.players.find((p) => p.id === "ai-2")!;
  const humanIdx = runtime.players.findIndex((p) => p.id === "human");

  human.delayedTricks = [{ cardType: CardType.Lightning, sourcePlayerId: "human" }];

  // 判定牌为红桃3（非黑桃2-9）
  runtime.deck.unshift({ id: "judge-heart3", type: CardType.Peach, suit: "heart", rank: 3, color: "red" });

  runtime.currentPlayerIndex = humanIdx;
  const logs = await game.startTurn();

  assert.ok(logs.some((l) => l.includes("闪电")), "应有闪电的判定日志");
  assert.ok(logs.some((l) => l.includes("未命中")), "判定未命中");
  assert.equal(human.delayedTricks.length, 0, "闪电应从当前玩家移除");
  const hasMoved = ai1.delayedTricks.some((t) => t.cardType === CardType.Lightning) ||
                   ai2.delayedTricks.some((t) => t.cardType === CardType.Lightning);
  assert.ok(hasMoved, "闪电应移至下家");
});

void test("不可对已有乐不思蜀的目标使用乐不思蜀", async () => {
  const game = new SanGuoGame(zeroRng);
  await game.initDefaultGame({ aiCount: 1 });
  const runtime = game as unknown as {
    players: Array<{ id: string; hand: Array<{ id: string; type: CardType }>; delayedTricks: Array<{ cardType: CardType; sourcePlayerId: string }> }>;
  };
  const human = runtime.players.find((p) => p.id === "human")!;
  const ai1 = runtime.players.find((p) => p.id === "ai-1")!;

  ai1.delayedTricks = [{ cardType: CardType.Indulgence, sourcePlayerId: "human" }];
  human.hand = [{ id: "test-indulgence", type: CardType.Indulgence }];

  const actions = game.getPlayableActions("human");
  const indulgenceAction = actions.find((a) => a.type === "play" && a.label.includes(CardType.Indulgence));
  assert.equal(indulgenceAction, undefined, "无可选目标时不应有乐不思蜀可用");
});

void test("已有闪电时不可再使用闪电", async () => {
  const game = new SanGuoGame(zeroRng);
  await game.initDefaultGame({ aiCount: 1 });
  const runtime = game as unknown as {
    players: Array<{ id: string; hand: Array<{ id: string; type: CardType }>; delayedTricks: Array<{ cardType: CardType; sourcePlayerId: string }> }>;
  };
  const human = runtime.players.find((p) => p.id === "human")!;

  human.delayedTricks = [{ cardType: CardType.Lightning, sourcePlayerId: "human" }];
  human.hand = [{ id: "test-lightning", type: CardType.Lightning }];

  const actions = game.getPlayableActions("human");
  const lightningAction = actions.find((a) => a.type === "play" && a.label.includes(CardType.Lightning));
  assert.equal(lightningAction, undefined, "已有闪电时不应有闪电可用");
});
