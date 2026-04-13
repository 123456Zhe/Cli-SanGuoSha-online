import { test } from "node:test";
import assert from "node:assert/strict";
import { CARD_LIBRARY, CardType, createDeck } from "./cards.js";
import { PlayerRole, SanGuoGame, SkillName } from "./game.js";

const fixedRng = (): number => 0;

void test("初始化后主公先手且进入出牌阶段", () => {
  const game = new SanGuoGame(fixedRng);
  game.initDefaultGame();
  const snapshot = game.getSnapshot();
  assert.equal(snapshot.currentPlayerId, "human");
  assert.equal(snapshot.phase, "出牌阶段");
  assert.equal(snapshot.players.length, 3);
});

void test("使用杀会造成伤害或被闪抵消", () => {
  const game = new SanGuoGame(fixedRng);
  game.initDefaultGame();
  const before = game.getSnapshot();
  const human = before.players.find((item) => item.id === "human");
  const slashIndex = human?.hand.findIndex((card) => card.type === CardType.Slash) ?? -1;
  assert.ok(slashIndex >= 0);
  const actions = game.getPlayableActions("human");
  const slashAction = actions.find(
    (action) => action.type === "play" && action.cardIndex === slashIndex,
  );
  assert.ok(slashAction && slashAction.type === "play");
  game.playAction("human", slashAction, "ai-1");
  const after = game.getSnapshot();
  const target = after.players.find((item) => item.id === "ai-1");
  assert.ok(target);
  assert.ok(target.hp <= 4);
});

void test("用户结束出牌阶段后可进入交互弃牌并继续下一玩家", () => {
  const game = new SanGuoGame(fixedRng);
  game.initDefaultGame();
  const endAction = game.getPlayableActions("human").find((action) => action.type === "end");
  assert.ok(endAction);
  game.playAction("human", endAction);
  assert.equal(game.getSnapshot().currentPlayerId, "human");
  assert.equal(game.getSnapshot().phase, "弃牌阶段");
  while (game.getPendingDiscardCount("human") > 0) {
    const options = game.getDiscardOptions("human");
    assert.ok(options.length > 0);
    game.discardForCurrentPlayer("human", options[0]?.handIndex ?? 0);
  }
  const snapshot = game.getSnapshot();
  assert.equal(snapshot.currentPlayerId, "ai-1");
  assert.equal(snapshot.phase, "出牌阶段");
});

void test("支持自定义 AI 数量与初始手牌", () => {
  const game = new SanGuoGame(fixedRng);
  game.initDefaultGame({ aiCount: 4, openingHandCount: 3, humanName: "刘备" });
  const snapshot = game.getSnapshot();
  assert.equal(snapshot.players.length, 5);
  const human = snapshot.players.find((item) => item.id === "human");
  assert.equal(human?.name, "刘备");
  assert.equal(human?.hand.length, 6);
});

void test("支持配置人数、身份与武将", () => {
  const game = new SanGuoGame(fixedRng);
  game.initDefaultGame({
    playerCount: 6,
    humanRole: PlayerRole.Rebel,
    humanGeneral: "曹仁",
    humanName: "测试玩家",
    openingHandCount: 3,
  });
  const snapshot = game.getSnapshot();
  assert.equal(snapshot.players.length, 6);
  const human = snapshot.players.find((item) => item.id === "human");
  assert.ok(human);
  assert.equal(human.name, "测试玩家");
  assert.equal(human.role, PlayerRole.Rebel);
  assert.equal(human.general, "曹仁");
  assert.ok(human.skills.includes(SkillName.Guard));
  const current = snapshot.players.find((item) => item.id === snapshot.currentPlayerId);
  assert.equal(current?.role, PlayerRole.Lord);
});

void test("AI 武将会随机且一局内不重复（包含不与玩家武将重复）", () => {
  const game = new SanGuoGame(() => 0);
  game.initDefaultGame({
    playerCount: 6,
    humanGeneral: "曹仁",
  });
  const snapshot = game.getSnapshot();
  const generalNames = snapshot.players.map((player) => player.general);
  const uniqueNames = new Set(generalNames);
  assert.equal(uniqueNames.size, generalNames.length);
});

void test("6人局默认身份配比符合推荐", () => {
  const game = new SanGuoGame(fixedRng);
  game.initDefaultGame({ playerCount: 6 });
  const snapshot = game.getSnapshot();
  const rebels = snapshot.players.filter((item) => item.role === PlayerRole.Rebel).length;
  const loyalists = snapshot.players.filter((item) => item.role === PlayerRole.Loyalist).length;
  const traitors = snapshot.players.filter((item) => item.role === PlayerRole.Traitor).length;
  const lords = snapshot.players.filter((item) => item.role === PlayerRole.Lord).length;
  assert.equal(lords, 1);
  assert.equal(rebels, 3);
  assert.equal(loyalists, 1);
  assert.equal(traitors, 1);
});

void test("人数上限约束为6人", () => {
  const game = new SanGuoGame(fixedRng);
  game.initDefaultGame({ playerCount: 20 });
  const snapshot = game.getSnapshot();
  assert.equal(snapshot.players.length, 6);
});

void test("初始化参数会被约束到安全范围", () => {
  const game = new SanGuoGame(fixedRng);
  game.initDefaultGame({ aiCount: 0, openingHandCount: 20 });
  const snapshot = game.getSnapshot();
  assert.equal(snapshot.players.length, 2);
  const human = snapshot.players.find((item) => item.id === "human");
  assert.ok(human);
  assert.equal(human.hand.length, 9);
});

