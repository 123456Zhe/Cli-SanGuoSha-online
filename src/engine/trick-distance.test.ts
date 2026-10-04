import assert from "node:assert/strict";
import { test } from "node:test";
import { Card, CardType } from "./cards.js";
import { Player, SanGuoGame, SkillName, TurnPhase } from "./game.js";
import type { GameAction } from "./types.js";

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
  phase: TurnPhase;
};

type Setup = {
  game: SanGuoGame;
  me: Player;
  /** 距离 1 的角色 */
  near: Player;
  /** 距离 2 的角色 */
  far: Player;
};

/** 4 人一桌（甲→乙→丙→丁 环形座位）：甲到乙距离 1，甲到丙距离 2 */
const setup = async (): Promise<Setup> => {
  const game = new SanGuoGame(fixedRng);
  await game.initNetworkGame(
    ["甲", "乙", "丙", "丁"].map((name, index) => ({ id: `p${index}`, name })),
    4,
    false,
  );
  const runtime = game as unknown as Runtime;
  for (const player of runtime.players) {
    player.skills = [];
    player.hand = [];
  }
  const me = runtime.players[0]!;
  const near = runtime.players[1]!;
  const far = runtime.players[2]!;
  runtime.currentPlayerIndex = 0;
  runtime.phase = TurnPhase.Play;
  return { game, me, near, far };
};

/** 目标一律不响应无懈可击，避免自动决策干扰断言 */
const passAllResponses = (game: SanGuoGame, playerId: string): void => {
  game.setDecisionHandler(playerId, () => ({ choice: "pass" }));
};

const findUseAction = (
  game: SanGuoGame,
  playerId: string,
  cardType: CardType,
): Extract<GameAction, { type: "play" }> | undefined =>
  game
    .getPlayableActions(playerId)
    .find(
      (item): item is Extract<GameAction, { type: "play" }> =>
        item.type === "play" && item.cardIndex >= 0 && item.label === `使用 ${cardType}`,
    );

void test("顺手牵羊：默认只能对距离 1 以内的角色使用", async () => {
  const { game, me, near, far } = await setup();
  me.hand = [makeCard("s1", CardType.Snatch)];
  near.hand = [makeCard("n1", CardType.Dodge)];
  far.hand = [makeCard("f1", CardType.Dodge)];
  passAllResponses(game, near.id);
  passAllResponses(game, far.id);

  const action = findUseAction(game, me.id, CardType.Snatch);
  assert.ok(action && action.type === "play", "应能找到顺手牵羊出牌动作");
  assert.ok(action.targets.includes(near.id), "距离 1 的角色应可选");
  assert.ok(!action.targets.includes(far.id), "距离 2 的角色不应出现在目标列表");

  // 绕过目标列表直接指定超距目标：应被拒绝且不消耗牌、不搬牌
  const logs = await game.playAction(me.id, action, far.id);
  assert.ok(logs.some((line) => line.includes("超出距离")), `应提示超出距离，实际日志：${logs.join(" / ")}`);
  assert.equal(me.hand.length, 1, "非法目标不应消耗顺手牵羊");
  assert.equal(far.hand.length, 1, "超距目标不应失去牌");
});

void test("顺手牵羊：-1 马把距离 2 的角色拉进合法范围", async () => {
  const { game, me, far } = await setup();
  me.hand = [makeCard("s1", CardType.Snatch)];
  far.hand = [makeCard("f1", CardType.Dodge)];
  me.attackHorse = CardType.ChiTu;
  passAllResponses(game, far.id);

  const action = findUseAction(game, me.id, CardType.Snatch);
  assert.ok(action && action.targets.includes(far.id), "-1 马后距离为 1，目标应合法");
  await game.playAction(me.id, action, far.id);
  assert.equal(far.hand.length, 0, "合法目标应被顺手牵羊拿走 1 张牌");
  assert.equal(me.hand.length, 1, "获得 1 张牌（打出的顺手牵羊已入弃牌堆）");
});

void test("奇才：黄月英使用顺手牵羊无视距离限制", async () => {
  const { game, me, far } = await setup();
  me.skills = [SkillName.QiCai];
  me.hand = [makeCard("s1", CardType.Snatch)];
  far.hand = [makeCard("f1", CardType.Dodge)];
  passAllResponses(game, far.id);

  const action = findUseAction(game, me.id, CardType.Snatch);
  assert.ok(action && action.targets.includes(far.id), "有奇才时距离 2 的角色应可选");
  const logs = await game.playAction(me.id, action, far.id);
  assert.ok(!logs.some((line) => line.includes("超出距离")));
  assert.equal(far.hand.length, 0, "奇才应让顺手牵羊在距离 2 处生效");
});

void test("兵粮寸断：受距离 1 限制，奇才可无视", async () => {
  const { game, me, near, far } = await setup();
  me.hand = [makeCard("b1", CardType.SuppliesCut)];
  passAllResponses(game, near.id);
  passAllResponses(game, far.id);

  const action = findUseAction(game, me.id, CardType.SuppliesCut);
  assert.ok(action && action.type === "play", "应能找到兵粮寸断出牌动作");
  assert.ok(action.targets.includes(near.id), "距离 1 的角色应可选");
  assert.ok(!action.targets.includes(far.id), "距离 2 的角色不应出现在目标列表");

  const blocked = await game.playAction(me.id, action, far.id);
  assert.ok(blocked.some((line) => line.includes("超出距离")));
  assert.equal(far.delayedTricks.length, 0, "超距目标的判定区不应增加兵粮寸断");
  assert.equal(me.hand.length, 1, "非法目标不应消耗兵粮寸断");

  // 同回合内加上奇才后立即可对远目标使用（奇才是锁定技，不消耗出牌次数）
  me.skills = [SkillName.QiCai];
  const actionWithQiCai = findUseAction(game, me.id, CardType.SuppliesCut);
  assert.ok(actionWithQiCai && actionWithQiCai.targets.includes(far.id));
  await game.playAction(me.id, actionWithQiCai, far.id);
  assert.ok(
    far.delayedTricks.some((trick) => trick.cardType === CardType.SuppliesCut),
    "奇才应让兵粮寸断置于距离 2 的判定区",
  );
});

void test("乐不思蜀不受距离限制（奇才不改变其合法性）", async () => {
  const { game, me, far } = await setup();
  me.hand = [makeCard("i1", CardType.Indulgence)];
  passAllResponses(game, far.id);

  const action = findUseAction(game, me.id, CardType.Indulgence);
  assert.ok(action && action.targets.includes(far.id), "乐不思蜀无距离限制，距离 2 也应可选");
});

void test("结算层兜底：直接调用 resolveSnatch 也会拦下超距目标", async () => {
  const { game, me, far } = await setup();
  far.hand = [makeCard("f1", CardType.Dodge)];
  passAllResponses(game, far.id);

  const direct = game as unknown as {
    resolveSnatch(user: Player, target: Player, selectedCardId?: string): Promise<string[]>;
  };
  const logs = await direct.resolveSnatch(me, far);
  assert.ok(logs.some((line) => line.includes("超过 1")), `应有距离不足提示，实际：${logs.join(" / ")}`);
  assert.equal(far.hand.length, 1, "超距目标不应失去牌");
});
