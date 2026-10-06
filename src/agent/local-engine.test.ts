import assert from "node:assert/strict";
import { test } from "node:test";
import { CardType } from "../engine/cards.js";
import { Player, PlayerRole, SanGuoGame, SkillName, TurnPhase } from "../engine/game.js";
import { LocalAiEngine } from "./local-engine.js";

const fixedRng = (): number => 0;

void test("本地AI记忆默认保留最近多轮，且可通过 setMaxContextRounds 配置", () => {
  const engine = new LocalAiEngine("rules");
  engine.syncPreviousRounds([
    { round: 1, displayLines: ["第 1 回合：玩家A 的回合"], battlefieldLines: ["r1"] },
    { round: 2, displayLines: ["第 2 回合：玩家B 的回合"], battlefieldLines: ["r2"] },
    { round: 3, displayLines: ["第 3 回合：玩家C 的回合"], battlefieldLines: ["r3"] },
    { round: 4, displayLines: ["第 4 回合：玩家D 的回合"], battlefieldLines: ["r4"] },
  ]);
  assert.equal(engine.getMemorySummary().includes("memoryRounds=1,2,3,4"), true);

  engine.setMaxContextRounds(2);
  engine.syncPreviousRounds([
    { round: 1, displayLines: ["第 1 回合：玩家A 的回合"], battlefieldLines: ["r1"] },
    { round: 2, displayLines: ["第 2 回合：玩家B 的回合"], battlefieldLines: ["r2"] },
    { round: 3, displayLines: ["第 3 回合：玩家C 的回合"], battlefieldLines: ["r3"] },
    { round: 4, displayLines: ["第 4 回合：玩家D 的回合"], battlefieldLines: ["r4"] },
  ]);
  assert.equal(engine.getMemorySummary().includes("memoryRounds=3,4"), true);
});

void test("本地AI会根据近三轮预判闪概率并优先攻击更易命中的敌方", () => {  const game = new SanGuoGame(fixedRng);
  void game.initDefaultGame();
  const runtime = game as unknown as {
    currentPlayerIndex: number;
    phase: TurnPhase;
    players: Array<{
      id: string;
      hp: number;
      hand: Array<{ id: string; type: CardType }>;
    }>;
  };
  const ai1Index = runtime.players.findIndex((player) => player.id === "ai-1");
  const human = runtime.players.find((player) => player.id === "human");
  const ai1 = runtime.players.find((player) => player.id === "ai-1");
  const ai2 = runtime.players.find((player) => player.id === "ai-2");
  assert.ok(ai1Index >= 0);
  assert.ok(human);
  assert.ok(ai1);
  assert.ok(ai2);
  runtime.currentPlayerIndex = ai1Index;
  runtime.phase = TurnPhase.Play;
  human.hp = 2;
  ai2.hp = 2;
  ai1.hand = [{ id: "test-slash", type: CardType.Slash }];
  const engine = new LocalAiEngine("rules");
  engine.syncPreviousRounds([
    {
      round: 2,
      displayLines: ["玩家B 打出闪", "玩家B 打出闪", "玩家B 打出闪"],
      battlefieldLines: [],
    },
    {
      round: 3,
      displayLines: ["玩家B 打出闪"],
      battlefieldLines: [],
    },
    {
      round: 4,
      displayLines: ["玩家A 对 主公 使用杀"],
      battlefieldLines: [],
    },
  ]);
  const decision = engine.decide(game, "ai-1");
  assert.ok(decision);
  assert.equal(decision.action.type, "play");
  assert.equal(decision.targetId, "human");
});

type ThreeRuntime = {
  currentPlayerIndex: number;
  phase: TurnPhase;
  players: Player[];
};

/** 三人局：p0=主公（被测 AI）、p1=忠臣、p2=反贼，全部确定性指定，避免角色猜测引入噪声。 */
const setupThree = async (): Promise<{
  game: SanGuoGame;
  lord: Player;
  ally: Player;
  rebel: Player;
}> => {
  const game = new SanGuoGame(() => 0);
  await game.initNetworkGame(
    [
      { id: "p0", name: "甲" },
      { id: "p1", name: "乙" },
      { id: "p2", name: "丙" },
    ],
    4,
    false,
  );
  const runtime = game as unknown as ThreeRuntime;
  runtime.currentPlayerIndex = 0;
  runtime.phase = TurnPhase.Play;
  const [lord, ally, rebel] = runtime.players as [Player, Player, Player];
  for (const player of runtime.players) {
    player.skills = [];
    player.hand = [];
  }
  lord.role = PlayerRole.Lord;
  lord.isAI = true;
  ally.role = PlayerRole.Loyalist;
  rebel.role = PlayerRole.Rebel;
  return { game, lord, ally, rebel };
};

