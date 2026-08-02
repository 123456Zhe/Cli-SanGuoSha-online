import assert from "node:assert/strict";
import { test } from "node:test";
import { CARD_LIBRARY, Card, CardType, createDeck } from "./cards.js";
import { GENERAL_LIBRARY, Player, PlayerRole, SanGuoGame, SkillName, InteractionRequest } from "./game.js";

const fixedRng = (): number => 0;

const createGame = async (aiCount: number) => {
  const game = new SanGuoGame(fixedRng);
  await game.initDefaultGame({ aiCount });
  const runtime = game as unknown as {
    currentPlayerIndex: number;
    players: Array<{
      id: string;
      name: string;
      alive: boolean;
      hp: number;
      maxHp: number;
      hand: Card[];
      skills: SkillName[];
      weapon: CardType | null;
      armor: CardType | null;
      treasure: CardType | null;
      treasureCards: Card[];
    }>;
  };
  const human = runtime.players.find((player) => player.id === "human")!;
  const ai1 = runtime.players.find((player) => player.id === "ai-1")!;
  runtime.currentPlayerIndex = runtime.players.indexOf(human);
  return { game, runtime, human, ai1 };
};

void test("初始化后主公先手且进入出牌阶段", async () => {
  const game = new SanGuoGame(fixedRng);
  await game.initDefaultGame();
  const snapshot = game.getSnapshot();
  assert.equal(snapshot.currentPlayerId, "human");
  assert.equal(snapshot.phase, "出牌阶段");
  assert.equal(snapshot.players.length, 3);
});

void test("使用杀会造成伤害或被闪抵消", async () => {
  const game = new SanGuoGame(fixedRng);
  await game.initDefaultGame();
  const before = game.getSnapshot();
  const human = before.players.find((item) => item.id === "human");
  const slashIndex = human?.hand.findIndex((card) => card.type === CardType.Slash) ?? -1;
  assert.ok(slashIndex >= 0);
  const actions = game.getPlayableActions("human");
  const slashAction = actions.find(
    (action) => action.type === "play" && action.cardIndex === slashIndex,
  );
  assert.ok(slashAction && slashAction.type === "play");
  await game.playAction("human", slashAction, "ai-1");
  const after = game.getSnapshot();
  const target = after.players.find((item) => item.id === "ai-1");
  assert.ok(target);
  assert.ok(target.hp <= 4);
});

void test("用户结束出牌阶段后可进入交互弃牌并继续下一玩家", async () => {
  const game = new SanGuoGame(fixedRng);
  await game.initDefaultGame();
  const endAction = game.getPlayableActions("human").find((action) => action.type === "end");
  assert.ok(endAction);
  await game.playAction("human", endAction);
  assert.equal(game.getSnapshot().currentPlayerId, "human");
  assert.equal(game.getSnapshot().phase, "弃牌阶段");
  while (game.getPendingDiscardCount("human") > 0) {
    const options = game.getDiscardOptions("human");
    assert.ok(options.length > 0);
    await game.discardForCurrentPlayer("human", options[0]?.handIndex ?? 0);
  }
  const snapshot = game.getSnapshot();
  assert.equal(snapshot.currentPlayerId, "ai-1");
  assert.equal(snapshot.phase, "出牌阶段");
});

void test("支持自定义 AI 数量与初始手牌", async () => {
  const game = new SanGuoGame(fixedRng);
  await game.initDefaultGame({ aiCount: 4, openingHandCount: 3, humanName: "刘备" });
  const snapshot = game.getSnapshot();
  assert.equal(snapshot.players.length, 5);
  const human = snapshot.players.find((item) => item.id === "human");
  assert.ok(human);
  assert.equal(human.name, "刘备");
  assert.equal(human.hand.length, 5);
});

