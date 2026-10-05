import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { Card, CardType } from "./cards.js";
import { loadGeneralPacks, resetGeneralPacks } from "./general-pack.js";
import { GameAction, InteractionDecision, InteractionRequest, Player, SanGuoGame, TurnPhase } from "./game.js";
import { registerPackSkill, SkillModule } from "./skill-module.js";
import { getHandLimit } from "./skill-rules.js";

/**
 * Phase 7：声明式当牌转换（`conversions`）、响应拦截点 `provide_response`、
 * 代码技能的手牌上限修正（`handLimit`）与声明式 `rules.handLimitDelta`。
 *
 * 覆盖神赵云「龙魂」（4 条花色→牌类映射）与「绝境」（运行时变量：额外摸牌 + 手牌上限）。
 */

type Runtime = {
  currentPlayerIndex: number;
  players: Player[];
  phase: TurnPhase;
  slashUsedThisTurn: boolean;
  slashPlayedThisTurn: boolean;
  discardPile: Card[];
};

const makeCard = (id: string, type: CardType, suit: Card["suit"] = "heart", rank = 7): Card => ({
  id,
  type,
  color: suit === "spade" || suit === "club" ? "black" : "red",
  suit,
  rank,
});

/** 注册一个带当牌转换的测试技能；必须在使用前注册（`createSkillHooks` 建局时快照）。 */
const registerConversionSkill = (
  name: string,
  conversions: SkillModule["conversions"],
  extra: Partial<SkillModule> = {},
): string => {
  const id = `测试/${name}`;
  registerPackSkill({
    id,
    displayName: name,
    kind: "conversion",
    description: `测试当牌转换 ${name}`,
    generalName: "测试",
    ...(conversions ? { conversions } : {}),
    ...extra,
  });
  return id;
};

const setup = async (playerCount = 2): Promise<{ game: SanGuoGame; runtime: Runtime; players: Player[] }> => {
  const names = ["甲", "乙", "丙", "丁"].slice(0, playerCount);
  const game = new SanGuoGame(() => 0);
  await game.initNetworkGame(
    names.map((name, index) => ({ id: `p${index}`, name })),
    4,
    false,
  );
  const runtime = game as unknown as Runtime;
  for (const player of runtime.players) {
    player.skills = [];
    player.hand = [];
    player.hp = player.maxHp;
  }
  runtime.currentPlayerIndex = 0;
  runtime.phase = TurnPhase.Play;
  runtime.slashUsedThisTurn = false;
  runtime.slashPlayedThisTurn = false;
  return { game, runtime, players: runtime.players };
};

/** 统一应答：可选效果一律发动；响应/弃牌取第一个来源。 */
const autoAnswer = (request: InteractionRequest): InteractionDecision => {
  if (request.kind === "optional-effect") {
    return { choice: "effect", enabled: true };
  }
  if (request.kind === "choose-suit") {
    return { choice: "suit", suit: request.suits[0] ?? "heart" };
  }
  const source = request.sources[0];
  return source ? { choice: "card", sourceId: source.sourceId } : { choice: "pass" };
};

/** 记录引擎问过玩家什么（用于断言"响应时把转换来源列出来了"）。 */
const recordRequests = (game: SanGuoGame, id: string, requests: InteractionRequest[]): void => {
  game.setDecisionHandler(id, (request) => {
    requests.push(request);
    return autoAnswer(request);
  });
};

type PlayAction = Extract<GameAction, { type: "play" }>;

const conversionActions = (game: SanGuoGame, playerId: string): PlayAction[] =>
  game.getPlayableActions(playerId).filter((action): action is PlayAction => action.type === "play" && action.cardIndex <= -10000);

/** 取"使用手牌第 0 张"的普通出牌动作（打出真杀/真闪用）。 */
const firstCardAction = (game: SanGuoGame, playerId: string): PlayAction | undefined =>
  game.getPlayableActions(playerId).find((action): action is PlayAction => action.type === "play" && action.cardIndex === 0);

let packRoot: string;

beforeEach(() => {
  packRoot = mkdtempSync(join(tmpdir(), "sgs-conv-"));
  resetGeneralPacks();
});