void test("主公携带武将技能并在摸牌阶段触发英姿", () => {
  const game = new SanGuoGame(fixedRng);
  game.initDefaultGame({ openingHandCount: 3 });
  const snapshot = game.getSnapshot();
  const human = snapshot.players.find((item) => item.id === "human");
  assert.ok(human);
  assert.equal(human.general, "孙策");
  assert.ok(human.skills.includes(SkillName.Heroic));
  assert.ok(human.skills.includes(SkillName.Assault));
  assert.equal(human.hand.length, 6);
});

void test("强袭可用且每回合仅可发动一次", () => {
  const game = new SanGuoGame(fixedRng);
  game.initDefaultGame();
  const before = game.getSnapshot();
  const humanBefore = before.players.find((item) => item.id === "human");
  const targetBefore = before.players.find((item) => item.id === "ai-1");
  assert.ok(humanBefore);
  assert.ok(targetBefore);
  const skillAction = game
    .getPlayableActions("human")
    .find((action) => action.type === "skill" && action.skill === SkillName.Assault);
  assert.ok(skillAction);
  game.playAction("human", skillAction, "ai-1");
  const after = game.getSnapshot();
  const humanAfter = after.players.find((item) => item.id === "human");
  const targetAfter = after.players.find((item) => item.id === "ai-1");
  assert.ok(humanAfter);
  assert.ok(targetAfter);
  assert.equal(humanAfter.hand.length, humanBefore.hand.length - 1);
  assert.equal(targetAfter.hp, targetBefore.hp - 1);
  const secondSkill = game
    .getPlayableActions("human")
    .find((action) => action.type === "skill" && action.skill === SkillName.Assault);
  assert.equal(secondSkill, undefined);
});

void test("坚守会在每回合首次受伤时令伤害-1", () => {
  const game = new SanGuoGame(fixedRng);
  game.initDefaultGame({ aiCount: 4 });
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hp: number;
      skills: SkillName[];
    }>;
  };
  const scriptedTarget = runtime.players.find((item) => item.id === "ai-1");
  assert.ok(scriptedTarget);
  scriptedTarget.skills = [SkillName.Guard];
  const before = game.getSnapshot();
  const targetBefore = before.players.find((item) => item.id === "ai-1");
  assert.ok(targetBefore);
  const skillAction = game
    .getPlayableActions("human")
    .find((action) => action.type === "skill" && action.skill === SkillName.Assault);
  assert.ok(skillAction);
  const logs = game.playAction("human", skillAction, "ai-1");
  const after = game.getSnapshot();
  const targetAfter = after.players.find((item) => item.id === "ai-1");
  assert.ok(targetAfter);
  assert.equal(targetAfter.hp, targetBefore.hp);
  assert.ok(logs.some((line) => line.includes(SkillName.Guard)));
});

void test("无中生有无需目标且可摸2张牌", () => {
  const game = new SanGuoGame(fixedRng);
  game.initDefaultGame();
  const runtime = game as unknown as { players: Array<{ id: string; hand: Array<{ id: string; type: CardType }> }> };
  const human = runtime.players.find((item) => item.id === "human");
  assert.ok(human);
  human.hand = [{ id: "test-exnihilo", type: CardType.ExNihilo }];
  const action = game
    .getPlayableActions("human")
    .find((item) => item.type === "play" && item.label.includes(CardType.ExNihilo));
  assert.ok(action && action.type === "play");
  assert.equal(action.requiresTarget, false);
  game.playAction("human", action);
  const snapshot = game.getSnapshot();
  const humanAfter = snapshot.players.find((item) => item.id === "human");
  assert.ok(humanAfter);
  assert.equal(humanAfter.hand.length, 2);
});

void test("南蛮入侵会要求其他角色打出杀，否则受到伤害", () => {
  const game = new SanGuoGame(fixedRng);
  game.initDefaultGame();
  const runtime = game as unknown as {
    players: Array<{ id: string; hp: number; hand: Array<{ id: string; type: CardType }> }>;
  };
  const human = runtime.players.find((item) => item.id === "human");
  const ai1 = runtime.players.find((item) => item.id === "ai-1");
  const ai2 = runtime.players.find((item) => item.id === "ai-2");
  assert.ok(human);
  assert.ok(ai1);
  assert.ok(ai2);
  human.hand = [{ id: "test-barbarian", type: CardType.Barbarian }];
  ai1.hand = [{ id: "test-slash", type: CardType.Slash }];
  ai2.hand = [];
  const action = game
    .getPlayableActions("human")
    .find((item) => item.type === "play" && item.label.includes(CardType.Barbarian));
  assert.ok(action && action.type === "play");
  assert.equal(action.requiresTarget, false);
  const ai2HpBefore = ai2.hp;
  game.playAction("human", action);
  const snapshot = game.getSnapshot();
  const ai1After = snapshot.players.find((item) => item.id === "ai-1");
  const ai2After = snapshot.players.find((item) => item.id === "ai-2");
  assert.ok(ai1After);
  assert.ok(ai2After);
  assert.equal(ai1After.hp, 4);
  assert.equal(ai1After.hand.length, 0);
  assert.equal(ai2After.hp, ai2HpBefore - 1);
});

