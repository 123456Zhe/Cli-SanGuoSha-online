import assert from "node:assert/strict";
import { test } from "node:test";
import { Card, CardType } from "./cards.js";
import { GENERAL_LIBRARY, Player, SanGuoGame, SkillName, TurnPhase } from "./game.js";

const fixedRng = (): number => 0;

const makeCard = (id: string, type: CardType, suit: Card["suit"] = "heart", rank = 7): Card => ({
  id,
  type,
  color: suit === "spade" || suit === "club" ? "black" : "red",
  suit,
  rank,
});

type Runtime = {
  currentPlayerIndex: number;
  players: Player[];
  deck: Card[];
  phase: TurnPhase;
};

const setupNetwork = async (names: string[] = ["甲", "乙"]): Promise<{ game: SanGuoGame; runtime: Runtime }> => {
  const game = new SanGuoGame(fixedRng);
  await game.initNetworkGame(
    names.map((name, index) => ({ id: `p${index}`, name })),
    4,
    false,
  );
  const runtime = game as unknown as Runtime;
  return { game, runtime };
};

const setCurrent = (runtime: Runtime, playerId: string): void => {
  runtime.currentPlayerIndex = runtime.players.findIndex((player) => player.id === playerId);
};

const enterPlay = (runtime: Runtime, playerId: string): void => {
  setCurrent(runtime, playerId);
  runtime.phase = TurnPhase.Play;
};

void test("8 名此前禁用的武将已加入候选池", () => {
  const names = GENERAL_LIBRARY.map((general) => general.name);
  for (const expected of ["曹操", "张辽", "郭嘉", "司马懿", "刘备", "诸葛亮（标准版）", "陆逊", "大乔"]) {
    assert.ok(names.includes(expected), `候选池应包含 ${expected}`);
  }
  const daqiao = GENERAL_LIBRARY.find((general) => general.name === "大乔");
  assert.equal(daqiao?.gender, "女");
  assert.equal(daqiao?.maxHp, 3);
  assert.ok(daqiao?.skills.includes(SkillName.GuoSe));
  assert.ok(daqiao?.skills.includes(SkillName.LiuLi));
});

void test("天妒：郭嘉可获得自己的判定牌", async () => {
  const { game, runtime } = await setupNetwork();
  const me = runtime.players[0]!;
  const target = runtime.players[1]!;
  me.skills = [SkillName.TianDu];
  me.hand = [];
  target.hand = [];
  me.delayedTricks = [{ cardType: CardType.Indulgence, sourcePlayerId: target.id }];
  setCurrent(runtime, me.id);
  game.setOptionalEffectDecision(me.id, SkillName.TianDu, true);
  const logs = await game.startTurn();
  assert.ok(logs.some((line) => line.includes(SkillName.TianDu)));
  // 1 张天妒判定牌 + 2 张摸牌
  assert.equal(me.hand.length, 3);
});

void test("鬼才：司马懿可用手牌替换判定牌", async () => {
  const { game, runtime } = await setupNetwork();
  const me = runtime.players[0]!;
  const target = runtime.players[1]!;
  me.skills = [SkillName.GuiCai];
  me.hand = [makeCard("replace-1", CardType.Slash, "club", 11)];
  target.hand = [];
  me.delayedTricks = [{ cardType: CardType.Indulgence, sourcePlayerId: target.id }];
  setCurrent(runtime, me.id);
  game.setDecisionHandler(me.id, (request) => {
    if (request.kind === "choose-discard") {
      return request.sources[0] ? { choice: "card", sourceId: request.sources[0].sourceId } : { choice: "pass" };
    }
    if (request.kind === "optional-effect") {
      return { choice: "effect", enabled: false };
    }
    return { choice: "pass" };
  });
  const logs = await game.startTurn();
  assert.ok(logs.some((line) => line.includes(SkillName.GuiCai)));
  assert.ok(logs.some((line) => line.includes(CardType.Slash)));
});

