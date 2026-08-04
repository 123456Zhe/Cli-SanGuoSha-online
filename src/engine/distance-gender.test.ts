import assert from "node:assert/strict";
import { test } from "node:test";
import { Card, CardType } from "./cards.js";
import { Player, PlayerRole, SanGuoGame, SkillName } from "./game.js";
import { computeDistanceBetween, getAttackRange } from "./resolve.js";

const makePlayer = (id: string, overrides: Partial<Player> = {}): Player => ({
  id,
  name: id,
  role: PlayerRole.Rebel,
  gender: "男",
  general: "孙策",
  skills: [],
  isAI: true,
  hp: 4,
  maxHp: 4,
  hand: [],
  weapon: null,
  armor: null,
  defenseHorse: null,
  attackHorse: null,
  treasure: null,
  treasureCards: [],
  delayedTricks: [],
  alive: true,
  faceDown: false,
  ...overrides,
});

void test("诸葛连弩攻击范围为 1，其余武器范围正确", () => {
  const weapon = (value: Player["weapon"]) => makePlayer("p", { weapon: value });
  assert.equal(getAttackRange(weapon(null)), 1);
  assert.equal(getAttackRange(weapon(CardType.Crossbow)), 1);
  assert.equal(getAttackRange(weapon(CardType.FemaleSword)), 2);
  assert.equal(getAttackRange(weapon(CardType.GudingBlade)), 2);
  assert.equal(getAttackRange(weapon(CardType.SerpentSpear)), 3);
  assert.equal(getAttackRange(weapon(CardType.Halberd)), 4);
  assert.equal(getAttackRange(weapon(CardType.KylinBow)), 5);
});

void test("computeDistanceBetween：环形距离与马/马术修正", () => {
  const p1 = makePlayer("p1");
  const p2 = makePlayer("p2");
  const p3 = makePlayer("p3");
  const p4 = makePlayer("p4");
  const players = [p1, p2, p3, p4];

  assert.equal(computeDistanceBetween(players, p1, p2), 1);
  assert.equal(computeDistanceBetween(players, p1, p3), 2);
  assert.equal(computeDistanceBetween(players, p1, p4), 1, "环形取较短一侧");
  // 进攻马 -1
  assert.equal(computeDistanceBetween(players, { ...p1, attackHorse: CardType.ChiTu }, p3), 1);
  // 防御马 +1
  assert.equal(computeDistanceBetween(players, p1, { ...p3, defenseHorse: CardType.Dilu }), 3);
  // 马术 -1
  assert.equal(computeDistanceBetween(players, { ...p1, skills: [SkillName.MaShu] }, p3), 1);
  // 下限 1
  assert.equal(computeDistanceBetween([p1, p2], { ...p1, attackHorse: CardType.ChiTu }, p2), 1);
  // 阵亡角色剔除后重新排座
  assert.equal(computeDistanceBetween([p1, { ...p2, alive: false }, p3], p1, p3), 1);
  // 不在列表中返回 99
  assert.equal(computeDistanceBetween([p1, p2], makePlayer("p9"), p2), 99);
});

void test("玩家性别跟随所选武将", async () => {
  const game = new SanGuoGame(() => 0.5);
  await game.initDefaultGame({ humanGeneral: "孙尚香" });
  const human = game.getSnapshot().players.find((player) => player.id === "human");
  assert.equal(human?.general, "孙尚香");
  assert.equal(human?.gender, "女");
});

void test("默认武将（孙策）为男性", async () => {
  const game = new SanGuoGame(() => 0.5);
  await game.initDefaultGame();
  const human = game.getSnapshot().players.find((player) => player.id === "human");
  assert.equal(human?.general, "孙策");
  assert.equal(human?.gender, "男");
});

type Runtime = { currentPlayerIndex: number; players: Array<Player & { hand: Card[] }> };

const createSlashGame = async () => {
  const game = new SanGuoGame(() => 0.5);
  await game.initDefaultGame({ aiCount: 1 });
  const runtime = game as unknown as Runtime;
  const human = runtime.players.find((player) => player.id === "human")!;
  const ai1 = runtime.players.find((player) => player.id === "ai-1")!;
  for (const player of runtime.players) {
    player.skills = [];
    player.hand = [];
  }
  runtime.currentPlayerIndex = runtime.players.indexOf(human);
  return { game, human, ai1 };
};

void test("雌雄双股剑：对异性目标出杀触发，攻击者摸牌", async () => {
  const { game, human, ai1 } = await createSlashGame();
  human.weapon = CardType.FemaleSword;
  human.gender = "男";
  ai1.gender = "女";
  ai1.hp = 2;
  human.hand = [{ id: "slash", type: CardType.Slash, color: "red", suit: "heart", rank: 1 }];
  game.setDecisionHandler(human.id, (request) =>
    request.kind === "optional-effect" ? { choice: "effect", enabled: true } : { choice: "pass" },
  );
  const action = game
    .getPlayableActions(human.id)
    .find((item) => item.type === "play" && item.label.includes(CardType.Slash))!;
  await game.playAction(human.id, action, ai1.id);
  // 出杀消耗1张，雌雄双股剑令攻击者摸1张
  assert.equal(human.hand.length, 1);
  assert.ok(ai1.hp < ai1.maxHp, "杀应命中目标");
});

void test("雌雄双股剑：对同性目标出杀不触发", async () => {
  const { game, human, ai1 } = await createSlashGame();
  human.weapon = CardType.FemaleSword;
  human.gender = "男";
  ai1.gender = "男";
  ai1.hp = 2;
  human.hand = [{ id: "slash", type: CardType.Slash, color: "red", suit: "heart", rank: 1 }];
  game.setDecisionHandler(human.id, (request) =>
    request.kind === "optional-effect" ? { choice: "effect", enabled: true } : { choice: "pass" },
  );
  const action = game
    .getPlayableActions(human.id)
    .find((item) => item.type === "play" && item.label.includes(CardType.Slash))!;
  await game.playAction(human.id, action, ai1.id);
  // 无雌雄双股剑摸牌，出杀消耗后手牌为 0
  assert.equal(human.hand.length, 0);
});
