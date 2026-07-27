import assert from "node:assert/strict";
import test from "node:test";
import { CardType } from "./cards.js";
import { InteractionRequest, SanGuoGame, SkillName } from "./game.js";

type RuntimePlayer = {
  id: string;
  hp: number;
  maxHp: number;
  skills: never[];
  hand: Array<{ id: string; type: CardType; color: "red" | "black"; suit?: string; rank?: number }>;
  weapon: CardType | null;
  armor: CardType | null;
  treasure: CardType | null;
  treasureCards: Array<{ id: string; type: CardType; color: "red" | "black"; suit?: string; rank?: number }>;
};

type Runtime = { currentPlayerIndex: number; players: RuntimePlayer[] };

const createGame = async (aiCount: number) => {
  const game = new SanGuoGame(() => 0.5);
  await game.initDefaultGame({ aiCount });
  const runtime = game as unknown as Runtime;
  for (const player of runtime.players) {
    player.skills = [];
    player.armor = null;
    player.weapon = null;
  }
  const human = runtime.players.find((player) => player.id === "human")!;
  const ai1 = runtime.players.find((player) => player.id === "ai-1")!;
  return { game, runtime, human, ai1 };
};

void test("借刀杀人：目标可选择出杀并指定攻击对象", async () => {
  const { game, runtime, human, ai1 } = await createGame(2);
  const ai2 = runtime.players.find((player) => player.id === "ai-2")!;
  human.hand = [{ id: "c1", type: CardType.Collateral, color: "red" }];
  ai1.hand = [{ id: "s1", type: CardType.Slash, color: "red" }];
  ai1.weapon = CardType.Crossbow;
  ai2.hand = [];
  runtime.currentPlayerIndex = runtime.players.indexOf(human);
  const requests: InteractionRequest[] = [];
  game.setDecisionHandler(ai1.id, (request) => {
    requests.push(request);
    return { choice: "target", targetId: ai2.id };
  });
  const action = game.getPlayableActions(human.id).find((item) => item.label.includes(CardType.Collateral))!;
  await game.playAction(human.id, action, ai1.id);
  assert.equal(requests[0]?.kind, "collateral");
  assert.ok(requests[0].kind === "collateral" && requests[0].victims.includes(ai2.id));
  assert.equal(ai1.weapon, CardType.Crossbow);
  assert.ok(ai2.hp < ai2.maxHp);
});

void test("借刀杀人：目标可选择交出武器", async () => {
  const { game, runtime, human, ai1 } = await createGame(2);
  runtime.players.find((player) => player.id === "ai-2")!.hand = [];
  human.hand = [{ id: "c1", type: CardType.Collateral, color: "red" }];
  ai1.hand = [{ id: "s1", type: CardType.Slash, color: "red" }];
  ai1.weapon = CardType.Crossbow;
  runtime.currentPlayerIndex = runtime.players.indexOf(human);
  game.setDecisionHandler(ai1.id, () => ({ choice: "pass" }));
  const action = game.getPlayableActions(human.id).find((item) => item.label.includes(CardType.Collateral))!;
  await game.playAction(human.id, action, ai1.id);
  assert.equal(ai1.weapon, null);
  assert.ok(human.hand.some((card) => card.type === CardType.Crossbow));
});

void test("决斗：目标回击后轮到发起者时逐次询问是否出杀", async () => {
  const { game, runtime, human, ai1 } = await createGame(1);
  human.hand = [
    { id: "d1", type: CardType.Duel, color: "red" },
    { id: "hs1", type: CardType.Slash, color: "black" },
  ];
  ai1.hand = [
    { id: "s1", type: CardType.Slash, color: "red" },
    { id: "s2", type: CardType.Slash, color: "black" },
  ];
  runtime.currentPlayerIndex = runtime.players.indexOf(human);
  const requests: InteractionRequest[] = [];
  game.setDecisionHandler(human.id, (request) => {
    requests.push(request);
    return { choice: "pass" };
  });
  const action = game.getPlayableActions(human.id).find((item) => item.label.includes(CardType.Duel))!;
  await game.playAction(human.id, action, ai1.id);
  assert.equal(requests.length, 1);
  assert.ok(requests[0]?.kind === "respond" && requests[0].responseKind === "slash");
  assert.ok(human.hp < human.maxHp);
});