void test("支持配置人数、身份与武将", async () => {
  const game = new SanGuoGame(fixedRng);
  await game.initDefaultGame({
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
  assert.ok(human.skills.includes(SkillName.JuShou));
  const current = snapshot.players.find((item) => item.id === snapshot.currentPlayerId);
  assert.equal(current?.role, PlayerRole.Lord);
});

void test("AI 武将会随机且一局内不重复（包含不与玩家武将重复）", async () => {
  const game = new SanGuoGame(() => 0);
  await game.initDefaultGame({
    playerCount: 6,
    humanGeneral: "曹仁",
  });
  const snapshot = game.getSnapshot();
  const generalNames = snapshot.players.map((player) => player.general);
  const uniqueNames = new Set(generalNames);
  assert.equal(uniqueNames.size, generalNames.length);
});

void test("6人局默认身份配比符合推荐", async () => {
  const game = new SanGuoGame(fixedRng);
  await game.initDefaultGame({ playerCount: 6 });
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

void test("人数上限约束为6人", async () => {
  const game = new SanGuoGame(fixedRng);
  await game.initDefaultGame({ playerCount: 20 });
  const snapshot = game.getSnapshot();
  assert.equal(snapshot.players.length, 6);
});

void test("初始化参数会被约束到安全范围", async () => {
  const game = new SanGuoGame(fixedRng);
  await game.initDefaultGame({ aiCount: 0, openingHandCount: 20 });
  const snapshot = game.getSnapshot();
  assert.equal(snapshot.players.length, 2);
  const human = snapshot.players.find((item) => item.id === "human");
  assert.ok(human);
  assert.equal(human.hand.length, 8);
});

void test("孙策开局携带激昂、魂姿和制霸", async () => {
  const game = new SanGuoGame(fixedRng);
  await game.initDefaultGame({ openingHandCount: 3 });
  const snapshot = game.getSnapshot();
  const human = snapshot.players.find((item) => item.id === "human");
  assert.ok(human);
  assert.equal(human.general, "孙策");
  assert.ok(human.skills.includes(SkillName.JiAng));
  assert.ok(human.skills.includes(SkillName.HunZi));
  assert.ok(human.skills.includes(SkillName.ZhiBa));
  assert.equal(human.hand.length, 5);
});

void test("强袭可用且每回合仅可发动一次", async () => {
  const game = new SanGuoGame(fixedRng);
  await game.initDefaultGame();
  const setup = game as unknown as { players: Array<{ id: string; skills: SkillName[] }> };
  const setupHuman = setup.players.find((item) => item.id === "human");
  if (setupHuman) setupHuman.skills = [SkillName.Assault];
  const before = game.getSnapshot();
  const humanBefore = before.players.find((item) => item.id === "human");
  const targetBefore = before.players.find((item) => item.id === "ai-1");
  assert.ok(humanBefore);
  assert.ok(targetBefore);
  const humanHandBefore = humanBefore.hand.length;
  const targetHpBefore = targetBefore.hp;
  game.setOptionalEffectDecision("ai-1", SkillName.GangLie, false);
  const skillAction = game
    .getPlayableActions("human")
    .find((action) => action.type === "skill" && action.skill === SkillName.Assault);
  assert.ok(skillAction);
  await game.playAction("human", skillAction, "ai-1");
  const after = game.getSnapshot();
  const humanAfter = after.players.find((item) => item.id === "human");
  const targetAfter = after.players.find((item) => item.id === "ai-1");
  assert.ok(humanAfter);
  assert.ok(targetAfter);
  assert.equal(humanAfter.hand.length, humanHandBefore - 1);
  assert.equal(targetAfter.hp, targetHpBefore - 1);
  const secondSkill = game
    .getPlayableActions("human")
    .find((action) => action.type === "skill" && action.skill === SkillName.Assault);
  assert.equal(secondSkill, undefined);
});

void test("夏侯惇受伤后刚烈会令伤害来源弃两牌或受到伤害", async () => {
  const game = new SanGuoGame(() => 0.9);
  await game.initDefaultGame({ aiCount: 1, humanGeneral: "夏侯惇" });
  const runtime = game as unknown as {
    currentPlayerIndex: number;
    players: Array<{
      id: string;
      hp: number;
      hand: Card[];
      skills: SkillName[];
      weapon: CardType | null;
      armor: CardType | null;
    }>;
  };
  const xiahou = runtime.players.find((player) => player.id === "human");
  const attacker = runtime.players.find((player) => player.id === "ai-1");
  assert.ok(xiahou);
  assert.ok(attacker);
  xiahou.hand = [];
  attacker.hand = [{ id: "ganglie-slash", type: CardType.Slash, color: "red", suit: "heart", rank: 7 }];
  runtime.currentPlayerIndex = runtime.players.indexOf(attacker);
  const attackerHp = attacker.hp;
  game.setOptionalEffectDecision(xiahou.id, SkillName.GangLie, true);
  const slash = game
    .getPlayableActions(attacker.id)
    .find((action) => action.type === "play" && action.label.includes(CardType.Slash));
  assert.ok(slash);
  await game.playAction(attacker.id, slash, xiahou.id);
  assert.equal(attacker.hp, attackerHp - 1);
  assert.ok(attacker.hand.length <= 1);
});

void test("非锁定武将技可选择不发动", async () => {
  const game = new SanGuoGame(() => 0);
  await game.initDefaultGame({ aiCount: 1, humanGeneral: "夏侯惇" });
  const runtime = game as unknown as {
    currentPlayerIndex: number;
    players: Array<{
      id: string;
      hp: number;
      hand: Card[];
      skills: SkillName[];
      weapon: CardType | null;
      armor: CardType | null;
    }>;
  };
  const xiahou = runtime.players.find((player) => player.id === "human");
  const attacker = runtime.players.find((player) => player.id === "ai-1");
  assert.ok(xiahou);
  assert.ok(attacker);
  xiahou.hand = [];
  attacker.hand = [{ id: "optional-slash", type: CardType.Slash, color: "red", suit: "heart", rank: 7 }];
  runtime.currentPlayerIndex = runtime.players.indexOf(attacker);
  const attackerHp = attacker.hp;
  const slash = game.getPlayableActions(attacker.id).find((action) => action.type === "play" && action.label.includes(CardType.Slash));
  assert.ok(slash);
  game.setOptionalEffectDecision(xiahou.id, SkillName.GangLie, false);
  await game.playAction(attacker.id, slash, xiahou.id);
  assert.equal(attacker.hp, attackerHp);
  assert.ok(!attacker.hand.some((card) => card.type === CardType.Slash));
});

void test("曹仁据守翻面后会跳过下一整个回合", async () => {
  const game = new SanGuoGame(fixedRng);
  await game.initDefaultGame({ playerCount: 2, humanGeneral: "曹仁" });
  const runtime = game as unknown as {
    currentPlayerIndex: number;
    players: Array<{
      id: string;
      hand: Card[];
      skills: SkillName[];
      faceDown: boolean;
    }>;
  };
  const human = runtime.players.find((player) => player.id === "human");
  assert.ok(human);
  human.hand = [];
  game.setOptionalEffectDecision("human", SkillName.JuShou, true);
  const end = game.getPlayableActions("human").find((action) => action.type === "end");
  assert.ok(end);
  const endLogs = await game.playAction("human", end);
  assert.equal(human.faceDown, true);
  assert.ok(endLogs.some((line) => line.includes(SkillName.JuShou)));

  runtime.currentPlayerIndex = runtime.players.indexOf(human);
  game.setOptionalEffectDecision("human", SkillName.JieWei, false);
  const skipLogs = await game.startTurn();
  assert.equal(human.faceDown, false);
  assert.notEqual(game.getCurrentPlayer().id, "human");
  assert.ok(skipLogs.some((line) => line.includes("跳过本回合")));
});

void test("当前玩家已阵亡时可自动跳过并推进到下一名存活角色", async () => {
  const game = new SanGuoGame(() => 0);
  await game.initDefaultGame({ aiCount: 2 });
  const runtime = game as unknown as {
    currentPlayerIndex: number;
    players: Array<{
      id: string;
      name: string;
      alive: boolean;
      hp: number;
      hand: Card[];
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
  const logs = await game.ensureTurnState();
  const snapshot = game.getSnapshot();
  assert.equal(snapshot.currentPlayerId, "ai-2");
  assert.equal(snapshot.phase, "出牌阶段");
  assert.ok(logs.some((line) => line.includes("跳过其回合")));
  assert.ok(logs.some((line) => line.includes(ai2.name)));
});

void test("联机身份按随机洗牌结果分配而不是绑定玩家编号", async () => {
  const players = [
    { id: "online-1", name: "甲" },
    { id: "online-2", name: "乙" },
    { id: "online-3", name: "丙" },
    { id: "online-4", name: "丁" },
  ];
  const firstGame = new SanGuoGame(() => 0);
  await firstGame.initNetworkGame(players);
  const secondGame = new SanGuoGame(() => 0.999999);
  await secondGame.initNetworkGame(players);
  const firstRoles = firstGame.getSnapshot().players.map((player) => player.role);
  const secondRoles = secondGame.getSnapshot().players.map((player) => player.role);
  assert.notDeepEqual(firstRoles, secondRoles);
});

void test("曹仁据守翻面后会跳过下一整个回合", async () => {
  const game = new SanGuoGame(fixedRng);
  await game.initDefaultGame({ playerCount: 2, humanGeneral: "曹仁" });
  const runtime = game as unknown as {
    currentPlayerIndex: number;
    players: Array<{
      id: string;
      hand: Card[];
      skills: SkillName[];
      faceDown: boolean;
    }>;
  };
  const human = runtime.players.find((player) => player.id === "human");
  assert.ok(human);
  human.hand = [];
  game.setOptionalEffectDecision("human", SkillName.JuShou, true);
  const end = game.getPlayableActions("human").find((action) => action.type === "end");
  assert.ok(end);
  const endLogs = await game.playAction("human", end);
  assert.equal(human.faceDown, true);
  assert.ok(endLogs.some((line) => line.includes(SkillName.JuShou)));

  runtime.currentPlayerIndex = runtime.players.indexOf(human);
  game.setOptionalEffectDecision("human", SkillName.JieWei, false);
  const skipLogs = await game.startTurn();
  assert.equal(human.faceDown, false);
  assert.notEqual(game.getCurrentPlayer().id, "human");
  assert.ok(skipLogs.some((line) => line.includes("跳过本回合")));
});

void test("当前玩家已阵亡时可自动跳过并推进到下一名存活角色", async () => {
  const game = new SanGuoGame(() => 0);
  await game.initDefaultGame({ aiCount: 2 });
  const runtime = game as unknown as {
    currentPlayerIndex: number;
    players: Array<{
      id: string;
      name: string;
      alive: boolean;
      hp: number;
      hand: Card[];
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
  const logs = await game.ensureTurnState();
  const snapshot = game.getSnapshot();
  assert.equal(snapshot.currentPlayerId, "ai-2");
  assert.equal(snapshot.phase, "出牌阶段");
  assert.ok(logs.some((line) => line.includes("跳过其回合")));
  assert.ok(logs.some((line) => line.includes(ai2.name)));
});

void test("联机分阶段：曹仁据守可由玩家选择是否发动", async () => {
  const players = [{ id: "online-1", name: "甲" }, { id: "online-2", name: "乙" }];
  const game = new SanGuoGame(fixedRng);
  await game.initNetworkGame(players, 4, false);
  const runtime = game as unknown as { players: Player[] };
  const me = runtime.players.find((p) => p.id === game.getCurrentPlayer().id)!;
  me.skills = [SkillName.JuShou];
  me.hand = [];
  await game.startTurn();
  assert.deepEqual(game.getTurnEndOptionalEffects(me.id), [SkillName.JuShou]);
  const end = game.getPlayableActions(me.id).find((a) => a.type === "end")!;
  await game.playAction(me.id, end);
  // 分阶段：结束动作后尚未结算结束阶段技能
  assert.equal(me.faceDown, false);
  const enderId = game.consumePendingTurnEnd();
  assert.equal(enderId, me.id);
  game.setOptionalEffectDecision(me.id, SkillName.JuShou, false);
  const skipLogs = await game.finishTurn(me);
  assert.equal(me.faceDown, false);
  assert.ok(!skipLogs.some((line) => line.includes(SkillName.JuShou)));
});

void test("联机分阶段：选择发动据守会翻面并摸牌", async () => {
  const players = [{ id: "online-1", name: "甲" }, { id: "online-2", name: "乙" }];
  const game = new SanGuoGame(fixedRng);
  await game.initNetworkGame(players, 4, false);
  const runtime = game as unknown as { players: Player[] };
  const me = runtime.players.find((p) => p.id === game.getCurrentPlayer().id)!;
  me.skills = [SkillName.JuShou];
  me.hand = [];
  await game.startTurn();
  const end = game.getPlayableActions(me.id).find((a) => a.type === "end")!;
  await game.playAction(me.id, end);
  game.consumePendingTurnEnd();
  const before = me.hand.length;
  game.setOptionalEffectDecision(me.id, SkillName.JuShou, true);
  const logs = await game.finishTurn(me);
  assert.equal(me.faceDown, true);
  assert.equal(me.hand.length, before + 3);
  assert.ok(logs.some((line) => line.includes(SkillName.JuShou)));
});

void test("联机分阶段：许褚裸衣可由玩家选择是否发动", async () => {
  const players = [{ id: "online-1", name: "甲" }, { id: "online-2", name: "乙" }];
  const game = new SanGuoGame(fixedRng);
  await game.initNetworkGame(players, 4, false);
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hand: Card[];
      skills: SkillName[];
    }>;
  };
  const me = runtime.players.find((p) => p.id === game.getCurrentPlayer().id)!;
  me.skills = [SkillName.LuoYi];
  me.hand = [];
  assert.ok(game.getTurnStartOptionalEffects(me.id).includes(SkillName.LuoYi));
  game.setOptionalEffectDecision(me.id, SkillName.LuoYi, false);
  await game.startTurn();
  assert.equal(me.hand.length, 2);
});

void test("联机分阶段：选择发动裸衣会少摸一张牌", async () => {
  const players = [{ id: "online-1", name: "甲" }, { id: "online-2", name: "乙" }];
  const game = new SanGuoGame(fixedRng);
  await game.initNetworkGame(players, 4, false);
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hand: Card[];
      skills: SkillName[];
    }>;
  };
  const me = runtime.players.find((p) => p.id === game.getCurrentPlayer().id)!;
  me.skills = [SkillName.LuoYi];
  me.hand = [];
  game.setOptionalEffectDecision(me.id, SkillName.LuoYi, true);
  await game.startTurn();
  assert.equal(me.hand.length, 1);
});

void test("借刀杀人：目标可选择出杀并指定攻击对象", async () => {
  const { game, runtime, human, ai1 } = await createGame(2);
  const ai2 = runtime.players.find((player) => player.id === "ai-2")!;
  human.hand = [{ id: "c1", type: CardType.Collateral, color: "red", suit: "heart", rank: 7 }];
  ai1.hand = [{ id: "s1", type: CardType.Slash, color: "red", suit: "heart", rank: 7 }];
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
  human.hand = [{ id: "c1", type: CardType.Collateral, color: "red", suit: "heart", rank: 7 }];
  ai1.hand = [{ id: "s1", type: CardType.Slash, color: "red", suit: "heart", rank: 7 }];
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
    { id: "d1", type: CardType.Duel, color: "red", suit: "heart", rank: 7 },
    { id: "hs1", type: CardType.Slash, color: "black", suit: "club", rank: 7 },
  ];
  ai1.hand = [
    { id: "s1", type: CardType.Slash, color: "red", suit: "heart", rank: 7 },
    { id: "s2", type: CardType.Slash, color: "black", suit: "club", rank: 7 },
  ];
  runtime.currentPlayerIndex = runtime.players.indexOf(human);
  const requests: InteractionRequest[] = [];
  game.setDecisionHandler(human.id, (request) => {
    requests.push(request);
    return { choice: "pass" };
  });
  const action = game.getPlayableActions(human.id).find((item) => item.label.includes(CardType.Duel))!;
  await game.playAction(human.id, action, ai1.id);
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.kind, "optional-effect");
  assert.ok(requests[1]?.kind === "respond" && requests[1].responseKind === "slash");
  assert.ok(human.hp < human.maxHp);
});

void test("藤甲：万箭齐发与普通杀不触发响应请求", async () => {
  const { game, runtime, human, ai1 } = await createGame(1);
  human.hand = [{ id: "a1", type: CardType.ArrowRain, color: "red", suit: "heart", rank: 7 }];
  ai1.armor = CardType.VineArmor;
  ai1.hand = [{ id: "dg", type: CardType.Dodge, color: "red", suit: "heart", rank: 7 }];
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
  human.treasureCards = [{ id: "oxdodge", type: CardType.Dodge, color: "red", suit: "heart", rank: 7 }];
  human.hand = [];
  ai1.hand = [{ id: "as1", type: CardType.Slash, color: "red", suit: "heart", rank: 7 }];
  runtime.currentPlayerIndex = runtime.players.indexOf(ai1);
  const requests: InteractionRequest[] = [];
  game.setDecisionHandler(human.id, (request) => {
    requests.push(request);
    return { choice: "card", sourceId: "treasure:oxdodge" };
  });
  const action = game.getPlayableActions(ai1.id).find((item) => /使用 (火)?杀$/.test(item.label))!;
  await game.playAction(ai1.id, action, human.id);
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.kind, "optional-effect");
  assert.ok(requests[1]?.kind === "respond" && requests[1].sources.some((source) => source.origin === "treasure"));
  assert.equal(human.treasureCards.length, 0);
  assert.equal(human.hp, human.maxHp);
});

void test("木牛流马：出牌阶段可取回内部牌", async () => {
  const { game, runtime, human } = await createGame(1);
  human.treasure = CardType.WoodenOx;
  human.treasureCards = [{ id: "ox1", type: CardType.Peach, color: "red", suit: "heart", rank: 7 }];
  human.hand = [{ id: "h1", type: CardType.Negate, color: "black", suit: "club", rank: 7 }];
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
    { id: "fj1", type: CardType.Slash, color: "red", suit: "diamond", rank: 8 },
    { id: "fj2", type: CardType.Dodge, color: "black", suit: "club", rank: 4 },
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
  assert.equal(requests.length, 3);
  assert.equal(requests[0]?.kind, "choose-suit");
  assert.ok(requests[1]?.kind === "choose-discard" && requests[1].sources.every((source) => source.label.includes("手牌")));
  assert.equal(requests[2]?.kind, "optional-effect");
  assert.equal(ai1.hand.length, 1);
});

void test("反间：伤害造成阵亡时应正确触发濒死与阵亡判定", async () => {
  const { game, runtime, human, ai1 } = await createGame(1);
  (human as { skills: SkillName[] }).skills = [SkillName.FanJian];
  human.hand = [{ id: "fj1", type: CardType.Slash, color: "red", suit: "diamond", rank: 8 }];
  ai1.hand = [];
  ai1.hp = 1;
  runtime.currentPlayerIndex = runtime.players.indexOf(human);
  game.setDecisionHandler(ai1.id, (request) => {
    if (request.kind === "choose-suit") {
      // 声明花色与 diamond 不同，保证反间必定造成 1 点伤害
      return { choice: "suit", suit: "heart" };
    }
    if (request.kind === "choose-discard") {
      const picked = request.sources.find((source) => source.sourceId === "hand:fj1");
      return picked ? { choice: "card", sourceId: picked.sourceId } : { choice: "pass" };
    }
    return { choice: "pass" };
  });
  const action = game.getPlayableActions(human.id).find((item) => item.type === "skill" && item.skill === SkillName.FanJian);
  assert.ok(action);
  const logs = await game.playAction(human.id, action, ai1.id);
  assert.equal(ai1.hp, 0);
  assert.equal(ai1.alive, false, "反间致死后应在结算内完成阵亡判定");
  assert.ok(logs.some((line) => line.includes("阵亡")), "日志应包含阵亡记录");
});

void test("initNetworkGame：支持 isAI 配置并正确标记玩家", async () => {
  const game = new SanGuoGame(fixedRng);
  await game.initNetworkGame(
    [
      { id: "p1", name: "甲" },
      { id: "ai-1", name: "[AI]电脑-甲", isAI: true },
    ],
    1,
    false,
  );
  const snapshot = game.getSnapshot();
  const human = snapshot.players.find((player) => player.id === "p1")!;
  const ai = snapshot.players.find((player) => player.id === "ai-1")!;
  assert.equal(human.isAI, false);
  assert.equal(ai.isAI, true);
  assert.equal(snapshot.players.length, 2);
});
