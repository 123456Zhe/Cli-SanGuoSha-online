import assert from "node:assert/strict";
import { test } from "node:test";
import { CardType } from "../engine/cards.js";
import { GameAction, GameSnapshot, PlayerRole, SanGuoGame, TurnPhase } from "../engine/game.js";
import {
  bestActionInstruction,
  buildActionCriteria,
  expandActionCandidates,
  findCandidateIndex,
  JevAdvisor,
  pickActionFromAnswer,
} from "./jev-advisor.js";

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

void test("Jev 不可达时决定层返回 null，不假装决策成功", async () => {
  const advisor = new JevAdvisor("rules", { baseUrl: "http://127.0.0.1:1/v1", model: "jev-test", timeoutMs: 200 });
  const { game, aiId } = setupPlayTurn();
  const snapshot = game.getSnapshot();
  const actions = game.getPlayableActions(aiId);
  assert.ok(actions.length > 0);

  const turn = await advisor.decideTurn(snapshot, aiId, actions);
  assert.equal(turn, null, "Jev 不可用时出牌决定层必须返回 null，交给上层回退本地策略");

  const interaction = await advisor.decideInteraction(snapshot, aiId, {
    kind: "respond",
    requestId: 1,
    responderId: aiId,
    trigger: { cardName: "杀", actorId: "human" },
    responseKind: "peach",
    sources: [{ sourceId: "hand:1", origin: "hand", label: "桃" }],
    allowPass: true,
    reason: "求桃",
  });
  assert.equal(interaction, null, "Jev 不可用时响应决定层必须返回 null，而不是固定放弃（濒死时会白送）");
  assert.ok(advisor.getLastFailureReason(), "应记录 Jev 调用失败原因");
});

void test("JevAdvisor 不做本地预排序，出牌 prompt 不注入快思考摘要", () => {
  const advisor = new JevAdvisor("rules", { baseUrl: "http://127.0.0.1:1/v1" });
  const { game, aiId } = setupPlayTurn();
  const actions = game.getPlayableActions(aiId);
  assert.deepEqual(advisor.rankTurnActions(game.getSnapshot(), aiId, actions), []);
});

void test("候选按动作×目标展开：Jev 选中谁就是谁，不再取 targets[0]", () => {
  const slash = {
    type: "play",
    cardIndex: 0,
    label: "使用杀",
    requiresTarget: true,
    targets: ["lord-1", "rebel-1"],
  } as unknown as GameAction;
  const end = { type: "end", label: "结束出牌阶段" } as GameAction;
  const candidates = expandActionCandidates([slash, end], 40);
  assert.equal(candidates.length, 3);
  assert.equal(candidates[0]?.targetId, "lord-1");
  assert.equal(candidates[1]?.targetId, "rebel-1");
  assert.equal(candidates[2]?.targetId, undefined);
  const criteria = buildActionCriteria(candidates);
  assert.ok(criteria["action_2"]?.includes("rebel-1"), "第二个候选应写死目标");
  // Jev 选 action_2：必须落到 rebel-1，而不是 targets[0] 的主公
  const picked = pickActionFromAnswer(
    { type: "choice", choice: "action_2", probabilities: { action_2: 0.7 }, confidence: 0.7 },
    candidates,
  );
  assert.equal(picked?.targetId, "rebel-1");
  // Judge 的 proposed 映射：{杀, rebel-1} 应定位到 action_2
  assert.equal(findCandidateIndex(candidates, slash, "rebel-1"), 1);
  assert.equal(findCandidateIndex(candidates, slash, "lord-1"), 0);
  assert.equal(findCandidateIndex(candidates, slash, "ghost"), -1);
});

const mockSnapshot = (selfRole: PlayerRole): GameSnapshot =>
  ({
    turn: 3,
    currentPlayerId: "loyal-1",
    phase: "play",
    players: [
      { id: "lord-1", name: "主公甲", role: PlayerRole.Lord, general: "曹操", hp: 4, maxHp: 4, hand: [], alive: true },
      { id: "loyal-1", name: "忠臣乙", role: selfRole, general: "郭嘉", hp: 3, maxHp: 3, hand: [], alive: true },
      { id: "rebel-1", name: "反贼丙", role: PlayerRole.Rebel, general: "吕布", hp: 4, maxHp: 4, hand: [], alive: true },
    ],
  }) as unknown as GameSnapshot;

void test("忠臣视角的 instruction 禁止打主公并点名", () => {
  const text = bestActionInstruction(mockSnapshot(PlayerRole.Loyalist), "loyal-1", []);
  assert.ok(text.includes("主公甲"), "应点出主公名字");
  assert.ok(text.includes("NEVER"), "忠臣不得选打主公的选项");
  assert.ok(text.includes("FIXED target"), "应声明目标不可改");
});

void test("反贼视角的 instruction 把主公标为敌人", () => {
  const text = bestActionInstruction(mockSnapshot(PlayerRole.Rebel), "loyal-1", []);
  assert.ok(!text.includes("NEVER"), "反贼不应被禁打主公");
  assert.ok(text.includes("主公甲") && text.includes("enemy"), "应把主公标为敌人");
});
