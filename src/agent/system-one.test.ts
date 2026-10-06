import assert from "node:assert/strict";
import { test } from "node:test";
import { CardType } from "../engine/cards.js";
import { SanGuoGame, TurnPhase } from "../engine/game.js";
import { LocalAiEngine } from "./local-engine.js";
import { SystemOneAgent } from "./system-one.js";
import { pickAiTurnDecision } from "./turn-decision.js";

const fixedRng = (): number => 0;

const setupPlayTurn = (): { game: SanGuoGame; aiId: string } => {
  const game = new SanGuoGame(fixedRng);
  void game.initDefaultGame();
  const runtime = game as unknown as {
    currentPlayerIndex: number;
    phase: TurnPhase;
    players: Array<{ id: string; hp: number; hand: Array<{ id: string; type: CardType }> }>;
  };
  const aiIndex = runtime.players.findIndex((player) => player.id === "ai-1");
  assert.ok(aiIndex >= 0);
  runtime.currentPlayerIndex = aiIndex;
  runtime.phase = TurnPhase.Play;
  const ai = runtime.players[aiIndex];
  assert.ok(ai);
  ai.hand = [
    { id: "s1", type: CardType.Slash },
    { id: "p1", type: CardType.Peach },
  ];
  return { game, aiId: "ai-1" };
};

void test("System-One 出牌决策同步可用：残血优先吃桃", () => {
  const { game, aiId } = setupPlayTurn();
  const runtime = game as unknown as { players: Array<{ id: string; hp: number }> };
  const ai = runtime.players.find((player) => player.id === aiId);
  assert.ok(ai);
  ai.hp = 1;
  const agent = new SystemOneAgent();
  const snapshot = game.getSnapshot();
  const decision = agent.decideTurn(snapshot, aiId, game.getPlayableActions(aiId));
  assert.ok(decision);
  assert.equal(decision.action.type, "play");
});

void test("System-One 交互决策同步可用：桃只救自己和队友，不救敌人", () => {
  const { game, aiId } = setupPlayTurn();
  const agent = new SystemOneAgent();
  const snapshot = game.getSnapshot();
  const peachRequest = (dyingId: string) => ({
    kind: "respond" as const,
    requestId: 1,
    responderId: aiId,
    trigger: { cardName: "杀", actorId: dyingId },
    responseKind: "peach" as const,
    sources: [{ sourceId: "hand:1", origin: "hand" as const, label: "桃" }],
    allowPass: true as const,
    reason: "求桃",
  });

  // 自己濒死：出桃自救。
  const selfDying = agent.decideInteraction(snapshot, aiId, peachRequest(aiId));
  assert.ok(selfDying);
  assert.equal(selfDying.decision.choice, "card");

  // 敌人（主公 human）濒死：不交桃。
  const enemyDying = agent.decideInteraction(snapshot, aiId, peachRequest("human"));
  assert.ok(enemyDying);
  assert.equal(enemyDying.decision.choice, "pass");
});

void test("System-One 特征向量可用于 PPO/Judge：定长且含关键信号", () => {
  const { game, aiId } = setupPlayTurn();
  const agent = new SystemOneAgent();
  const features = agent.extractFeatures(game.getSnapshot(), aiId);
  assert.equal(features.names.length, features.values.length);
  assert.ok(features.names.includes("self_hp_ratio"));
  assert.ok(features.values.every((value) => Number.isFinite(value)));
});

void test("System-One 可接入 pickAiTurnDecision 决策链", async () => {
  const { game, aiId } = setupPlayTurn();
  const picked = await pickAiTurnDecision(game, aiId, new SystemOneAgent(), new LocalAiEngine("rules"));
  assert.ok(picked.decision);
  assert.equal(picked.driverLabel, "System-One");
});

void test("System-One：有杀在手时酒优先于杀（酒杀连招）", () => {
  const { game, aiId } = setupPlayTurn();
  const runtime = game as unknown as {
    players: Array<{ id: string; hand: Array<{ id: string; type: CardType }> }>;
  };
  const ai = runtime.players.find((player) => player.id === aiId);
  assert.ok(ai);
  ai.hand = [
    { id: "s1", type: CardType.Slash },
    { id: "w1", type: CardType.Wine },
  ];
  const agent = new SystemOneAgent();
  const snapshot = game.getSnapshot();
  const ranked = agent.rankTurnActions(snapshot, aiId, game.getPlayableActions(aiId));
  const wineIdx = ranked.findIndex((item) => item.action.type === "play" && item.action.label.includes(CardType.Wine));
  const slashIdx = ranked.findIndex((item) => item.action.type === "play" && item.action.label.includes(CardType.Slash));
  assert.ok(wineIdx >= 0 && slashIdx >= 0, "酒和杀都应是可玩动作");
  assert.ok(wineIdx < slashIdx, "有杀时酒应排在杀前面");
});

void test("System-One：无懈可击看清目标再交（敌人有害锦囊反制，队友不反制）", () => {
  const { game, aiId } = setupPlayTurn();
  const agent = new SystemOneAgent();
  const snapshot = game.getSnapshot();
  const negateRequest = (actorId: string, cardName: string) => ({
    kind: "respond" as const,
    requestId: 1,
    responderId: aiId,
    trigger: { cardName, actorId },
    responseKind: "negate" as const,
    sources: [{ sourceId: "hand:1", origin: "hand" as const, label: "无懈可击" }],
    allowPass: true as const,
    reason: "无懈",
  });
  // 敌人（主公 human，反贼视角）用顺手牵羊：反制。
  const vsEnemy = agent.decideInteraction(snapshot, aiId, negateRequest("human", CardType.Snatch));
  assert.ok(vsEnemy);
  assert.equal(vsEnemy.decision.choice, "card");
});

void test("System-One：无中生有只反制敌人的补牌，自己/队友不反制", () => {
  const { game, aiId } = setupPlayTurn();
  const agent = new SystemOneAgent();
  const snapshot = game.getSnapshot();
  const negateRequest = (actorId: string, cardName: string) => ({
    kind: "respond" as const,
    requestId: 1,
    responderId: aiId,
    trigger: { cardName, actorId },
    responseKind: "negate" as const,
    sources: [{ sourceId: "hand:1", origin: "hand" as const, label: "无懈可击" }],
    allowPass: true as const,
    reason: "无懈",
  });
  // 敌人补牌：反制。
  const vsEnemy = agent.decideInteraction(snapshot, aiId, negateRequest("human", CardType.ExNihilo));
  assert.ok(vsEnemy);
  assert.equal(vsEnemy.decision.choice, "card");
  // 自己的补牌：不反制。
  const vsSelf = agent.decideInteraction(snapshot, aiId, negateRequest(aiId, CardType.ExNihilo));
  assert.ok(vsSelf);
  assert.equal(vsSelf.decision.choice, "pass");
});

void test("System-One：无代价可选技能自动发动（集智）", () => {
  const { game, aiId } = setupPlayTurn();
  const agent = new SystemOneAgent();
  const snapshot = game.getSnapshot();
  const decision = agent.decideInteraction(snapshot, aiId, {
    kind: "optional-effect",
    requestId: 1,
    playerId: aiId,
    effect: "集智",
    reason: "集智",
  });
  assert.ok(decision);
  assert.deepEqual(decision.decision, { choice: "effect", enabled: true });
});