void test("无懈可击会抵消指定目标的锦囊", () => {
  const game = new SanGuoGame(fixedRng);
  game.initDefaultGame();
  const runtime = game as unknown as {
    players: Array<{ id: string; hand: Array<{ id: string; type: CardType }> }>;
  };
  const human = runtime.players.find((item) => item.id === "human");
  const ai1 = runtime.players.find((item) => item.id === "ai-1");
  assert.ok(human);
  assert.ok(ai1);
  human.hand = [{ id: "test-dismantle", type: CardType.Dismantle }];
  ai1.hand = [
    { id: "test-negate", type: CardType.Negate },
    { id: "test-peach", type: CardType.Peach },
  ];
  const action = game
    .getPlayableActions("human")
    .find((item) => item.type === "play" && item.label.includes(CardType.Dismantle));
  assert.ok(action && action.type === "play");
  game.playAction("human", action, "ai-1");
  const snapshot = game.getSnapshot();
  const ai1After = snapshot.players.find((item) => item.id === "ai-1");
  assert.ok(ai1After);
  assert.equal(ai1After.hand.length, 1);
  assert.equal(ai1After.hand[0]?.type, CardType.Peach);
});

void test("过河拆桥可选择装备牌或随机手牌", () => {
  const game = new SanGuoGame(fixedRng);
  game.initDefaultGame();
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hand: Array<{ id: string; type: CardType }>;
      weapon: CardType | null;
    }>;
  };
  const human = runtime.players.find((item) => item.id === "human");
  const ai1 = runtime.players.find((item) => item.id === "ai-1");
  assert.ok(human);
  assert.ok(ai1);
  human.hand = [{ id: "test-dismantle", type: CardType.Dismantle }];
  ai1.hand = [
    { id: "target-slash", type: CardType.Slash },
    { id: "target-peach", type: CardType.Peach },
  ];
  ai1.weapon = CardType.Crossbow;
  const action = game
    .getPlayableActions("human")
    .find((item) => item.type === "play" && item.label.includes(CardType.Dismantle));
  assert.ok(action && action.type === "play");
  const options = game.getRemovableCardOptions("ai-1");
  const randomHandOption = options.find((item) => item.id === "hand-random");
  const hasExposedHandCard = options.some((item) => item.id.startsWith("hand:"));
  assert.ok(randomHandOption);
  assert.equal(hasExposedHandCard, false);
  game.playAction("human", action, "ai-1", randomHandOption.id);
  const snapshot = game.getSnapshot();
  const ai1After = snapshot.players.find((item) => item.id === "ai-1");
  assert.ok(ai1After);
  assert.equal(ai1After.hand.length, 1);
  const remainedCardId = ai1After.hand[0]?.id;
  assert.ok(remainedCardId === "target-slash" || remainedCardId === "target-peach");
  assert.equal(ai1After.weapon, CardType.Crossbow);
});

void test("桃园结义会为存活角色回复体力", () => {
  const game = new SanGuoGame(fixedRng);
  game.initDefaultGame();
  const runtime = game as unknown as {
    players: Array<{ id: string; hp: number; hand: Array<{ id: string; type: CardType }> }>;
  };
  const human = runtime.players.find((item) => item.id === "human");
  const ai1 = runtime.players.find((item) => item.id === "ai-1");
  assert.ok(human);
  assert.ok(ai1);
  human.hp = 2;
  ai1.hp = 3;
  human.hand = [{ id: "test-peach-garden", type: CardType.PeachGarden }];
  const action = game
    .getPlayableActions("human")
    .find((item) => item.type === "play" && item.label.includes(CardType.PeachGarden));
  assert.ok(action && action.type === "play");
  assert.equal(action.requiresTarget, false);
  game.playAction("human", action);
  const snapshot = game.getSnapshot();
  const humanAfter = snapshot.players.find((item) => item.id === "human");
  const ai1After = snapshot.players.find((item) => item.id === "ai-1");
  assert.ok(humanAfter);
  assert.ok(ai1After);
  assert.equal(humanAfter.hp, 3);
  assert.equal(ai1After.hp, 4);
});

void test("五谷丰登会让所有存活角色各摸1张牌", () => {
  const game = new SanGuoGame(fixedRng);
  game.initDefaultGame();
  const runtime = game as unknown as {
    players: Array<{ id: string; hand: Array<{ id: string; type: CardType }> }>;
  };
  const human = runtime.players.find((item) => item.id === "human");
  assert.ok(human);
  human.hand = [{ id: "test-harvest", type: CardType.Harvest }];
  const before = game.getSnapshot();
  const action = game
    .getPlayableActions("human")
    .find((item) => item.type === "play" && item.label.includes(CardType.Harvest));
  assert.ok(action && action.type === "play");
  game.playAction("human", action);
  const after = game.getSnapshot();
  const beforeTotal = before.players.reduce((sum, item) => sum + item.hand.length, 0);
  const afterTotal = after.players.reduce((sum, item) => sum + item.hand.length, 0);
  assert.equal(afterTotal, beforeTotal + after.players.length - 1);
});

void test("诸葛连弩可突破每回合一次杀限制", () => {
  const game = new SanGuoGame(fixedRng);
  game.initDefaultGame();
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hand: Array<{ id: string; type: CardType }>;
      weapon: CardType.Crossbow | null;
    }>;
    slashUsedThisTurn: boolean;
  };
  const human = runtime.players.find((item) => item.id === "human");
  assert.ok(human);
  human.hand = [{ id: "test-slash", type: CardType.Slash }];
  human.weapon = CardType.Crossbow;
  runtime.slashUsedThisTurn = true;
  const slashAction = game
    .getPlayableActions("human")
    .find((item) => item.type === "play" && item.label.includes(CardType.Slash));
  assert.ok(slashAction);
});

