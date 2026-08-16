import assert from "node:assert/strict";
import { test } from "node:test";
import { CardType } from "../engine/cards.js";
import { GameAction, PlayerRole, SanGuoGame } from "../engine/game.js";
import { buildAgentPrompt, buildInteractionPrompt, buildStrategyPrompt, pickReasoningLevel, REASONING_EFFORT, REASONING_THINKING_MULTIPLIER } from "./prompt.js";

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

void test("buildInteractionPrompt：来源列表必须展示真实 sourceId（木牛流马 choose-discard 不再把模型绕住）", async () => {
  const snapshot = await createSnapshot();
  const agent = { playerId: "ai-1", name: "电脑", role: PlayerRole.Rebel, general: "孙策" };
  const sources = [
    { sourceId: "hand:card-aaa", origin: "hand" as const, card: { id: "card-aaa", type: CardType.Slash, color: "red" as const, suit: "spade" as const, rank: 7 }, label: "杀" },
    { sourceId: "treasure:card-bbb", origin: "treasure" as const, card: { id: "card-bbb", type: CardType.Peach, color: "red" as const, suit: "heart" as const, rank: 3 }, label: "桃（木牛流马）" },
  ];
  const request = {
    kind: "choose-discard" as const,
    requestId: 1,
    playerId: "ai-1",
    reason: "木牛流马：选择1张手牌置于其下",
    sources,
    count: 1,
    allowPass: true,
  };
  const prompt = buildInteractionPrompt({
    rulesText: "规则",
    snapshot,
    agent,
    request,
    previousRoundContexts: [],
    reasoningLevel: "normal",
  });
  // 模型必须能看到来源ID，才能输出通过校验的 {"choice":"card","sourceId":"hand:card-aaa"}
  for (const source of sources) {
    assert.ok(prompt.userPrompt.includes(source.sourceId), `提示词应包含来源ID ${source.sourceId}`);
  }
  assert.ok(prompt.userPrompt.includes(sourceTextFor(sources)), "提示词应按 序号.标签（来源ID:xxx） 格式展示来源");
});

const sourceTextFor = (sources: Array<{ sourceId: string; label: string }>): string =>
  sources.map((item, index) => `${index + 1}. ${item.label}（来源ID:${item.sourceId}）`).join("\n");

void test("buildAgentPrompt：有木牛流马动作时注入慎用引导，避免反复置入/取出空转", async () => {
  const snapshot = await createSnapshot();
  const agent = { playerId: "ai-1", name: "电脑", role: PlayerRole.Rebel, general: "孙策" };
  const oxActions: GameAction[] = [
    { type: "play", cardIndex: -11, label: `使用 ${CardType.WoodenOx}（置入1张手牌）`, requiresTarget: false, targets: [] },
    { type: "play", cardIndex: -13, label: `使用 ${CardType.WoodenOx}（取出1张牌）`, requiresTarget: false, targets: [] },
    { type: "end", label: "结束出牌阶段" },
  ];
  const withOx = buildAgentPrompt({
    rulesText: "规则",
    snapshot,
    agent,
    actions: oxActions,
    previousRoundContexts: [],
    reasoningLevel: "normal",
  });
  assert.ok(withOx.userPrompt.includes("反复置入再取出是无意义的空转"), "有木牛流马动作时应提示不要空转");

  const withoutOx = buildAgentPrompt({
    rulesText: "规则",
    snapshot,
    agent,
    actions: gameActions(),
    previousRoundContexts: [],
    reasoningLevel: "normal",
  });
  assert.ok(!withoutOx.userPrompt.includes("反复置入再取出是无意义的空转"), "无木牛流马动作时不应注入该引导");
});

void test("buildStrategyPrompt：复盘契约要求结构化 JSON（execution/lesson/tactical/doctrineUpdate）并注入上次策略记忆", async () => {
  const snapshot = await createSnapshot();
  const agent = { playerId: "ai-1", name: "电脑", role: PlayerRole.Rebel, general: "孙策" };
  const prompt = buildStrategyPrompt({
    rulesText: "规则",
    snapshot,
    agent,
    previousRoundContexts: [{ round: 1, displayLines: ["第 1 回合：甲 的回合"], battlefieldLines: ["r1"] }],
    previousStrategyBlock: "【战略方针·跨回合】3号位是忠臣\n【上回合战术】保留无懈",
  });
  assert.ok(prompt.systemPrompt.includes("输出必须是JSON对象"), "复盘应要求结构化 JSON 输出");
  assert.ok(prompt.systemPrompt.includes('"execution"'), "契约应包含 execution 字段");
  assert.ok(prompt.systemPrompt.includes('"tactical"'), "契约应包含 tactical 字段");
  assert.ok(prompt.systemPrompt.includes('"doctrineUpdate"'), "契约应包含 doctrineUpdate 字段");
  assert.ok(prompt.userPrompt.includes("上次复盘形成的策略记忆"), "应注入上次策略记忆供执行回看");
  assert.ok(prompt.userPrompt.includes("3号位是忠臣"));
  assert.ok(prompt.userPrompt.includes("保留无懈"));

  const firstReview = buildStrategyPrompt({
    rulesText: "规则",
    snapshot,
    agent,
    previousRoundContexts: [],
  });
  assert.ok(firstReview.userPrompt.includes("首次复盘"), "无历史记忆时应提示首次复盘");
});