void test("本地AI按技能目标取向选目标：支援技打自己人、攻击技打敌人", async () => {
  const { game, lord, ally, rebel } = await setupThree();
  lord.hand = [{ id: "dodge", type: CardType.Dodge, color: "red", suit: "heart", rank: 2 }];
  ally.hp = 2;
  rebel.hp = 2;
  const engine = new LocalAiEngine("rules");
  // 让"丙"留下攻击主公的记录，角色猜测才会把它判成反贼（否则零分并列会默认判忠臣）。
  engine.syncPreviousRounds([
    { round: 1, displayLines: ["丙 对 主公 使用杀"], battlefieldLines: [] },
  ]);

  lord.skills = [SkillName.QingNang];
  const support = engine.decide(game, lord.id);
  assert.ok(support, "应能对青囊做出决策");
  assert.equal(support.action.type, "skill");
  assert.equal(support.targetId, ally.id, `青囊（targetIntent=ally）应选受伤的己方：${support.insight}`);

  lord.skills = [SkillName.FanJian];
  const attack = engine.decide(game, lord.id);
  assert.ok(attack, "应能对反间做出决策");
  assert.equal(attack.action.type, "skill");
  assert.equal(attack.targetId, rebel.id, `反间（targetIntent=enemy）应选敌方：${attack.insight}`);
});

void test("本地AI持有本局武将技能文本（与 LLM/Jev 同源）", async () => {
  const { game, lord, ally } = await setupThree();
  lord.hand = [{ id: "dodge", type: CardType.Dodge, color: "red", suit: "heart", rank: 2 }];
  lord.skills = [SkillName.QingNang];
  ally.skills = [SkillName.ZhiHeng];
  const engine = new LocalAiEngine("rules");

  const decision = engine.decide(game, lord.id);
  assert.ok(decision, "应能做出决策");

  const text = engine.getMatchGeneralsText();
  assert.ok(text.includes(SkillName.QingNang), `在场技能应出现：${text}`);
  assert.ok(text.includes(SkillName.ZhiHeng), `在场技能应出现：${text}`);
  assert.ok(!text.includes(SkillName.Roar), `未出场武将的技能不应出现：${text}`);
  assert.ok(engine.getMemorySummary().includes("matchSkills=2"), engine.getMemorySummary());
});


void test("simple 交互：桃只救自己和队友，不救敌人（队友/敌人靠行为推断）", async () => {
  const { game, lord, ally, rebel } = await setupThree();
  const engine = new LocalAiEngine("rules");
  // 身份必须由**可观测行为**推断：乙 救过人（忠臣倾向）、丙 打过主公（反贼倾向）。
  // 引擎不得读 player.role —— 否则 AI 就是明牌作弊（回归测试见文件末尾「交换隐藏身份」用例）。
  engine.syncPreviousRounds([{ round: 1, displayLines: ["乙 使用桃", "丙 对 主公 使用杀"], battlefieldLines: [] }]);
  const peachRequest = (dyingId: string): Parameters<LocalAiEngine["decideInteraction"]>[2] => ({
    kind: "respond",
    requestId: 1,
    responderId: lord.id,
    trigger: { cardName: CardType.Slash, actorId: dyingId },
    responseKind: "peach",
    sources: [{ sourceId: "hand:0", origin: "hand", label: "桃", card: { id: "c1", type: CardType.Peach } as never }],
    allowPass: true,
    reason: "求桃",
  });

  // 自己濒死：出桃自救。
  const self = engine.decideInteraction(game.getSnapshot(), lord.id, peachRequest(lord.id));
  assert.ok(self?.decision && "choice" in self.decision && self.decision.choice === "card", `自救应出桃：${self?.insight}`);

  // 队友（忠臣）濒死：出桃救援。
  const friend = engine.decideInteraction(game.getSnapshot(), lord.id, peachRequest(ally.id));
  assert.ok(friend?.decision && "choice" in friend.decision && friend.decision.choice === "card", `应救队友：${friend?.insight}`);

  // 敌人（反贼）濒死：拒绝。
  const foe = engine.decideInteraction(game.getSnapshot(), lord.id, peachRequest(rebel.id));
  assert.ok(foe?.decision && "choice" in foe.decision && foe.decision.choice === "pass", `不应救敌人：${foe?.insight}`);
});