void test("八卦阵可在成为杀目标时自动抵消", () => {
  const game = new SanGuoGame(() => 0);
  game.initDefaultGame();
  const runtime = game as unknown as {
    currentPlayerIndex: number;
    players: Array<{
      id: string;
      hp: number;
      hand: Array<{ id: string; type: CardType }>;
      armor: CardType.EightDiagram | null;
    }>;
  };
  const human = runtime.players.find((item) => item.id === "human");
  const ai1 = runtime.players.find((item) => item.id === "ai-1");
  assert.ok(human);
  assert.ok(ai1);
  human.hand = [{ id: "test-eight-diagram", type: CardType.EightDiagram }];
  const equipAction = game
    .getPlayableActions("human")
    .find((item) => item.type === "play" && item.label.includes(CardType.EightDiagram));
  assert.ok(equipAction && equipAction.type === "play");
  game.playAction("human", equipAction);
  ai1.hand = [{ id: "test-ai-slash", type: CardType.Slash }];
  runtime.currentPlayerIndex = runtime.players.findIndex((item) => item.id === "ai-1");
  const before = game.getSnapshot();
  const humanBefore = before.players.find((item) => item.id === "human");
  assert.ok(humanBefore);
  const slashAction = game
    .getPlayableActions("ai-1")
    .find((item) => item.type === "play" && item.label.includes(CardType.Slash));
  assert.ok(slashAction && slashAction.type === "play");
  const logs = game.playAction("ai-1", slashAction, "human");
  const after = game.getSnapshot();
  const humanAfter = after.players.find((item) => item.id === "human");
  assert.ok(humanAfter);
  assert.equal(humanAfter.hp, humanBefore.hp);
  assert.ok(logs.some((line) => line.includes("八卦阵")));
});

void test("卡牌库与武将库可供前端直接渲染", () => {
  const game = new SanGuoGame(fixedRng);
  const cardLibrary = game.getCardLibrary();
  const generalLibrary = game.getGeneralLibrary();
  assert.ok(cardLibrary.length > 0);
  assert.ok(generalLibrary.length >= 4);
  assert.ok(cardLibrary.some((item) => item.type === CardType.Slash && item.count === 24));
  assert.ok(cardLibrary.some((item) => item.type === CardType.ExNihilo && item.count === 4));
  assert.ok(cardLibrary.some((item) => item.type === CardType.Barbarian && item.count === 2));
  assert.ok(cardLibrary.some((item) => item.type === CardType.Negate && item.count === 4));
  assert.ok(cardLibrary.some((item) => item.type === CardType.PeachGarden && item.count === 2));
  assert.ok(cardLibrary.some((item) => item.type === CardType.Harvest && item.count === 2));
  assert.ok(cardLibrary.some((item) => item.type === CardType.Crossbow && item.count === 1));
  assert.ok(cardLibrary.some((item) => item.type === CardType.QinggangSword && item.count === 1));
  assert.ok(cardLibrary.some((item) => item.type === CardType.GudingBlade && item.count === 1));
  assert.ok(cardLibrary.some((item) => item.type === CardType.EightDiagram && item.count === 1));
  assert.ok(cardLibrary.some((item) => item.type === CardType.RenwangShield && item.count === 1));
  assert.ok(generalLibrary.some((item) => item.name === "曹仁"));
});

void test("青釭剑可无视仁王盾并造成伤害", () => {
  const game = new SanGuoGame(() => 0);
  game.initDefaultGame();
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hp: number;
      hand: Array<{ id: string; type: CardType }>;
      armor: CardType | null;
      weapon: CardType | null;
    }>;
  };
  const human = runtime.players.find((item) => item.id === "human");
  const ai1 = runtime.players.find((item) => item.id === "ai-1");
  assert.ok(human);
  assert.ok(ai1);
  human.hand = [
    { id: "test-qinggang", type: CardType.QinggangSword },
    { id: "test-slash", type: CardType.Slash },
  ];
  ai1.hand = [];
  ai1.armor = CardType.RenwangShield;
  const equipAction = game
    .getPlayableActions("human")
    .find((item) => item.type === "play" && item.label.includes(CardType.QinggangSword));
  assert.ok(equipAction && equipAction.type === "play");
  game.playAction("human", equipAction);
  const slashAction = game
    .getPlayableActions("human")
    .find((item) => item.type === "play" && item.label.includes(CardType.Slash));
  assert.ok(slashAction && slashAction.type === "play");
  const before = game.getSnapshot();
  const aiBefore = before.players.find((item) => item.id === "ai-1");
  assert.ok(aiBefore);
  game.playAction("human", slashAction, "ai-1");
  const after = game.getSnapshot();
  const aiAfter = after.players.find((item) => item.id === "ai-1");
  assert.ok(aiAfter);
  assert.equal(aiAfter.hp, aiBefore.hp - 1);
});

