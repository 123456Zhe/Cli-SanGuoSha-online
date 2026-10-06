import assert from "node:assert/strict";
import { test } from "node:test";
import { Card, CardType } from "./cards.js";
import {
  InteractionDecision,
  InteractionRequest,
  Player,
  SanGuoGame,
  TurnPhase,
} from "./game.js";

const makeCard = (id: string, type: CardType): Card => ({
  id,
  type,
  color: "red",
  suit: "heart",
  rank: 7,
});

type Runtime = {
  currentPlayerIndex: number;
  players: Player[];
  phase: TurnPhase;
  slashUsedThisTurn: boolean;
  slashPlayedThisTurn: boolean;
};

const setup = async (): Promise<{ game: SanGuoGame; players: [Player, Player, Player] }> => {
  const game = new SanGuoGame(() => 0);
  await game.initNetworkGame(
    [
      { id: "p0", name: "甲" },
      { id: "p1", name: "乙" },
      { id: "p2", name: "丙" },
    ],
    0,
    false,
  );
  const runtime = game as unknown as Runtime;
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
  const [p0, p1, p2] = runtime.players as [Player, Player, Player];
  assert.ok(p0 && p1 && p2);
  return { game, players: [p0, p1, p2] };
};

const playOnlyCard = async (game: SanGuoGame, playerId: string): Promise<string[]> => {
  const action = game.getPlayableActions(playerId).find((item) => item.type === "play");
  assert.ok(action, "应有唯一的出牌动作");
  return game.playAction(playerId, action);
};

/** 有无懈就打出，否则一律 pass（模拟“愿意反制”的响应者）。 */
const negateWhenPossible = (request: InteractionRequest): InteractionDecision => {
  if (request.kind === "respond" && request.responseKind === "negate") {
    const first = request.sources[0];
    return first ? { choice: "card", sourceId: first.sourceId } : { choice: "pass" };
  }
  return { choice: "pass" };
};

void test("无中生有可被其他角色无懈抵消", async () => {
  const { game, players } = await setup();
  const [p0, p1] = players;
  p0.hand = [makeCard("ex", CardType.ExNihilo)];
  p1.hand = [makeCard("wx", CardType.Negate)];
  game.setDecisionHandler(p1.id, negateWhenPossible);

  const logs = await playOnlyCard(game, p0.id);
  assert.equal(p0.hand.length, 0, `被抵消后不应摸牌：${logs.join(" / ")}`);
  assert.equal(p1.hand.length, 0, "应消耗一张无懈可击");
  assert.ok(logs.some((line) => line.includes("打出无懈可击")), logs.join(" / "));
  assert.ok(logs.some((line) => line.includes("被无懈可击抵消")), logs.join(" / "));
  assert.ok(!logs.some((line) => line.includes("摸了")), logs.join(" / "));
});

void test("无人持有无懈时无中生有正常结算（不打扰任何座位）", async () => {
  const { game, players } = await setup();
  const [p0] = players;
  p0.hand = [makeCard("ex", CardType.ExNihilo)];

  const logs = await playOnlyCard(game, p0.id);
  assert.equal(p0.hand.length, 2, logs.join(" / "));
  assert.ok(logs.some((line) => line.includes("摸了 2 张牌")), logs.join(" / "));
});

void test("桃园结义可被无懈整张抵消（无人回血）", async () => {
  const { game, players } = await setup();
  const [p0, p1, p2] = players;
  p0.hp = 2;
  p2.hp = 3;
  p0.hand = [makeCard("pg", CardType.PeachGarden)];
  p1.hand = [makeCard("wx", CardType.Negate)];
  game.setDecisionHandler(p1.id, negateWhenPossible);

  const logs = await playOnlyCard(game, p0.id);
  assert.equal(p0.hp, 2, logs.join(" / "));
  assert.equal(p2.hp, 3, logs.join(" / "));
  assert.ok(logs.some((line) => line.includes("被无懈可击抵消")), logs.join(" / "));
});

void test("五谷丰登按座次询问：下家无无懈则跳过，由再下家抵消", async () => {
  const { game, players } = await setup();
  const [p0, p1, p2] = players;
  p0.hand = [makeCard("hv", CardType.Harvest)];
  p1.hand = [];
  p2.hand = [makeCard("wx", CardType.Negate)];
  game.setDecisionHandler(p2.id, negateWhenPossible);

  const logs = await playOnlyCard(game, p0.id);
  assert.ok(logs.some((line) => line.includes("丙 打出无懈可击")), logs.join(" / "));
  assert.ok(!logs.some((line) => line.includes("摸了")), logs.join(" / "));
  assert.equal(p0.hand.length, 0, logs.join(" / "));
  assert.equal(p1.hand.length, 0, logs.join(" / "));
  assert.equal(p2.hand.length, 0, logs.join(" / "));
});

void test("使用者本人不会被询问自己的全体锦囊", async () => {
  const { game, players } = await setup();
  const [p0] = players;
  p0.hand = [makeCard("ex", CardType.ExNihilo), makeCard("wx", CardType.Negate)];
  let negatePrompts = 0;
  game.setDecisionHandler(p0.id, (request: InteractionRequest): InteractionDecision => {
    if (request.kind === "respond" && request.responseKind === "negate") {
      negatePrompts += 1;
    }
    return { choice: "pass" };
  });

  const logs = await playOnlyCard(game, p0.id);
  assert.equal(negatePrompts, 0, `自己不应响应自己的锦囊：${logs.join(" / ")}`);
  assert.equal(p0.hand.length, 3, logs.join(" / "));
});