void test("突袭：张辽摸牌阶段改为获得其他角色手牌", async () => {
  const { game, runtime } = await setupNetwork(["张辽", "靶子"]);
  const me = runtime.players[0]!;
  const target = runtime.players[1]!;
  me.skills = [SkillName.TuXi];
  me.hand = [];
  target.hand = [makeCard("h1", CardType.Dodge, "club"), makeCard("h2", CardType.Slash, "spade")];
  setCurrent(runtime, me.id);
  const targetBefore = target.hand.length;
  game.setOptionalEffectDecision(me.id, SkillName.TuXi, true);
  const logs = await game.startTurn();
  assert.ok(logs.some((line) => line.includes(SkillName.TuXi)));
  assert.ok(target.hand.length < targetBefore, "张辽应获得目标 1 张手牌");
  assert.equal(me.hand.length, 1, "张辽跳过摸牌，仅获得 1 张手牌");
});

void test("仁德：刘备给出 2 张手牌后回复 1 点体力", async () => {
  const { game, runtime } = await setupNetwork(["刘备", "队友"]);
  const me = runtime.players[0]!;
  const target = runtime.players[1]!;
  me.skills = [SkillName.RenDe];
  me.hp = me.maxHp - 1;
  me.hand = [makeCard("r1", CardType.Dodge, "club"), makeCard("r2", CardType.Slash, "spade")];
  target.hand = [];
  enterPlay(runtime, me.id);
  let givenCount = 0;
  game.setDecisionHandler(me.id, (request) => {
    if (request.kind === "choose-discard") {
      if (givenCount < 2 && request.sources[0]) {
        givenCount += 1;
        return { choice: "card", sourceId: request.sources[0].sourceId };
      }
      return { choice: "pass" };
    }
    return { choice: "pass" };
  });
  const action = game.getPlayableActions(me.id).find((item) => item.type === "skill" && item.skill === SkillName.RenDe)!;
  assert.ok(action);
  const logs = await game.playAction(me.id, action, target.id);
  assert.equal(me.hand.length, 0);
  assert.equal(target.hand.length, 2);
  assert.equal(me.hp, me.maxHp, "累计给出 2 张应回复 1 点体力");
  assert.ok(logs.some((line) => line.includes("回复 1 点体力")));
});

void test("观星：诸葛亮可选择保留在牌堆顶的牌", async () => {
  const { game, runtime } = await setupNetwork(["诸葛亮", "乙"]);
  const me = runtime.players[0]!;
  me.skills = [SkillName.GuanXing];
  me.hand = [];
  runtime.players[1]!.hand = [];
  const topA = makeCard("gx-a", CardType.Slash, "heart");
  const topB = makeCard("gx-b", CardType.Dodge, "spade");
  const rest = [makeCard("gx-c", CardType.Peach, "heart"), makeCard("gx-d", CardType.Negate, "club")];
  runtime.deck = [topA, topB, ...rest];
  setCurrent(runtime, me.id);
  game.setOptionalEffectDecision(me.id, SkillName.GuanXing, true);
  let keptTop = true;
  game.setDecisionHandler(me.id, (request) => {
    if (request.kind === "choose-discard") {
      if (keptTop && request.sources[0]) {
        keptTop = false;
        return { choice: "card", sourceId: request.sources[0].sourceId };
      }
      return { choice: "pass" };
    }
    if (request.kind === "optional-effect") {
      return { choice: "effect", enabled: true };
    }
    return { choice: "pass" };
  });
  const logs = await game.startTurn();
  assert.ok(logs.some((line) => line.includes(SkillName.GuanXing)));
  assert.equal(me.hand[0]?.id, "gx-a", "保留的牌应留在牌堆顶并被先摸到");
  assert.equal(runtime.deck[runtime.deck.length - 1]?.id, "gx-b", "未保留的牌应置于牌堆底");
});