void test("古锭刀会对无手牌目标的杀造成额外伤害", () => {
  const game = new SanGuoGame(() => 0.9);
  game.initDefaultGame();
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hp: number;
      hand: Array<{ id: string; type: CardType }>;
      weapon: CardType | null;
    }>;
  };
  const human = runtime.players.find((item) => item.id === "human");
  const ai1 = runtime.players.find((item) => item.id === "ai-1");
  assert.ok(human);
  assert.ok(ai1);
  human.hand = [
    { id: "test-guding", type: CardType.GudingBlade },
    { id: "test-slash", type: CardType.Slash },
  ];
  ai1.hand = [];
  const equipAction = game
    .getPlayableActions("human")
    .find((item) => item.type === "play" && item.label.includes(CardType.GudingBlade));
  assert.ok(equipAction && equipAction.type === "play");
  game.playAction("human", equipAction);
  const slashAction = game
    .getPlayableActions("human")
    .find((item) => item.type === "play" && item.label.includes(CardType.Slash));
  assert.ok(slashAction && slashAction.type === "play");
  const before = game.getSnapshot();
  const aiBefore = before.players.find((item) => item.id === "ai-1");
  assert.ok(aiBefore);
  game.playAction("human", slashAction, "ai-1");
  const after = game.getSnapshot();
  const aiAfter = after.players.find((item) => item.id === "ai-1");
  assert.ok(aiAfter);
  assert.equal(aiAfter.hp, aiBefore.hp - 2);
});

void test("createDeck 不会重复生成新的卡牌实体", () => {
  const first = createDeck();
  const second = createDeck();
  assert.equal(first[0], CARD_LIBRARY[0]);
  assert.equal(second[0], CARD_LIBRARY[0]);
  assert.notEqual(first, second);
});

void test("木牛流马可存牌并将宝物移动给其他角色", () => {
  const game = new SanGuoGame(() => 0);
  game.initDefaultGame();
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hand: Array<{ id: string; type: CardType }>;
      treasure: CardType | null;
      treasureCards: Array<{ id: string; type: CardType }>;
    }>;
  };
  const human = runtime.players.find((item) => item.id === "human");
  assert.ok(human);
  human.hand = [
    { id: "test-ox", type: CardType.WoodenOx },
    { id: "test-peach", type: CardType.Peach },
  ];
  const equip = game
    .getPlayableActions("human")
    .find((item) => item.type === "play" && item.label.includes(CardType.WoodenOx) && item.cardIndex >= 0);
  assert.ok(equip && equip.type === "play");
  game.playAction("human", equip);
  const store = game
    .getPlayableActions("human")
    .find((item) => item.type === "play" && item.label.includes("置入1张手牌"));
  assert.ok(store && store.type === "play");
  game.playAction("human", store);
  assert.equal(human.treasureCards.length, 1);
  const move = game
    .getPlayableActions("human")
    .find((item) => item.type === "play" && item.label.includes("移动给其他角色"));
  assert.ok(move && move.type === "play");
  game.playAction("human", move, "ai-1");
  const ai1 = runtime.players.find((item) => item.id === "ai-1");
  assert.ok(ai1);
  assert.equal(human.treasure, null);
  assert.equal(ai1.treasure, CardType.WoodenOx);
  assert.equal(ai1.treasureCards.length, 1);
});

void test("空城会阻止自己成为杀的目标", () => {
  const game = new SanGuoGame(() => 0);
  game.initDefaultGame({ aiCount: 2, humanGeneral: "张飞" });
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hand: Array<{ id: string; type: CardType }>;
      skills: SkillName[];
    }>;
  };
  const human = runtime.players.find((item) => item.id === "human");
  const ai1 = runtime.players.find((item) => item.id === "ai-1");
  const ai2 = runtime.players.find((item) => item.id === "ai-2");
  assert.ok(human);
  assert.ok(ai1);
  assert.ok(ai2);
  human.hand = [{ id: "test-slash", type: CardType.Slash }];
  ai1.hand = [];
  ai1.skills = [SkillName.KongCheng];
  ai2.hand = [];
  const slashAction = game
    .getPlayableActions("human")
    .find((item) => item.type === "play" && item.label.includes(CardType.Slash));
  assert.ok(slashAction && slashAction.type === "play");
  assert.ok(!slashAction.targets.includes("ai-1"));
  assert.ok(slashAction.targets.includes("ai-2"));
});

void test("裸衣会减少摸牌并提升杀造成的伤害", () => {
  const game = new SanGuoGame(() => 0);
  game.initDefaultGame({ humanGeneral: "许褚", openingHandCount: 4 });
  const before = game.getSnapshot();
  const humanBefore = before.players.find((item) => item.id === "human");
  const ai1Before = before.players.find((item) => item.id === "ai-1");
  assert.ok(humanBefore);
  assert.ok(ai1Before);
  assert.equal(humanBefore.hand.length, 5);
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hand: Array<{ id: string; type: CardType }>;
    }>;
  };
  const human = runtime.players.find((item) => item.id === "human");
  const ai1 = runtime.players.find((item) => item.id === "ai-1");
  assert.ok(human);
  assert.ok(ai1);
  human.hand = [{ id: "test-luoyi-slash", type: CardType.Slash }];
  ai1.hand = [];
  const slashAction = game
    .getPlayableActions("human")
    .find((item) => item.type === "play" && item.label.includes(CardType.Slash));
  assert.ok(slashAction && slashAction.type === "play");
  game.playAction("human", slashAction, "ai-1");
  const after = game.getSnapshot();
  const ai1After = after.players.find((item) => item.id === "ai-1");
  assert.ok(ai1After);
  assert.equal(ai1After.hp, ai1Before.hp - 2);
});