void test("simple 交互：无懈可击按阵营反制，借刀选手牌最少的敌方（阵营靠行为推断）", async () => {
  const { game, lord, ally, rebel } = await setupThree();
  const engine = new LocalAiEngine("rules");
  engine.syncPreviousRounds([{ round: 1, displayLines: ["乙 使用桃", "丙 对 主公 使用杀"], battlefieldLines: [] }]);
  const snapshot = () => game.getSnapshot();
  const negateRequest = (actorId: string, cardName: string): Parameters<LocalAiEngine["decideInteraction"]>[2] => ({
    kind: "respond",
    requestId: 2,
    responderId: lord.id,
    trigger: { cardName, actorId },
    responseKind: "negate",
    sources: [{ sourceId: "hand:0", origin: "hand", label: "无懈可击", card: { id: "c2", type: CardType.Negate } as never }],
    allowPass: true,
    reason: "无懈可击",
  });

  // 敌方对队友用决斗：反制。
  const againstEnemy = engine.decideInteraction(snapshot(), lord.id, negateRequest(rebel.id, CardType.Duel));
  assert.ok(againstEnemy?.decision && "choice" in againstEnemy.decision && againstEnemy.decision.choice === "card", `敌方有害锦囊应反制：${againstEnemy?.insight}`);

  // 队友用决斗：不反制。
  const againstAlly = engine.decideInteraction(snapshot(), lord.id, negateRequest(ally.id, CardType.Duel));
  assert.ok(againstAlly?.decision && "choice" in againstAlly.decision && againstAlly.decision.choice === "pass", `队友锦囊不应反制：${againstAlly?.insight}`);

  // 借刀杀人：选手牌最少的**敌方**。这里故意让队友手牌更少（1 张）而敌方 2 张——
  // 若 AI 分不清敌我（或读不到身份），它会挑到手牌更少的队友，用例即失败。
  ally.hand = [{ id: "a1", type: CardType.Dodge, color: "red", suit: "heart", rank: 2 }];
  rebel.hand = [
    { id: "r1", type: CardType.Slash, color: "black", suit: "spade", rank: 7 },
    { id: "r2", type: CardType.Slash, color: "black", suit: "club", rank: 9 },
  ];
  const collateral = engine.decideInteraction(snapshot(), lord.id, {
    kind: "collateral",
    requestId: 3,
    targetId: lord.id,
    actorId: rebel.id,
    victims: [ally.id, rebel.id],
    sources: [{ sourceId: "hand:0", origin: "hand", label: "杀" }],
    allowHandOverWeapon: true,
    reason: "借刀杀人",
  });
  assert.ok(
    collateral?.decision && "choice" in collateral.decision && collateral.decision.choice === "target" && collateral.decision.targetId === rebel.id,
    `借刀应指向手牌最少的敌方：${collateral?.insight}`,
  );
});

void test("simple 交互：无中生有只反制敌人的补牌，不反制队友", async () => {
  const { game, lord, ally, rebel } = await setupThree();
  const engine = new LocalAiEngine("rules");
  engine.syncPreviousRounds([{ round: 1, displayLines: ["乙 使用桃", "丙 对 主公 使用杀"], battlefieldLines: [] }]);
  const negateRequest = (actorId: string): Parameters<LocalAiEngine["decideInteraction"]>[2] => ({
    kind: "respond",
    requestId: 4,
    responderId: lord.id,
    trigger: { cardName: CardType.ExNihilo, actorId },
    responseKind: "negate",
    sources: [{ sourceId: "hand:0", origin: "hand", label: "无懈可击", card: { id: "c2", type: CardType.Negate } as never }],
    allowPass: true,
    reason: "无懈可击",
  });

  // 敌人补牌：反制。
  const againstEnemy = engine.decideInteraction(game.getSnapshot(), lord.id, negateRequest(rebel.id));
  assert.ok(againstEnemy?.decision && "choice" in againstEnemy.decision && againstEnemy.decision.choice === "card", `敌人无中生有应反制：${againstEnemy?.insight}`);

  // 队友补牌：不反制。
  const againstAlly = engine.decideInteraction(game.getSnapshot(), lord.id, negateRequest(ally.id));
  assert.ok(againstAlly?.decision && "choice" in againstAlly.decision && againstAlly.decision.choice === "pass", `队友无中生有不应反制：${againstAlly?.insight}`);
});