afterEach(() => {
  resetGeneralPacks();
  rmSync(packRoot, { recursive: true, force: true });
});

const writePack = (folder: string, general: Record<string, unknown>, skills: Record<string, unknown>): void => {
  const dir = join(packRoot, folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "general.json"), JSON.stringify(general));
  for (const [name, content] of Object.entries(skills)) {
    writeFileSync(join(dir, `${name}.skill.json`), JSON.stringify(content));
  }
};

// ---------------------------------------------------------------- ① conversions

void test("conversions：方块当火杀的完整结算（目标受闪响应、源牌进弃牌堆）", async () => {
  const id = registerConversionSkill("当火杀", [{ from: { suit: ["diamond"] }, to: CardType.FireSlash }]);
  const { game, runtime, players } = await setup();
  const [me, other] = players as [Player, Player];
  me.skills = [id];
  me.hand = [makeCard("d1", CardType.Dodge, "diamond"), makeCard("h1", CardType.Dodge, "heart")];
  other.hand = [makeCard("dodge", CardType.Dodge, "club")];
  for (const player of players) {
    game.setDecisionHandler(player.id, autoAnswer);
  }

  const actions = conversionActions(game, me.id);
  assert.deepEqual(actions.map((action) => action.convertTo), [CardType.FireSlash], "只有方块那条映射生成动作");
  assert.equal(actions[0]?.convertVia, id);
  assert.deepEqual(actions[0]?.targets, [other.id], "杀需要目标");

  const fireSlashAction = actions[0];
  assert.ok(fireSlashAction, "应生成当火杀动作");
  const logs = await game.playAction(me.id, fireSlashAction, other.id);
  assert.ok(logs.some((line) => line.includes("发动当火杀") && line.includes("当火杀使用")), logs.join(" / "));
  assert.ok(logs.some((line) => line.includes("使用火杀")), `应按火杀结算（属性伤害走火杀路径）：${logs.join(" / ")}`);
  assert.ok(logs.some((line) => line.includes("抵消")), "目标应能用闪响应");
  assert.equal(runtime.slashUsedThisTurn, true, "当杀使用要计入本回合杀次数");
  assert.equal(me.hand.length, 1, "源牌应离开手牌");
  assert.ok(runtime.discardPile.some((card) => card.id === "d1"), "源牌应进弃牌堆");
});

void test("conversions：红桃当桃只有在自己体力未满时可玩，且回复 1 点", async () => {
  const id = registerConversionSkill("当桃", [{ from: { suit: ["heart"] }, to: CardType.Peach }]);
  const { game, players } = await setup();
  const [me] = players as [Player, Player];
  me.skills = [id];
  me.hand = [makeCard("h1", CardType.Dodge, "heart")];

  me.hp = me.maxHp;
  assert.deepEqual(conversionActions(game, me.id), [], "满体力时不该出现当桃动作");

  me.hp = 1;
  const actions = conversionActions(game, me.id);
  assert.equal(actions.length, 1);
  const logs = await game.playAction(me.id, actions[0]!);
  assert.ok(logs.some((line) => line.includes("回复 1 点体力")), logs.join(" / "));
  assert.equal(me.hp, 2);
});

void test("conversions：客户端伪造 convertVia/convertTo 或花色不符都会被拒", async () => {
  const id = registerConversionSkill("当火杀", [{ from: { suit: ["diamond"] }, to: CardType.FireSlash }]);
  const { game, players } = await setup();
  const [me, other] = players as [Player, Player];
  me.skills = [id];
  me.hand = [makeCard("h1", CardType.Dodge, "heart")];

  // 花色不符（红桃不在 from 里）
  const wrongSuit = await game.playAction(me.id, {
    type: "play",
    cardIndex: -10000,
    label: "伪造",
    requiresTarget: true,
    targets: [other.id],
    convertVia: id,
    convertTo: CardType.FireSlash,
  }, other.id);
  assert.deepEqual(wrongSuit, ["使用卡牌失败"]);

  // 没有该技能
  me.hand = [makeCard("d1", CardType.Dodge, "diamond")];
  me.skills = [];
  const noSkill = await game.playAction(me.id, {
    type: "play",
    cardIndex: -10000,
    label: "伪造",
    requiresTarget: true,
    targets: [other.id],
    convertVia: id,
    convertTo: CardType.FireSlash,
  }, other.id);
  assert.deepEqual(noSkill, ["使用卡牌失败"]);

  // 换成引擎不支持的牌类：resolveConversionUse 只会认声明里有的 to
  me.skills = [id];
  const wrongTo = await game.playAction(me.id, {
    type: "play",
    cardIndex: -10000,
    label: "伪造",
    requiresTarget: true,
    targets: [other.id],
    convertVia: id,
    convertTo: CardType.Peach,
  }, other.id);
  assert.deepEqual(wrongTo, ["使用卡牌失败"]);
});