void test("制衡每回合限一次并可弃牌摸等量牌", () => {
  const game = new SanGuoGame(() => 0);
  game.initDefaultGame({ humanGeneral: "孙权" });
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hand: Array<{ id: string; type: CardType }>;
    }>;
  };
  const human = runtime.players.find((item) => item.id === "human");
  assert.ok(human);
  human.hand = [
    { id: "test-zhiheng-1", type: CardType.Slash },
    { id: "test-zhiheng-2", type: CardType.Dodge },
  ];
  const beforeCount = human.hand.length;
  const skillAction = game
    .getPlayableActions("human")
    .find((item) => item.type === "skill" && item.skill === SkillName.ZhiHeng);
  assert.ok(skillAction);
  game.playAction("human", skillAction);
  const after = game.getSnapshot();
  const humanAfter = after.players.find((item) => item.id === "human");
  assert.ok(humanAfter);
  assert.equal(humanAfter.hand.length, beforeCount);
  const second = game
    .getPlayableActions("human")
    .find((item) => item.type === "skill" && item.skill === SkillName.ZhiHeng);
  assert.equal(second, undefined);
});

void test("青囊可治疗受伤目标且每回合限一次", () => {
  const game = new SanGuoGame(() => 0);
  game.initDefaultGame({ humanGeneral: "华佗" });
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hp: number;
      hand: Array<{ id: string; type: CardType }>;
    }>;
  };
  const human = runtime.players.find((item) => item.id === "human");
  const ai1 = runtime.players.find((item) => item.id === "ai-1");
  assert.ok(human);
  assert.ok(ai1);
  human.hand = [{ id: "test-qingnang-cost", type: CardType.Dodge }];
  ai1.hp = 3;
  const skillAction = game
    .getPlayableActions("human")
    .find((item) => item.type === "skill" && item.skill === SkillName.QingNang);
  assert.ok(skillAction);
  game.playAction("human", skillAction, "ai-1");
  const after = game.getSnapshot();
  const ai1After = after.players.find((item) => item.id === "ai-1");
  const humanAfter = after.players.find((item) => item.id === "human");
  assert.ok(ai1After);
  assert.ok(humanAfter);
  assert.equal(ai1After.hp, 4);
  assert.equal(humanAfter.hand.length, 0);
  const second = game
    .getPlayableActions("human")
    .find((item) => item.type === "skill" && item.skill === SkillName.QingNang);
  assert.equal(second, undefined);
});

void test("苦肉会失去体力并摸两张牌", () => {
  const game = new SanGuoGame(() => 0);
  game.initDefaultGame({ humanGeneral: "黄盖" });
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hp: number;
      hand: Array<{ id: string; type: CardType }>;
    }>;
  };
  const human = runtime.players.find((item) => item.id === "human");
  assert.ok(human);
  human.hand = [{ id: "test-kurou-base", type: CardType.Peach }];
  const hpBefore = human.hp;
  const handBefore = human.hand.length;
  const skillAction = game
    .getPlayableActions("human")
    .find((item) => item.type === "skill" && item.skill === SkillName.KuRou);
  assert.ok(skillAction);
  game.playAction("human", skillAction);
  const after = game.getSnapshot();
  const humanAfter = after.players.find((item) => item.id === "human");
  assert.ok(humanAfter);
  assert.equal(humanAfter.hp, hpBefore - 1);
  assert.equal(humanAfter.hand.length, handBefore + 2);
});

void test("反馈会在受伤后获得伤害来源的一张牌", () => {
  const game = new SanGuoGame(() => 0);
  game.initDefaultGame();
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hand: Array<{ id: string; type: CardType }>;
      skills: SkillName[];
    }>;
  };
  const human = runtime.players.find((item) => item.id === "human");
  const ai1 = runtime.players.find((item) => item.id === "ai-1");
  assert.ok(human);
  assert.ok(ai1);
  human.hand = [
    { id: "test-assault-cost", type: CardType.Dodge },
    { id: "test-remain", type: CardType.Peach },
  ];
  ai1.hand = [];
  ai1.skills = [SkillName.FanKui];
  const skillAction = game
    .getPlayableActions("human")
    .find((item) => item.type === "skill" && item.skill === SkillName.Assault);
  assert.ok(skillAction);
  game.playAction("human", skillAction, "ai-1");
  const after = game.getSnapshot();
  const humanAfter = after.players.find((item) => item.id === "human");
  const ai1After = after.players.find((item) => item.id === "ai-1");
  assert.ok(humanAfter);
  assert.ok(ai1After);
  assert.equal(humanAfter.hand.length, 0);
  assert.equal(ai1After.hand.length, 1);
});

void test("奸雄会在受伤后摸一张牌", () => {
  const game = new SanGuoGame(() => 0);
  game.initDefaultGame();
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hand: Array<{ id: string; type: CardType }>;
      skills: SkillName[];
    }>;
  };
  const human = runtime.players.find((item) => item.id === "human");
  const ai1 = runtime.players.find((item) => item.id === "ai-1");
  assert.ok(human);
  assert.ok(ai1);
  human.hand = [{ id: "test-assault-cost-2", type: CardType.Dodge }];
  ai1.hand = [];
  ai1.skills = [SkillName.JianXiong];
  const handBefore = ai1.hand.length;
  const skillAction = game
    .getPlayableActions("human")
    .find((item) => item.type === "skill" && item.skill === SkillName.Assault);
  assert.ok(skillAction);
  game.playAction("human", skillAction, "ai-1");
  const after = game.getSnapshot();
  const ai1After = after.players.find((item) => item.id === "ai-1");
  assert.ok(ai1After);
  assert.equal(ai1After.hand.length, handBefore + 1);
});