void test("藤甲：万箭齐发与普通杀不触发响应请求", async () => {
  const { game, runtime, human, ai1 } = await createGame(1);
  human.hand = [{ id: "a1", type: CardType.ArrowRain, color: "red" }];
  ai1.armor = CardType.VineArmor;
  ai1.hand = [{ id: "dg", type: CardType.Dodge, color: "red" }];
  runtime.currentPlayerIndex = runtime.players.indexOf(human);
  let asked = 0;
  game.setDecisionHandler(ai1.id, () => {
    asked += 1;
    return { choice: "pass" };
  });
  const action = game.getPlayableActions(human.id).find((item) => item.label.includes(CardType.ArrowRain))!;
  await game.playAction(human.id, action);
  assert.equal(asked, 0);
  assert.equal(ai1.hp, ai1.maxHp);
});

void test("木牛流马：内部牌可作为响应牌使用", async () => {
  const { game, runtime, human, ai1 } = await createGame(1);
  human.treasure = CardType.WoodenOx;
  human.treasureCards = [{ id: "oxdodge", type: CardType.Dodge, color: "red" }];
  human.hand = [];
  ai1.hand = [{ id: "as1", type: CardType.Slash, color: "red" }];
  runtime.currentPlayerIndex = runtime.players.indexOf(ai1);
  const requests: InteractionRequest[] = [];
  game.setDecisionHandler(human.id, (request) => {
    requests.push(request);
    return { choice: "card", sourceId: "treasure:oxdodge" };
  });
  const action = game.getPlayableActions(ai1.id).find((item) => /使用 (火)?杀$/.test(item.label))!;
  await game.playAction(ai1.id, action, human.id);
  assert.equal(requests.length, 1);
  assert.ok(requests[0]?.kind === "respond" && requests[0].sources.some((source) => source.origin === "treasure"));
  assert.equal(human.treasureCards.length, 0);
  assert.equal(human.hp, human.maxHp);
});

void test("木牛流马：出牌阶段可取回内部牌", async () => {
  const { game, runtime, human } = await createGame(1);
  human.treasure = CardType.WoodenOx;
  human.treasureCards = [{ id: "ox1", type: CardType.Peach, color: "red" }];
  human.hand = [{ id: "h1", type: CardType.Negate, color: "black" }];
  runtime.currentPlayerIndex = runtime.players.indexOf(human);
  game.setDecisionHandler(human.id, (request) =>
    request.kind === "choose-discard" && request.sources[0]
      ? { choice: "card", sourceId: request.sources[0].sourceId }
      : { choice: "pass" },
  );
  const action = game.getPlayableActions(human.id).find((item) => item.type === "play" && item.cardIndex === -13);
  assert.ok(action);
  await game.playAction(human.id, action);
  assert.ok(human.hand.some((card) => card.type === CardType.Peach));
  assert.equal(human.treasureCards.length, 0);
});

void test("反间：目标可声明花色并从周瑜手牌中匿名自选一张", async () => {
  const { game, runtime, human, ai1 } = await createGame(1);
  (human as { skills: SkillName[] }).skills = [SkillName.FanJian];
  human.hand = [
    { id: "fj1", type: CardType.Slash, color: "red", suit: "diamond" },
    { id: "fj2", type: CardType.Dodge, color: "black", suit: "club" },
  ];
  ai1.hand = [];
  runtime.currentPlayerIndex = runtime.players.indexOf(human);
  const requests: InteractionRequest[] = [];
  game.setDecisionHandler(ai1.id, (request) => {
    requests.push(request);
    if (request.kind === "choose-suit") {
      return { choice: "suit", suit: "heart" };
    }
    if (request.kind === "choose-discard") {
      const picked = request.sources.find((source) => source.sourceId === "hand:fj2");
      return picked ? { choice: "card", sourceId: picked.sourceId } : { choice: "pass" };
    }
    return { choice: "pass" };
  });
  const action = game.getPlayableActions(human.id).find((item) => item.type === "skill" && item.skill === SkillName.FanJian);
  assert.ok(action);
  const hpBefore = ai1.hp;
  await game.playAction(human.id, action, ai1.id);
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.kind, "choose-suit");
  assert.ok(requests[1]?.kind === "choose-discard" && requests[1].sources.every((source) => source.label.includes("手牌")));
  assert.ok(ai1.hand.some((card) => card.id === "fj2"));
  assert.ok(human.hand.length === 1 && human.hand[0]?.id === "fj1");
  assert.equal(ai1.hp, hpBefore - 1);
});