void test("谦逊：陆逊不能成为顺手牵羊与乐不思蜀的目标", async () => {
  const { game, runtime } = await setupNetwork(["陆逊", "盗贼", "路人"]);
  const me = runtime.players[0]!;
  const thief = runtime.players[1]!;
  const third = runtime.players[2]!;
  me.skills = [SkillName.QianXun];
  me.hand = [makeCard("q1", CardType.Slash, "spade")];
  third.hand = [makeCard("t1", CardType.Dodge, "heart")];
  thief.hand = [makeCard("s1", CardType.Snatch, "heart")];
  enterPlay(runtime, thief.id);
  const snatchAction = game.getPlayableActions(thief.id).find(
    (item) => item.type === "play" && item.cardIndex >= 0 && game.getSnapshot().players.find((p) => p.id === thief.id)?.hand[item.cardIndex]?.type === CardType.Snatch,
  );
  assert.ok(snatchAction && snatchAction.type === "play", "应找到顺手牵羊出牌动作");
  assert.ok(!snatchAction.targets.includes(me.id), "陆逊不应出现在顺手牵羊目标中");
  const logs = await game.playAction(thief.id, snatchAction, me.id);
  assert.ok(logs.some((line) => line.includes(SkillName.QianXun)));
  assert.equal(me.hand.length, 1, "谦逊生效后陆逊手牌不应减少");
});

void test("连营：陆逊失去最后手牌时摸一张牌", async () => {
  const { game, runtime } = await setupNetwork(["陆逊", "乙"]);
  const me = runtime.players[0]!;
  me.skills = [SkillName.LianYing];
  me.hp = me.maxHp - 1;
  me.hand = [makeCard("l1", CardType.Peach, "heart")];
  enterPlay(runtime, me.id);
  game.setOptionalEffectDecision(me.id, SkillName.LianYing, true);
  const peachIndex = game.getPlayableActions(me.id).find((item) => item.type === "play")!;
  await game.playAction(me.id, peachIndex, undefined);
  assert.equal(me.hp, me.maxHp, "使用桃应回复体力");
  assert.equal(me.hand.length, 1, "连营应在失去最后手牌后摸 1 张牌");
});

void test("国色：大乔可将方块手牌当乐不思蜀使用", async () => {
  const { game, runtime } = await setupNetwork(["大乔", "目标"]);
  const me = runtime.players[0]!;
  const target = runtime.players[1]!;
  me.skills = [SkillName.GuoSe];
  me.hand = [makeCard("d1", CardType.Slash, "diamond", 5)];
  target.hand = [];
  enterPlay(runtime, me.id);
  const guoSeAction = game.getPlayableActions(me.id).find((item) => item.label.includes(SkillName.GuoSe))!;
  assert.ok(guoSeAction);
  const logs = await game.playAction(me.id, guoSeAction, target.id);
  assert.ok(logs.some((line) => line.includes(SkillName.GuoSe)));
  assert.ok(target.delayedTricks.some((trick) => trick.cardType === CardType.Indulgence));
});

void test("流离：大乔可弃1张牌将杀转移给攻击范围内其他角色", async () => {
  const { game, runtime } = await setupNetwork(["大乔", "攻击者", "第三人"]);
  const me = runtime.players[0]!;
  const attacker = runtime.players[1]!;
  const third = runtime.players[2]!;
  me.skills = [SkillName.LiuLi];
  me.hand = [makeCard("liu1", CardType.Dodge, "club")];
  attacker.hand = [makeCard("s1", CardType.Slash, "spade")];
  third.hand = [];
  enterPlay(runtime, attacker.id);
  game.setDecisionHandler(me.id, (request) => {
    if (request.kind === "choose-discard") {
      return request.sources[0] ? { choice: "card", sourceId: request.sources[0].sourceId } : { choice: "pass" };
    }
    if (request.kind === "collateral") {
      return { choice: "target", targetId: third.id };
    }
    return { choice: "pass" };
  });
  const slashAction = game.getPlayableActions(attacker.id).find((item) => item.type === "play" && item.label.includes(CardType.Slash))!;
  assert.ok(slashAction);
  const logs = await game.playAction(attacker.id, slashAction, me.id);
  assert.ok(logs.some((line) => line.includes(SkillName.LiuLi)));
  assert.equal(me.hand.length, 0, "流离应弃置 1 张牌");
  assert.ok(third.hp < third.maxHp, "转移后的杀应对第三人造成伤害");
});