void test("遗计会在受伤后摸两张牌", () => {
  const game = new SanGuoGame(() => 0);
  game.initDefaultGame();
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hand: Array<{ id: string; type: CardType }>;
      skills: SkillName[];
    }>;
  };
  const human = runtime.players.find((item) => item.id === "human");
  const ai1 = runtime.players.find((item) => item.id === "ai-1");
  assert.ok(human);
  assert.ok(ai1);
  human.hand = [{ id: "test-assault-cost-3", type: CardType.Dodge }];
  ai1.hand = [];
  ai1.skills = [SkillName.YiJi];
  const handBefore = ai1.hand.length;
  const skillAction = game
    .getPlayableActions("human")
    .find((item) => item.type === "skill" && item.skill === SkillName.Assault);
  assert.ok(skillAction);
  game.playAction("human", skillAction, "ai-1");
  const after = game.getSnapshot();
  const ai1After = after.players.find((item) => item.id === "ai-1");
  assert.ok(ai1After);
  assert.equal(ai1After.hand.length, handBefore + 2);
});

void test("龙胆可将杀当闪打出以抵消杀", () => {
  const game = new SanGuoGame(() => 0);
  game.initDefaultGame({ aiCount: 2, humanGeneral: "张飞" });
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hp: number;
      hand: Array<{ id: string; type: CardType }>;
      skills: SkillName[];
    }>;
  };
  const human = runtime.players.find((item) => item.id === "human");
  const ai1 = runtime.players.find((item) => item.id === "ai-1");
  assert.ok(human);
  assert.ok(ai1);
  human.hand = [{ id: "test-slash-ld", type: CardType.Slash }];
  ai1.hand = [{ id: "test-only-slash", type: CardType.Slash }];
  ai1.skills = [SkillName.LongDan];
  const hpBefore = ai1.hp;
  const slashAction = game
    .getPlayableActions("human")
    .find((item) => item.type === "play" && item.label.includes(CardType.Slash));
  assert.ok(slashAction && slashAction.type === "play");
  const logs = game.playAction("human", slashAction, "ai-1");
  const after = game.getSnapshot();
  const ai1After = after.players.find((item) => item.id === "ai-1");
  assert.ok(ai1After);
  assert.equal(ai1After.hp, hpBefore);
  assert.ok(logs.some((line) => line.includes(SkillName.LongDan)));
});

void test("武圣可在决斗中将红色牌当杀打出", () => {
  const game = new SanGuoGame(() => 0);
  game.initDefaultGame({ aiCount: 2, humanGeneral: "孙策" });
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hp: number;
      hand: Array<{ id: string; type: CardType; color?: "red" | "black" | "colorless" }>;
      skills: SkillName[];
    }>;
  };
  const human = runtime.players.find((item) => item.id === "human");
  const ai1 = runtime.players.find((item) => item.id === "ai-1");
  assert.ok(human);
  assert.ok(ai1);
  human.hand = [{ id: "test-duel-card", type: CardType.Duel }];
  ai1.hand = [{ id: "test-red-peach", type: CardType.Peach, color: "red" }];
  ai1.skills = [SkillName.WuSheng];
  const hpBefore = human.hp;
  const duelAction = game
    .getPlayableActions("human")
    .find((item) => item.type === "play" && item.label.includes(CardType.Duel));
  assert.ok(duelAction && duelAction.type === "play");
  const logs = game.playAction("human", duelAction, "ai-1");
  const after = game.getSnapshot();
  const humanAfter = after.players.find((item) => item.id === "human");
  assert.ok(humanAfter);
  assert.equal(humanAfter.hp, hpBefore - 1);
  assert.ok(logs.some((line) => line.includes(SkillName.WuSheng)));
});

void test("护驾可由魏势力角色提供闪", () => {
  const game = new SanGuoGame(() => 0);
  game.initDefaultGame({ aiCount: 2, humanGeneral: "曹操" });
  const runtime = game as unknown as {
    currentPlayerIndex: number;
    players: Array<{
      id: string;
      hp: number;
      general: string;
      hand: Array<{ id: string; type: CardType }>;
    }>;
  };
  const human = runtime.players.find((item) => item.id === "human");
  const ai1 = runtime.players.find((item) => item.id === "ai-1");
  const ai2 = runtime.players.find((item) => item.id === "ai-2");
  assert.ok(human);
  assert.ok(ai1);
  assert.ok(ai2);
  ai1.general = "张飞";
  ai2.general = "甄姬";
  ai1.hand = [{ id: "test-ai1-slash-for-hujia", type: CardType.Slash }];
  ai2.hand = [{ id: "test-ai2-dodge-for-hujia", type: CardType.Dodge }];
  human.hand = [];
  runtime.currentPlayerIndex = runtime.players.findIndex((item) => item.id === "ai-1");
  const hpBefore = human.hp;
  const slashAction = game
    .getPlayableActions("ai-1")
    .find((item) => item.type === "play" && item.label.includes(CardType.Slash));
  assert.ok(slashAction && slashAction.type === "play");
  const logs = game.playAction("ai-1", slashAction, "human");
  const after = game.getSnapshot();
  const humanAfter = after.players.find((item) => item.id === "human");
  const ai2After = after.players.find((item) => item.id === "ai-2");
  assert.ok(humanAfter);
  assert.ok(ai2After);
  assert.equal(humanAfter.hp, hpBefore);
  assert.equal(ai2After.hand.length, 0);
  assert.ok(logs.some((line) => line.includes(SkillName.HuJia)));
});

