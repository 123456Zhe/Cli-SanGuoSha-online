import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { CardType } from "./cards.js";
import { InteractionDecision, InteractionRequest, Player, SanGuoGame, TurnPhase } from "./game.js";
import { resetGeneralPacks } from "./general-pack.js";
import { registerPackSkill } from "./skill-module.js";

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

void test("闪电贴自己时其他角色可无懈抵消", async () => {
  const game = new SanGuoGame(zeroRng);
  await game.initNetworkGame(
    [
      { id: "p0", name: "甲" },
      { id: "p1", name: "乙" },
      { id: "p2", name: "丙" },
    ],
    0,
    false,
  );
  const runtime = game as unknown as {
    currentPlayerIndex: number;
    phase: TurnPhase;
    players: Player[];
    slashUsedThisTurn: boolean;
    slashPlayedThisTurn: boolean;
  };
  for (const player of runtime.players) {
    player.skills = [];
    player.hand = [];
    player.hp = 4;
    player.maxHp = 4;
    player.alive = true;
  }
  runtime.currentPlayerIndex = 0;
  runtime.phase = TurnPhase.Play;
  runtime.slashUsedThisTurn = false;
  runtime.slashPlayedThisTurn = false;
  const [p0, p1] = runtime.players as [Player, Player, Player];
  p0.hand = [{ id: "lt", type: CardType.Lightning, color: "black", suit: "spade", rank: 1 }];
  p1.hand = [{ id: "wx", type: CardType.Negate, color: "red", suit: "heart", rank: 12 }];
  game.setDecisionHandler(p1.id, (request: InteractionRequest): InteractionDecision => {
    if (request.kind === "respond" && request.responseKind === "negate") {
      const first = request.sources[0];
      return first ? { choice: "card", sourceId: first.sourceId } : { choice: "pass" };
    }
    return { choice: "pass" };
  });
  const action = game.getPlayableActions(p0.id).find((item) => item.type === "play");
  assert.ok(action, "应能使用闪电");
  const logs = await game.playAction(p0.id, action);
  assert.equal(p0.delayedTricks.length, 0, `被无懈后判定区不应有闪电：${logs.join(" / ")}`);
  assert.ok(logs.some((line) => line.includes("打出无懈可击")), logs.join(" / "));
});

void test("无人无懈时闪电正常进入自己的判定区", async () => {
  const game = new SanGuoGame(zeroRng);
  await game.initNetworkGame(
    [
      { id: "p0", name: "甲" },
      { id: "p1", name: "乙" },
    ],
    0,
    false,
  );
  const runtime = game as unknown as {
    currentPlayerIndex: number;
    phase: TurnPhase;
    players: Player[];
    slashUsedThisTurn: boolean;
    slashPlayedThisTurn: boolean;
  };
  for (const player of runtime.players) {
    player.skills = [];
    player.hand = [];
    player.hp = 4;
    player.maxHp = 4;
    player.alive = true;
  }
  runtime.currentPlayerIndex = 0;
  runtime.phase = TurnPhase.Play;
  runtime.slashUsedThisTurn = false;
  runtime.slashPlayedThisTurn = false;
  const [p0] = runtime.players as [Player, Player];
  p0.hand = [{ id: "lt", type: CardType.Lightning, color: "black", suit: "spade", rank: 1 }];
  const action = game.getPlayableActions(p0.id).find((item) => item.type === "play");
  assert.ok(action, "应能使用闪电");
  const logs = await game.playAction(p0.id, action);
  assert.equal(p0.delayedTricks.length, 1, logs.join(" / "));
  assert.equal(p0.delayedTricks[0]?.cardType, CardType.Lightning);
});

afterEach(() => {
  resetGeneralPacks();
});

void test("外部改判漏移除替换牌时引擎兜底清理，保证单区唯一", async () => {
  // 草率的外部包：把手牌设为判定牌，但"忘记"从手牌移除（违反钩子契约）
  registerPackSkill({
    id: "测试/草率改判",
    displayName: "草率改判",
    kind: "triggered",
    description: "测试用：故意不移除替换牌",
    generalName: "测试",
    onTrigger: {
      judgment: (ctx, payload) => {
        const actor = payload.actor;
        const handCard = actor?.hand[0];
        if (actor && handCard && ctx.hasSkill(actor, "测试/草率改判")) {
          payload.judgmentCard = handCard;
        }
      },
    },
  });
  const game = new SanGuoGame(zeroRng);
  await game.initNetworkGame(
    [
      { id: "p0", name: "甲" },
      { id: "p1", name: "乙" },
    ],
    0,
    false,
  );
  const runtime = game as unknown as {
    currentPlayerIndex: number;
    phase: TurnPhase;
    players: Player[];
    deck: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
    discardPile: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
  };
  for (const player of runtime.players) {
    player.skills = [];
    player.hand = [];
    player.hp = 4;
    player.maxHp = 4;
    player.alive = true;
    player.delayedTricks = [];
  }
  runtime.currentPlayerIndex = 0;
  const [p0] = runtime.players as [Player, Player];
  p0.skills = ["测试/草率改判"];
  p0.hand = [{ id: "stor", type: CardType.Slash, color: "black", suit: "club", rank: 5 }];
  p0.delayedTricks = [{ cardType: CardType.Lightning, sourcePlayerId: "p0" }];
  // 判定牌红桃：闪电不命中，只走改判流程，不死人
  runtime.deck.unshift({ id: "judge-h", type: CardType.Peach, color: "red", suit: "heart", rank: 7 });

  const logs = await game.startTurn();
  assert.ok(!p0.hand.some((card) => card.id === "stor"), `替换牌不应残留手牌：${logs.join(" / ")}`);
  assert.equal(
    runtime.discardPile.filter((card) => card.id === "stor").length,
    1,
    `替换牌在弃牌堆应恰有一份：${logs.join(" / ")}`,
  );
  assert.ok(logs.some((line) => line.includes("已清理")), logs.join(" / "));
});