void test("simple 交互：白嫖技能自动发动，决斗濒死必出杀", async () => {
  const { game, lord, rebel } = await setupThree();
  const engine = new LocalAiEngine("rules");
  const snapshot = () => game.getSnapshot();

  // 集智无代价：自动发动；未知技能保持保守。
  const jizhi = engine.decideInteraction(snapshot(), lord.id, {
    kind: "optional-effect",
    requestId: 4,
    playerId: lord.id,
    effect: "集智",
    reason: "技能",
  });
  assert.ok(jizhi?.decision && "enabled" in jizhi.decision && jizhi.decision.enabled === true, `集智应自动发动：${jizhi?.insight}`);
  const unknown = engine.decideInteraction(snapshot(), lord.id, {
    kind: "optional-effect",
    requestId: 5,
    playerId: lord.id,
    effect: "未知技能",
    reason: "技能",
  });
  assert.ok(unknown?.decision && "enabled" in unknown.decision && unknown.decision.enabled === false, `未知技能应保守不发动：${unknown?.insight}`);

  // 决斗响应：自己 1 血时必出杀。
  lord.hp = 1;
  lord.hand = [{ id: "s1", type: CardType.Slash, color: "black", suit: "spade", rank: 7 }];
  const duel = engine.decideInteraction(snapshot(), lord.id, {
    kind: "respond",
    requestId: 6,
    responderId: lord.id,
    trigger: { cardName: CardType.Duel, actorId: rebel.id },
    responseKind: "slash",
    sources: [{ sourceId: "hand:0", origin: "hand", label: "杀" }],
    allowPass: true,
    reason: "决斗",
  });
  assert.ok(duel?.decision && "choice" in duel.decision && duel.decision.choice === "card", `濒死决斗应出杀：${duel?.insight}`);

  // 弃牌：桃不应被第一个弃掉（价值最低者优先）。
  const discard = engine.decideInteraction(snapshot(), lord.id, {
    kind: "choose-discard",
    requestId: 7,
    playerId: lord.id,
    reason: "弃牌",
    sources: [
      { sourceId: "hand:0", origin: "hand", label: "桃", card: { id: "p1", type: CardType.Peach } as never },
      { sourceId: "hand:1", origin: "hand", label: "杀", card: { id: "s2", type: CardType.Slash } as never },
    ],
    count: 1,
    allowPass: false,
  });
  assert.ok(
    discard?.decision && "choice" in discard.decision && discard.decision.choice === "card" && discard.decision.sourceId === "hand:1",
    `弃牌应弃价值最低的杀而非桃：${discard?.insight}`,
  );
});

/**
 * 信息面回归：AI 决策**不得依赖隐藏身份**。
 *
 * 构造两个"可观测状态完全相同、只有隐藏身份互换"的世界，同一个请求必须得到同一个决策。
 * 修复前 simple 引擎直接读 `player.role`，两个世界会给出相反答案（救/不救），
 * 这在联机里等于给 AI 开天眼。
 */
void test("信息面：交换两名存活玩家的隐藏身份不应改变本地 AI 的决策", async () => {
  const decisions: string[] = [];
  for (const swap of [false, true]) {
    const { game, lord, ally, rebel } = await setupThree();
    const engine = new LocalAiEngine("rules");
    if (swap) {
      // 只互换"隐藏身份"，可观测状态（手牌/体力/武将/公开行为记录）完全不变。
      ally.role = PlayerRole.Rebel;
      rebel.role = PlayerRole.Loyalist;
    }
    const request = (dyingId: string): Parameters<LocalAiEngine["decideInteraction"]>[2] => ({
      kind: "respond",
      requestId: 9,
      responderId: lord.id,
      trigger: { cardName: CardType.Slash, actorId: dyingId },
      responseKind: "peach",
      sources: [{ sourceId: "hand:0", origin: "hand", label: "桃", card: { id: "c9", type: CardType.Peach } as never }],
      allowPass: true,
      reason: "求桃",
    });
    const saved = engine.decideInteraction(game.getSnapshot(), lord.id, request(rebel.id));
    const other = engine.decideInteraction(game.getSnapshot(), lord.id, request(ally.id));
    decisions.push(`${saved?.decision.choice ?? "?"}/${other?.decision.choice ?? "?"}`);
  }
  assert.equal(decisions[0], decisions[1], `隐藏身份不该影响决策：${decisions.join(" vs ")}`);
});

/**
 * 信息面回归（system-one）：`relationOf` 同样不得读隐藏身份。
 */
void test("信息面：system-one 的敌我关系不随隐藏身份变化", async () => {
  const { game, lord, ally, rebel } = await setupThree();
  const { SystemOneAgent } = await import("./system-one.js");
  const agent = new SystemOneAgent();
  const before = [agent.relationOf(lord, ally), agent.relationOf(lord, rebel)].join("/");
  ally.role = PlayerRole.Rebel;
  rebel.role = PlayerRole.Loyalist;
  const after = [agent.relationOf(lord, ally), agent.relationOf(lord, rebel)].join("/");
  assert.equal(before, after, `隐藏身份不该影响敌我判定：${before} vs ${after}`);
  void game;
});
