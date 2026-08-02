import assert from "node:assert/strict";
import { test } from "node:test";
import { CardType } from "../engine/cards.js";
import { GameAction, PlayerRole, SanGuoGame } from "../engine/game.js";
import { buildAgentPrompt, buildInteractionPrompt, pickReasoningLevel, REASONING_EFFORT, REASONING_THINKING_MULTIPLIER } from "./prompt.js";

const createSnapshot = async (overrides?: Partial<ReturnType<SanGuoGame["getSnapshot"]>>) => {
  const game = new SanGuoGame(() => 0.5);
  await game.initDefaultGame({ aiCount: 1 });
  const snapshot = game.getSnapshot();
  return { ...snapshot, ...overrides };
};

void test("pickReasoningLevel：无濒死/阵亡为 normal；濒死/阵亡时内奸 deep、其余 fast", async () => {
  // 4 人局保证存在内奸
  const game = new SanGuoGame(() => 0.5);
  await game.initDefaultGame({ aiCount: 3 });
  const snapshot = game.getSnapshot();
  assert.equal(pickReasoningLevel(snapshot), "normal");

  const traitor = snapshot.players.find((player) => player.role === PlayerRole.Traitor);
  const nonTraitor = snapshot.players.find((player) => player.role !== PlayerRole.Traitor);
  assert.ok(traitor && nonTraitor, "4 人局应包含内奸与其他角色");

  const dying = {
    ...snapshot,
    players: snapshot.players.map((player, index) => (index === 0 ? { ...player, hp: 0 } : player)),
  };
  assert.equal(pickReasoningLevel(dying, traitor.id), "deep", "濒死时内奸应保持 deep");
  assert.equal(pickReasoningLevel(dying, nonTraitor.id), "fast", "濒死时非内奸应降为 fast");

  const dead = {
    ...snapshot,
    players: snapshot.players.map((player, index) => (index === 0 ? { ...player, alive: false } : player)),
  };
  assert.equal(pickReasoningLevel(dead, traitor.id), "deep");
  assert.equal(pickReasoningLevel(dead, nonTraitor.id), "fast");
});

void test("推理等级映射：fast→low / normal→medium / deep→high 与思考时间系数", () => {
  assert.equal(REASONING_EFFORT.fast, "low");
  assert.equal(REASONING_EFFORT.normal, "medium");
  assert.equal(REASONING_EFFORT.deep, "high");
  assert.equal(REASONING_THINKING_MULTIPLIER.fast, 0.4);
  assert.equal(REASONING_THINKING_MULTIPLIER.normal, 1);
  assert.equal(REASONING_THINKING_MULTIPLIER.deep, 2.5);
});

void test("buildAgentPrompt：上下文轮数动态、含策略笔记与等级指令", async () => {
  const snapshot = await createSnapshot();
  const agent = { playerId: "ai-1", name: "电脑", role: PlayerRole.Rebel, general: "孙策" };
  const previousRoundContexts = [
    { round: 1, displayLines: ["第 1 回合：甲 的回合"], battlefieldLines: ["r1"] },
    { round: 2, displayLines: ["第 2 回合：乙 的回合"], battlefieldLines: ["r2"] },
    { round: 3, displayLines: ["第 3 回合：丙 的回合"], battlefieldLines: ["r3"] },
  ];
  const actions = gameActions();
  const prompt = buildAgentPrompt({
    rulesText: "规则",
    snapshot,
    agent,
    actions,
    previousRoundContexts,
    reasoningLevel: "deep",
    strategyNote: "集火主公，保留闪。",
  });
  assert.ok(prompt.userPrompt.includes("保留最近 3 轮"), "上下文轮数应动态展示");
  assert.ok(prompt.userPrompt.includes("策略笔记"), "应注入策略笔记");
  assert.ok(prompt.userPrompt.includes("集火主公，保留闪。"));
  assert.ok(prompt.systemPrompt.includes("深度思考"), "deep 等级应有深度思考指令");
  assert.ok(prompt.userPrompt.includes('{"actionIndex":1}'), "出牌 JSON 契约应存在");
});

void test("buildInteractionPrompt：respond 含来源牌清单与 JSON 契约", async () => {
  const snapshot = await createSnapshot();
  const prompt = buildInteractionPrompt({
    rulesText: "规则",
    snapshot,
    agent: { playerId: "ai-1", name: "电脑", role: PlayerRole.Rebel, general: "孙策" },
    request: {
      kind: "respond",
      requestId: 1,
      responderId: "ai-1",
      trigger: { cardName: "杀", actorId: "human" },
      responseKind: "dodge",
      sources: [{ sourceId: "hand:c1", origin: "hand", card: { id: "c1", type: CardType.Dodge, color: "red", suit: "heart", rank: 3 }, label: "打出闪" }],
      allowPass: true,
      reason: "杀：是否打出闪？",
    },
    previousRoundContexts: [],
    reasoningLevel: "normal",
  });
  assert.ok(prompt.userPrompt.includes("杀：是否打出闪？"));
  assert.ok(prompt.userPrompt.includes("打出闪"));
  assert.ok(prompt.userPrompt.includes('"choice":"card"'));
  assert.ok(prompt.systemPrompt.includes('"sourceId"'));
});

const gameActions = (): GameAction[] => [
  { type: "play", cardIndex: 0, label: "使用 杀", requiresTarget: true, targets: ["human", "ai-2"] },
  { type: "end", label: "结束回合" },
];

void test("身份遮蔽：他人身份对 AI 显示未知，自己/主公/阵亡可见", async () => {
  // 3 人局：human(主公) + ai-1 + ai-2，确保存在隐藏身份玩家
  const game = new SanGuoGame(() => 0.5);
  await game.initDefaultGame({ aiCount: 2 });
  const snapshot = game.getSnapshot();
  const me = snapshot.players.find((p) => p.id === "ai-1")!;
  const agent = { playerId: me.id, name: me.name, role: me.role, general: me.general };
  const prompt = buildAgentPrompt({
    rulesText: "规则",
    snapshot,
    agent,
    actions: gameActions(),
    previousRoundContexts: [],
    reasoningLevel: "normal",
  });
  // 自己身份可见
  assert.ok(prompt.userPrompt.includes(`身份:${agent.role}`), "AI 自己的身份应可见");
  // 主公与已阵亡玩家身份可见；其余存活玩家身份必须遮蔽为未知
  for (const player of snapshot.players) {
    if (player.id === me.id) {
      continue;
    }
    if (player.role === PlayerRole.Lord || !player.alive) {
      assert.ok(prompt.userPrompt.includes(`${player.name}(${player.id})|身份:${player.role}`), `${player.name} 身份应可见`);
    } else {
      assert.ok(prompt.userPrompt.includes(`${player.name}(${player.id})|身份:未知`), `${player.name} 的身份应遮蔽为未知`);
      assert.ok(!prompt.userPrompt.includes(`${player.name}(${player.id})|身份:${player.role}`), `${player.name} 的真实身份不应泄露`);
    }
  }
});
