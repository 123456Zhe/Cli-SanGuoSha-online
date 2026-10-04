import assert from "node:assert/strict";
import { test } from "node:test";
import { CardType } from "../engine/cards.js";
import { SanGuoGame, TurnPhase } from "../engine/game.js";
import { JevAdvisor } from "./jev-advisor.js";

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

void test("Jev 不可达时放行 LLM 决策，不否决也不抛异常", async () => {
  // 指向必然连不上的地址，模拟 Jev 服务不可用
  const advisor = new JevAdvisor("rules", { baseUrl: "http://127.0.0.1:1/v1", model: "jev-test", timeoutMs: 200 });
  const { game, aiId } = setupPlayTurn();
  const snapshot = game.getSnapshot();
  const actions = game.getPlayableActions(aiId);
  assert.ok(actions.length > 0);

  const verdict = await advisor.judgeTurnDecision(snapshot, aiId, actions, { action: actions[0] as never });
  assert.equal(verdict.accepted, true, "Jev 不可用时不应否决 LLM 决策");
  assert.equal(verdict.fallback, undefined);
  assert.ok(advisor.getLastFailureReason(), "应记录 Jev 调用失败原因");
  assert.equal(advisor.getStats().judgeFailures >= 1, true);

  const interactionOk = await advisor.judgeInteractionDecision(snapshot, aiId, {
    kind: "respond",
    requestId: 1,
    responderId: aiId,
    trigger: { cardName: "杀", actorId: "human" },
    responseKind: "peach",
    sources: [{ sourceId: "hand:1", origin: "hand", label: "桃" }],
    allowPass: true,
    reason: "求桃",
  }, { choice: "card", sourceId: "hand:1" });
  assert.equal(interactionOk, true, "Jev 不可用时交互决策应放行");
});

void test("JevAdvisor 不做本地预排序，出牌 prompt 不注入快思考摘要", () => {
  const advisor = new JevAdvisor("rules", { baseUrl: "http://127.0.0.1:1/v1" });
  const { game, aiId } = setupPlayTurn();
  const actions = game.getPlayableActions(aiId);
  assert.deepEqual(advisor.rankTurnActions(game.getSnapshot(), aiId, actions), []);
});