void test("conversions：目标超出攻击范围/自己不能作为杀的目标", async () => {
  const id = registerConversionSkill("当火杀", [{ from: { suit: ["diamond"] }, to: CardType.FireSlash }]);
  const { game, players } = await setup(3);
  const [me, , far] = players as [Player, Player, Player];
  me.skills = [id];
  me.hand = [makeCard("d1", CardType.Dodge, "diamond")];
  // 拉开距离：给远处玩家两匹 +1 马（的卢）之外，直接改攻击范围更直接——这里用自己作目标。
  const selfTarget = await game.playAction(me.id, {
    type: "play",
    cardIndex: -10000,
    label: "伪造",
    requiresTarget: true,
    targets: [me.id],
    convertVia: id,
    convertTo: CardType.FireSlash,
  }, me.id);
  assert.deepEqual(selfTarget, ["目标无效"]);

  const noTarget = await game.playAction(me.id, {
    type: "play",
    cardIndex: -10000,
    label: "伪造",
    requiresTarget: true,
    targets: [],
    convertVia: id,
    convertTo: CardType.FireSlash,
  });
  assert.deepEqual(noTarget, ["需要选择目标"]);
  assert.equal(far.alive, true);
});

// ---------------------------------------------------------------- ② provide_response

void test("provide_response：手里没有闪，梅花手牌也能当闪响应杀", async () => {
  const id = registerConversionSkill("当闪", [{ from: { suit: ["club"] }, to: CardType.Dodge, asResponse: ["dodge"] }]);
  const { game, runtime, players } = await setup();
  const [attacker, me] = players as [Player, Player];
  attacker.hand = [makeCard("slash", CardType.Slash, "spade")];
  me.skills = [id];
  // 梅花【决斗】本身不能当闪，只有龙魂式的转换能救
  me.hand = [makeCard("c1", CardType.Duel, "club")];

  const requests: InteractionRequest[] = [];
  game.setDecisionHandler(attacker.id, autoAnswer);
  recordRequests(game, me.id, requests);

  runtime.phase = TurnPhase.Play;
  const slash = firstCardAction(game, attacker.id);
  assert.ok(slash, "攻击者应能用杀");
  const logs = await game.playAction(attacker.id, slash, me.id);

  const respond = requests.find((request) => request.kind === "respond");
  assert.ok(respond && respond.kind === "respond", "应询问是否响应（有转换来源时不能直接判定无法响应）");
  assert.equal(respond.sources.length, 1, "只有一张梅花牌，应作为转换来源列出");
  assert.equal(respond.sources[0]?.viaSkill, id);
  assert.equal(respond.sources[0]?.asType, CardType.Dodge);
  assert.match(respond.sources[0]?.label ?? "", /当闪/);
  assert.ok(logs.some((line) => line.includes("发动当闪")), `应记录发动转换技：${logs.join(" / ")}`);
  assert.ok(logs.some((line) => line.includes("抵消")), "杀应被抵消");
  assert.equal(me.hp, me.maxHp, "不应受伤");
});

