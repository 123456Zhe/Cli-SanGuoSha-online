import assert from "node:assert/strict";
import { test } from "node:test";
import { Card, CardType } from "./cards.js";
import {
  GameAction,
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
  turn: number;
};

const setupOx = async (): Promise<{ game: SanGuoGame; runtime: Runtime; p0: Player }> => {
  const game = new SanGuoGame(() => 0);
  await game.initNetworkGame(
    [
      { id: "p0", name: "甲" },
      { id: "p1", name: "乙" },
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
  const [p0] = runtime.players as [Player, Player];
  assert.ok(p0);
  p0.treasure = CardType.WoodenOx;
  p0.hand = [makeCard("a", CardType.Dodge)];
  // 置入/取出都要过 choose-discard 选牌：一律选第一个来源
  game.setDecisionHandler(p0.id, (request: InteractionRequest): InteractionDecision => {
    if (request.kind === "choose-discard") {
      const first = request.sources[0];
      return first ? { choice: "card", sourceId: first.sourceId } : { choice: "pass" };
    }
    return { choice: "pass" };
  });
  return { game, runtime, p0 };
};

const findAction = (game: SanGuoGame, pid: string, cardIndex: number): GameAction | undefined =>
  game.getPlayableActions(pid).find((action) => action.type === "play" && action.cardIndex === cardIndex);

void test("木牛流马：本回合置入的牌本回合不能取出", async () => {
  const { game, p0 } = await setupOx();
  const store = findAction(game, p0.id, -11);
  assert.ok(store, "应能置入");
  const storeLogs = await game.playAction(p0.id, store);
  assert.ok(storeLogs.some((line) => line.includes("置于")), storeLogs.join(" / "));
  assert.equal(p0.treasureCards.length, 1);

  // 同回合：取出动作不应出现，直接调 -13 也应被拒绝
  assert.equal(findAction(game, p0.id, -13), undefined, "同回合不应提供取出");
  const takeLogs = await game.playAction(p0.id, { type: "play", cardIndex: -13 } as GameAction);
  assert.ok(takeLogs.some((line) => line.includes("无法从")), takeLogs.join(" / "));
  assert.equal(p0.treasureCards.length, 1, "同回合直接调用也不应取出");
});

void test("木牛流马：跨回合取出不受影响", async () => {
  const { game, runtime, p0 } = await setupOx();
  const store = findAction(game, p0.id, -11);
  assert.ok(store);
  await game.playAction(p0.id, store);
  runtime.turn += 1;
  const take = findAction(game, p0.id, -13);
  assert.ok(take, "跨回合应能取出");
  const takeLogs = await game.playAction(p0.id, take);
  assert.ok(takeLogs.some((line) => line.includes("取出")), takeLogs.join(" / "));
  assert.equal(p0.treasureCards.length, 0);
  assert.equal(p0.hand.length, 1);
});

void test("局面重复检测：相同局面再次出现即返回 true", async () => {
  const { game, p0 } = await setupOx();
  game.beginAiTurnProgress();
  // 紧接着再记一次：局面没变，应判重复
  assert.equal(game.noteAiTurnProgress(), true);
  // 局面变化（掉血）后：新局面，返回 false
  p0.hp -= 1;
  assert.equal(game.noteAiTurnProgress(), false);
  // 恢复到见过的局面：再次判重复
  p0.hp += 1;
  assert.equal(game.noteAiTurnProgress(), true);
  // 新一轮观察：旧记录清空，不再误报
  game.beginAiTurnProgress();
  assert.equal(game.noteAiTurnProgress(), true, "begin 后紧接着记同局面应判重复");
});

void test("局面重复检测：经真实置入/取出回到原局面即判重复", async () => {
  const { game, p0 } = await setupOx();
  game.setDecisionHandler(p0.id, (request: InteractionRequest): InteractionDecision => {
    if (request.kind === "choose-discard") {
      const first = request.sources[0];
      return first ? { choice: "card", sourceId: first.sourceId } : { choice: "pass" };
    }
    return { choice: "pass" };
  });
  game.beginAiTurnProgress();
  const store = findAction(game, p0.id, -11);
  assert.ok(store);
  await game.playAction(p0.id, store);
  assert.equal(game.noteAiTurnProgress(), false, "置入后是新局面");
  // 手动把牌拿回手牌（绕过本回合取出限制，还原初始局面）
  const stored = p0.treasureCards.splice(0, p0.treasureCards.length);
  p0.hand.push(...stored);
  assert.equal(game.noteAiTurnProgress(), true, "回到初始局面应判重复");
});