void test("激将可由蜀势力角色提供杀响应决斗", () => {
  const game = new SanGuoGame(() => 0);
  game.initDefaultGame({ aiCount: 2, humanGeneral: "刘备" });
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hp: number;
      general: string;
      hand: Array<{ id: string; type: CardType }>;
    }>;
  };
  const human = runtime.players.find((item) => item.id === "human");
  const ai1 = runtime.players.find((item) => item.id === "ai-1");
  const ai2 = runtime.players.find((item) => item.id === "ai-2");
  assert.ok(human);
  assert.ok(ai1);
  assert.ok(ai2);
  ai1.hand = [{ id: "test-duel-for-jijiang", type: CardType.Duel }];
  ai2.general = "关羽";
  ai2.hand = [{ id: "test-slash-for-jijiang", type: CardType.Slash }];
  human.hand = [];
  const ai1HpBefore = ai1.hp;
  const humanHpBefore = human.hp;
  const runtimeWithTurn = game as unknown as { currentPlayerIndex: number; players: Array<{ id: string }> };
  runtimeWithTurn.currentPlayerIndex = runtimeWithTurn.players.findIndex((item) => item.id === "ai-1");
  const duelFromAi1 = game
    .getPlayableActions("ai-1")
    .find((item) => item.type === "play" && item.label.includes(CardType.Duel));
  assert.ok(duelFromAi1 && duelFromAi1.type === "play");
  const logs = game.playAction("ai-1", duelFromAi1, "human");
  const after = game.getSnapshot();
  const ai1After = after.players.find((item) => item.id === "ai-1");
  const humanAfter = after.players.find((item) => item.id === "human");
  assert.ok(ai1After);
  assert.ok(humanAfter);
  assert.equal(ai1After.hp, ai1HpBefore - 1);
  assert.equal(humanAfter.hp, humanHpBefore);
  assert.ok(logs.some((line) => line.includes(SkillName.JiJiang)));
});

void test("救援会让其他吴势力桃救主公时额外回复1点", () => {
  const game = new SanGuoGame(() => 0);
  game.initDefaultGame({ aiCount: 2, humanGeneral: "孙权" });
  const runtime = game as unknown as {
    currentPlayerIndex: number;
    players: Array<{
      id: string;
      hp: number;
      general: string;
      hand: Array<{ id: string; type: CardType }>;
    }>;
  };
  const human = runtime.players.find((item) => item.id === "human");
  const ai1 = runtime.players.find((item) => item.id === "ai-1");
  const ai2 = runtime.players.find((item) => item.id === "ai-2");
  assert.ok(human);
  assert.ok(ai1);
  assert.ok(ai2);
  ai1.general = "周瑜";
  ai1.hand = [{ id: "test-peach-for-jiuyuan", type: CardType.Peach }];
  ai2.hand = [{ id: "test-slash-kill-lord", type: CardType.Slash }];
  human.hand = [];
  human.hp = 1;
  runtime.currentPlayerIndex = runtime.players.findIndex((item) => item.id === "ai-2");
  const slashAction = game
    .getPlayableActions("ai-2")
    .find((item) => item.type === "play" && item.label.includes(CardType.Slash));
  assert.ok(slashAction && slashAction.type === "play");
  const logs = game.playAction("ai-2", slashAction, "human");
  const after = game.getSnapshot();
  const humanAfter = after.players.find((item) => item.id === "human");
  const ai1After = after.players.find((item) => item.id === "ai-1");
  assert.ok(humanAfter);
  assert.ok(ai1After);
  assert.equal(humanAfter.hp, 2);
  assert.equal(ai1After.hand.length, 0);
  assert.ok(logs.some((line) => line.includes(SkillName.JiuYuan)));
});

void test("当前玩家已阵亡时可自动跳过并推进到下一名存活角色", () => {
  const game = new SanGuoGame(() => 0);
  game.initDefaultGame({ aiCount: 2 });
  const runtime = game as unknown as {
    currentPlayerIndex: number;
    players: Array<{
      id: string;
      alive: boolean;
      hp: number;
      hand: Array<{ id: string; type: CardType }>;
    }>;
  };
  const ai1Index = runtime.players.findIndex((item) => item.id === "ai-1");
  const ai1 = runtime.players[ai1Index];
  const ai2 = runtime.players.find((item) => item.id === "ai-2");
  assert.ok(ai1);
  assert.ok(ai2);
  runtime.currentPlayerIndex = ai1Index;
  ai1.alive = false;
  ai1.hp = 0;
  const logs = game.ensureTurnState();
  const snapshot = game.getSnapshot();
  assert.equal(snapshot.currentPlayerId, "ai-2");
  assert.equal(snapshot.phase, "出牌阶段");
  assert.ok(logs.some((line) => line.includes("跳过其回合")));
  assert.ok(logs.some((line) => line.includes("ai-2")));
});