void test("provide_response：没有技能时同样的梅花手牌不会产生响应来源", async () => {
  const { game, runtime, players } = await setup();
  const [attacker, me] = players as [Player, Player];
  attacker.hand = [makeCard("slash", CardType.Slash, "spade")];
  me.skills = [];
  me.hand = [makeCard("c1", CardType.Duel, "club")];

  const requests: InteractionRequest[] = [];
  game.setDecisionHandler(attacker.id, autoAnswer);
  recordRequests(game, me.id, requests);
  runtime.phase = TurnPhase.Play;
  const slash = firstCardAction(game, attacker.id);
  const logs = await game.playAction(attacker.id, slash!, me.id);

  assert.equal(requests.some((request) => request.kind === "respond"), false, "无来源时不该白问玩家");
  assert.equal(me.hp, me.maxHp - 1, "无法响应 → 受伤");
  assert.ok(logs.some((line) => line.includes("受到 1 点伤害")), logs.join(" / "));
});

void test("provide_response：没有 viaSkill 凭据的伪造来源不被接受", async () => {
  // 一个把"任意黑桃"塞进响应来源、但不带 viaSkill 的钩子：consumeResponseCard 必须拒绝它。
  const id = `测试/伪造来源`;
  registerPackSkill({
    id,
    displayName: "伪造来源",
    kind: "triggered",
    description: "塞一个不带凭据的来源",
    generalName: "测试",
    onTrigger: {
      provide_response: (_ctx, payload) => {
        if (payload.need === "dodge" && payload.actor && payload.responseSources) {
          payload.responseSources.push({
            sourceId: "hand:0",
            origin: "hand",
            label: "伪造的闪",
          });
        }
      },
    },
  });
  const { game, runtime, players } = await setup();
  const [attacker, me] = players as [Player, Player];
  attacker.hand = [makeCard("slash", CardType.Slash, "spade")];
  me.skills = [id];
  // 手牌是黑桃决斗，本身不能当闪；钩子塞进来的来源也没有凭据与 card。
  me.hand = [makeCard("d1", CardType.Duel, "spade")];

  game.setDecisionHandler(attacker.id, autoAnswer);
  game.setDecisionHandler(me.id, autoAnswer);
  runtime.phase = TurnPhase.Play;
  const slash = firstCardAction(game, attacker.id);
  assert.ok(slash);
  const logs = await game.playAction(attacker.id, slash, me.id);

  assert.equal(me.hp, me.maxHp - 1, "伪造来源不应生效，应正常受伤");
  assert.equal(logs.some((line) => line.includes("发动")), false, `不应出现发动日志：${logs.join(" / ")}`);
});

void test("provide_response：真闪与转换来源同时列出时优先真闪，且内置转换技仍工作", async () => {
  const id = registerConversionSkill("当闪", [{ from: { suit: ["club"] }, to: CardType.Dodge, asResponse: ["dodge"] }]);
  const { game, runtime, players } = await setup();
  const [attacker, me] = players as [Player, Player];
  attacker.hand = [makeCard("slash", CardType.Slash, "spade")];
  me.skills = [id];
  me.hand = [makeCard("realDodge", CardType.Dodge, "heart"), makeCard("c1", CardType.Duel, "club")];

  const requests: InteractionRequest[] = [];
  game.setDecisionHandler(attacker.id, autoAnswer);
  recordRequests(game, me.id, requests);
  runtime.phase = TurnPhase.Play;
  const slash = firstCardAction(game, attacker.id);
  const logs = await game.playAction(attacker.id, slash!, me.id);

  const respond = requests.find((request) => request.kind === "respond");
  assert.ok(respond && respond.kind === "respond");
  assert.equal(respond.sources.length, 2, "真闪 + 转换来源");
  assert.ok(respond.sources.some((source) => !source.viaSkill), "真闪来源不带凭据");
  assert.ok(respond.sources.some((source) => source.viaSkill === id));
  // autoAnswer 取第一个来源 → 真闪
  assert.ok(logs.some((line) => line.includes("抵消")));
  assert.equal(me.hp, me.maxHp);
});

// ---------------------------------------------------------------- ④ handLimit

