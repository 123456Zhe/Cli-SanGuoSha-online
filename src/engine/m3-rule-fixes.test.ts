import assert from "node:assert/strict";
import { test } from "node:test";
import { Card, CardType } from "./cards.js";
import { InteractionDecision, InteractionRequest, Player, PlayerRole, SanGuoGame, SkillName, TurnPhase } from "./game.js";
import { resolveGeneralByName } from "./generals.js";

type Runtime = { currentPlayerIndex: number; players: Player[]; phase: TurnPhase };

const makeCard = (id: string, type: CardType, suit: Card["suit"] = "heart", rank = 7): Card => ({
  id,
  type,
  color: suit === "spade" || suit === "club" ? "black" : "red",
  suit,
  rank,
});

const approveEffects = (game: SanGuoGame, ids: string[]): void => {
  for (const id of ids) {
    game.setDecisionHandler(
      id,
      (request: InteractionRequest): InteractionDecision =>
        request.kind === "optional-effect" ? { choice: "effect", enabled: true } : { choice: "pass" },
    );
  }
};

const passAll = (game: SanGuoGame, ids: string[]): void => {
  for (const id of ids) {
    game.setDecisionHandler(id, (): InteractionDecision => ({ choice: "pass" }));
  }
};

void test("主公 +1 体力上限：5 人局生效、4 人局不生效", async () => {
  const game5 = new SanGuoGame(() => 0.5);
  await game5.initNetworkGame(
    ["甲", "乙", "丙", "丁", "戊"].map((name, index) => ({ id: `p${index}`, name })),
    4,
    false,
  );
  const lord5 = (game5 as unknown as Runtime).players.find((player) => player.role === PlayerRole.Lord);
  assert.ok(lord5, "5 人局应有主公");
  const base5 = resolveGeneralByName(lord5.general).maxHp;
  assert.equal(lord5.maxHp, base5 + 1, "5 人局主公体力上限应 +1");
  assert.equal(lord5.hp, base5 + 1, "主公初始体力应为加值后的上限");

  const game4 = new SanGuoGame(() => 0.5);
  await game4.initNetworkGame(
    ["甲", "乙", "丙", "丁"].map((name, index) => ({ id: `p${index}`, name })),
    4,
    false,
  );
  const lord4 = (game4 as unknown as Runtime).players.find((player) => player.role === PlayerRole.Lord);
  assert.ok(lord4);
  assert.equal(lord4.maxHp, resolveGeneralByName(lord4.general).maxHp, "4 人局主公体力上限不加");
});

void test("激昂：红色决斗触发，黑色决斗不触发", async () => {
  const runDuel = async (suit: Card["suit"]): Promise<string[]> => {
    const game = new SanGuoGame(() => 0.5);
    await game.initNetworkGame(
      [
        { id: "p0", name: "甲" },
        { id: "p1", name: "乙" },
      ],
      4,
      false,
    );
    const runtime = game as unknown as Runtime;
    for (const player of runtime.players) {
      player.skills = [];
      player.hand = [];
    }
    runtime.currentPlayerIndex = 0;
    runtime.phase = TurnPhase.Play;
    const [me, other] = runtime.players as [Player, Player];
    me.skills = [SkillName.JiAng];
    me.hand = [makeCard("duel", CardType.Duel, suit)];
    approveEffects(game, [me.id, other.id]);
    const action = game
      .getPlayableActions(me.id)
      .find((item) => item.type === "play" && item.label === `使用 ${CardType.Duel}`);
    assert.ok(action, "应能使用决斗");
    return game.playAction(me.id, action, other.id);
  };

  const redLogs = await runDuel("heart");
  assert.ok(redLogs.some((line) => line.includes(SkillName.JiAng)), `红色决斗应触发激昂：${redLogs.join(" / ")}`);

  const blackLogs = await runDuel("spade");
  assert.ok(!blackLogs.some((line) => line.includes(SkillName.JiAng)), `黑色决斗不应触发激昂：${blackLogs.join(" / ")}`);
});

void test("魂姿：回合外掉血到 1 即时觉醒", async () => {
  const game = new SanGuoGame(() => 0.5);
  await game.initNetworkGame(
    [
      { id: "p0", name: "甲" },
      { id: "p1", name: "乙" },
    ],
    4,
    false,
  );
  const runtime = game as unknown as Runtime;
  for (const player of runtime.players) {
    player.skills = [];
    player.hand = [];
  }
  const [me, other] = runtime.players as [Player, Player];
  me.skills = [SkillName.HunZi];
  me.hp = 2;
  const maxBefore = me.maxHp;
  other.hand = [makeCard("slash", CardType.Slash)];
  runtime.currentPlayerIndex = 1;
  runtime.phase = TurnPhase.Play;
  passAll(game, [me.id, other.id]);

  const slash = game
    .getPlayableActions(other.id)
    .find((item) => item.type === "play" && item.label === `使用 ${CardType.Slash}`);
  assert.ok(slash, "乙应能对甲出杀");
  await game.playAction(other.id, slash, me.id);

  assert.equal(me.hp, 1, "甲应被打到 1 体力");
  assert.ok(me.skills.includes(SkillName.YingHun), "掉血到 1 应立即觉醒获得英魂");
  assert.ok(me.skills.includes(SkillName.Heroic), "觉醒应同时获得英姿");
  assert.equal(me.maxHp, maxBefore - 1, "觉醒后体力上限 -1");
});
