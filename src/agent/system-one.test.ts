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

void test("System-One 交互决策同步可用：桃响应濒死", () => {
  const { game, aiId } = setupPlayTurn();
  const agent = new SystemOneAgent();
  const snapshot = game.getSnapshot();
  const decision = agent.decideInteraction(snapshot, aiId, {
    kind: "respond",
    requestId: 1,
    responderId: aiId,
    trigger: { cardName: "杀", actorId: "human" },
    responseKind: "peach",
    sources: [{ sourceId: "hand:1", origin: "hand", label: "桃" }],
    allowPass: true,
    reason: "求桃",
  });
  assert.ok(decision);
  assert.equal(decision.decision.choice, "card");
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