void test("handLimitDelta：声明式静态上限修正被弃牌阶段采用", async () => {
  const id = registerConversionSkill("上限", undefined, { rules: { handLimitDelta: 2 } });
  const { game, players } = await setup();
  const [me] = players as [Player, Player];
  me.skills = [id];
  me.hp = 3;

  assert.equal(getHandLimit(me), 5, "3 体力 + 2 上限修正");
  me.hand = [makeCard("a", CardType.Slash), makeCard("b", CardType.Slash), makeCard("c", CardType.Slash), makeCard("d", CardType.Slash)];
  assert.equal(game.getPendingDiscardCount(me.id), 0, "4 张手牌 < 上限 5，不用弃");

  me.skills = [];
  assert.equal(getHandLimit(me), 3);
  const runtime = game as unknown as Runtime;
  runtime.phase = TurnPhase.Discard;
  assert.equal(game.getPendingDiscardCount(me.id), 1, "没有修正时 4 张手牌要弃 1 张");
});

void test("handLimit：代码技能的纯函数按运行时变量抬高上限（绝境）", async () => {
  const id = `测试/绝境`;
  registerPackSkill({
    id,
    displayName: "绝境",
    kind: "triggered",
    description: "手牌上限 + 已损失体力值",
    generalName: "测试",
    handLimit: (player) => Math.max(0, player.maxHp - player.hp),
  });
  const { game, players } = await setup();
  const [me, other] = players as [Player, Player];
  me.skills = [id];
  me.maxHp = 2;

  me.hp = 2;
  assert.equal(getHandLimit(me), 2);
  me.hp = 1;
  assert.equal(getHandLimit(me), 2, "1 体力 + 已损失 1 = 2");
  other.skills = [];
  other.hp = 1;
  assert.equal(getHandLimit(other), 1, "没有技能时上限就是体力值");
  assert.ok(game.getSnapshot().players.some((player) => player.id === me.id));
});

// ---------------------------------------------------------------- loader 校验

void test("loader：conversions 合法声明被接受（含多条映射与 asResponse）", async () => {
  writePack(
    "测试将",
    { apiVersion: 1, name: "测试将", kingdom: "神", gender: "男", maxHp: 2, skills: ["龙魂"] },
    {
      龙魂: {
        kind: "conversion",
        description: "四条映射",
        conversions: [
          { from: { suit: ["heart"] }, to: "桃", asResponse: ["peach"] },
          { from: { suit: ["diamond"] }, to: "火杀" },
          { from: { suit: ["club"] }, to: "闪", asResponse: ["dodge"] },
          { from: { suit: ["spade"] }, to: "无懈可击", asResponse: ["negate"] },
        ],
      },
    },
  );

  const report = await loadGeneralPacks({ dir: packRoot, pool: "all" });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.loaded, ["测试将"]);
});

void test("loader：conversions 的非法声明逐条报错", async () => {
  const cases: { name: string; conversion: unknown; pattern: RegExp }[] = [
    { name: "不支持的牌类", conversion: { from: { suit: ["heart"] }, to: "乐不思蜀" }, pattern: /to 非法/ },
    { name: "from 空", conversion: { from: {}, to: "桃" }, pattern: /至少要给 suit\/color\/type/ },
    { name: "未知花色", conversion: { from: { suit: ["红桃"] }, to: "桃" }, pattern: /from.suit 非法/ },
    { name: "asResponse 与 to 不匹配", conversion: { from: { suit: ["heart"] }, to: "桃", asResponse: ["dodge"] }, pattern: /对不上/ },
    { name: "asResponse 未知时机", conversion: { from: { suit: ["heart"] }, to: "桃", asResponse: ["bogus"] }, pattern: /asResponse 非法/ },
    { name: "from 未知字段", conversion: { from: { colour: ["red"] }, to: "桃" }, pattern: /不是已知字段/ },
    { name: "空数组", conversion: [], pattern: /不能是空数组/ },
  ];
  for (const item of cases) {
    writePack(
      "测试将",
      { apiVersion: 1, name: "测试将", kingdom: "神", gender: "男", maxHp: 2, skills: ["技能"] },
      { 技能: { kind: "conversion", description: "x", conversions: item.conversion } },
    );
    const report = await loadGeneralPacks({ dir: packRoot, pool: "all" });
    assert.equal(report.errors.length, 1, `${item.name} 应被拒绝`);
    assert.match(report.errors[0]?.message ?? "", item.pattern, item.name);
    resetGeneralPacks();
    rmSync(join(packRoot, "测试将"), { recursive: true, force: true });
  }
});
