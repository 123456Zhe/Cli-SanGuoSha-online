import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { Card, CardType } from "./cards.js";
import { loadGeneralPacks, resetGeneralPacks } from "./general-pack.js";
import { resolveGeneralByName } from "./generals.js";
import { InteractionDecision, InteractionRequest, Player, SanGuoGame, TurnPhase } from "./game.js";
import { registerPackSkill, SkillModule } from "./skill-module.js";

/**
 * Phase 6 拦截点（`judgment` / `slash_targeted` / `hand_card_lost` / `equip_lost` /
 * `card_used` / `peach_save` / `discard_phase_start`）与声明式规则 `skipDiscardPhaseIfNoSlash`（克己）。
 *
 * 钩子一律走真实注册表（`registerPackSkill`）+ 真实 emit 路径。
 * 注意：`createSkillHooks` 在 `SanGuoGame` 构造时快照外部钩子，因此**必须先注册技能再建对局**
 * （与 `general-pack.test.ts` 的 pack 加载顺序一致）。
 */

type Runtime = {
  currentPlayerIndex: number;
  players: Player[];
  phase: TurnPhase;
  slashUsedThisTurn: boolean;
  slashPlayedThisTurn: boolean;
};

const makeCard = (id: string, type: CardType, suit: Card["suit"] = "heart", rank = 7): Card => ({
  id,
  type,
  color: suit === "spade" || suit === "club" ? "black" : "red",
  suit,
  rank,
});

/** 注册一个测试用外部技能；返回命名空间 id（在 `setup()` 之前调用才生效）。 */
const registerTestSkill = (
  name: string,
  onTrigger?: SkillModule["onTrigger"],
  rules?: SkillModule["rules"],
): string => {
  const id = `测试/${name}`;
  registerPackSkill({
    id,
    displayName: name,
    kind: "triggered",
    description: `测试技能 ${name}`,
    generalName: "测试",
    ...(onTrigger ? { onTrigger } : {}),
    ...(rules ? { rules } : {}),
  });
  return id;
};

/** 克己的声明式规则（等价于 `.skill.json` 的 `rules`，走同一条谓词层）。 */
const KE_JI_RULES: SkillModule["rules"] = { skipDiscardPhaseIfNoSlash: true };

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
  }
  runtime.currentPlayerIndex = 0;
  runtime.phase = TurnPhase.Play;
  runtime.slashUsedThisTurn = false;
  runtime.slashPlayedThisTurn = false;
  return { game, runtime, players: runtime.players };
};

const approveEffects = (game: SanGuoGame, ids: string[]): void => {
  for (const id of ids) {
    game.setDecisionHandler(
      id,
      (request: InteractionRequest): InteractionDecision =>
        request.kind === "optional-effect" ? { choice: "effect", enabled: true } : { choice: "pass" },
    );
  }
};

const endPlayPhase = async (game: SanGuoGame, playerId: string): Promise<string[]> => {
  const end = game.getPlayableActions(playerId).find((action) => action.type === "end");
  assert.ok(end, "应有结束出牌阶段动作");
  return game.playAction(playerId, end);
};

const fullHand = (): Card[] => [
  makeCard("a", CardType.Slash),
  makeCard("b", CardType.Dodge),
  makeCard("c", CardType.Peach),
  makeCard("d", CardType.Duel),
  makeCard("e", CardType.ExNihilo),
];

beforeEach(() => {
  resetGeneralPacks();
});

afterEach(() => {
  resetGeneralPacks();
});

void test("discard_phase_start：钩子置 skipDiscardPhase 即跳过弃牌阶段", async () => {
  const id = registerTestSkill("跳弃牌", {
    discard_phase_start: (ctx, payload, logs) => {
      if (payload.actor && ctx.hasSkill(payload.actor, id)) {
        payload.skipDiscardPhase = true;
        logs.push("TEST_SKIP_DISCARD");
      }
    },
  });
  const { game, players } = await setup();
  const [me] = players as [Player, Player];
  me.skills = [id];
  me.hp = 3;
  me.hand = fullHand();

  const logs = await endPlayPhase(game, me.id);
  assert.ok(logs.includes("TEST_SKIP_DISCARD"), logs.join(" / "));
  assert.ok(logs.some((line) => line.includes("跳过弃牌阶段")), logs.join(" / "));
  assert.equal(me.hand.length, 5, "跳过弃牌阶段不应弃牌");
});

void test("未注册 skipDiscardPhase 时仍按体力弃牌（对照）", async () => {
  const { game, players } = await setup();
  const [me] = players as [Player, Player];
  me.hp = 3;
  me.hand = fullHand();

  const logs = await endPlayPhase(game, me.id);
  assert.ok(logs.some((line) => line.includes("需要弃置 2 张手牌")), logs.join(" / "));
  assert.equal(me.hand.length, 5, "人类座位在弃牌阶段等待交互，引擎不自动弃牌");
});

void test("声明式规则 skipDiscardPhaseIfNoSlash（克己）：本回合未出杀时可跳过弃牌阶段", async () => {
  const id = registerTestSkill("克己", undefined, KE_JI_RULES);
  const { game, players } = await setup();
  const [me] = players as [Player, Player];
  me.skills = [id];
  me.hp = 3;
  me.hand = fullHand();
  approveEffects(game, [me.id, players[1]!.id]);

  const logs = await endPlayPhase(game, me.id);
  assert.ok(logs.some((line) => line.includes("发动克己") && line.includes("跳过弃牌阶段")), logs.join(" / "));
  assert.equal(me.hand.length, 5, "克己生效时不应弃牌");
});

void test("克己：本回合使用过杀时不跳过弃牌阶段", async () => {
  const id = registerTestSkill("克己", undefined, KE_JI_RULES);
  const { game, players, runtime } = await setup();
  const [me] = players as [Player, Player];
  me.skills = [id];
  me.hp = 3;
  me.hand = fullHand();
  approveEffects(game, [me.id, players[1]!.id]);
  runtime.slashUsedThisTurn = true;

  const logs = await endPlayPhase(game, me.id);
  assert.ok(!logs.some((line) => line.includes("跳过弃牌阶段")), logs.join(" / "));
  assert.ok(logs.some((line) => line.includes("需要弃置")), logs.join(" / "));
});

void test("克己：本回合打出过杀（响应）时同样不跳过弃牌阶段", async () => {
  const id = registerTestSkill("克己", undefined, KE_JI_RULES);
  const { game, players, runtime } = await setup();
  const [me] = players as [Player, Player];
  me.skills = [id];
  me.hp = 3;
  me.hand = fullHand();
  approveEffects(game, [me.id, players[1]!.id]);
  runtime.slashPlayedThisTurn = true;

  const logs = await endPlayPhase(game, me.id);
  assert.ok(!logs.some((line) => line.includes("跳过弃牌阶段")), logs.join(" / "));
});

void test("judgment：钩子替换判定牌（改判）", async () => {
  const forced = makeCard("forced", CardType.Slash, "spade", 1);
  const id = registerTestSkill("改判", {
    judgment: (ctx, payload, logs) => {
      if (payload.actor && ctx.hasSkill(payload.actor, id)) {
        payload.judgmentCard = forced;
        logs.push("TEST_JUDGMENT_REPLACED");
      }
    },
  });
  const { game, players } = await setup();
  const [me] = players as [Player, Player];
  me.skills = [id];

  const logs: string[] = [];
  const drawJudgment = (game as unknown as {
    drawJudgmentCard(reason: string, logs: string[], owner?: Player): Promise<Card | null>;
  }).drawJudgmentCard.bind(game);
  const result = await drawJudgment("测试判定", logs, me);

  assert.equal(result?.id, "forced", "判定牌应被替换为钩子指定的牌");
  assert.ok(logs.includes("TEST_JUDGMENT_REPLACED"), logs.join(" / "));
  assert.ok(logs.some((line) => line.includes("判定牌被替换")), logs.join(" / "));
});

void test("hand_card_lost：失去手牌时触发（携带失去的牌）", async () => {
  const captured: string[] = [];
  const id = registerTestSkill("失牌", {
    hand_card_lost: (ctx, payload, logs) => {
      if (payload.actor && ctx.hasSkill(payload.actor, id) && payload.card) {
        captured.push(payload.card.id);
        logs.push("TEST_HAND_LOST");
      }
    },
  });
  const { game, players } = await setup();
  const [me] = players as [Player, Player];
  me.skills = [id];
  me.hand = [makeCard("first", CardType.Slash), makeCard("second", CardType.Dodge)];

  const logs: string[] = [];
  const removeHandCardAt = (game as unknown as {
    removeHandCardAt(player: Player, index: number, logs?: string[]): Promise<Card | undefined>;
  }).removeHandCardAt.bind(game);
  const removed = await removeHandCardAt(me, 0, logs);

  assert.equal(removed?.id, "first");
  assert.deepEqual(captured, ["first"]);
  assert.ok(logs.includes("TEST_HAND_LOST"), logs.join(" / "));
});

void test("equip_lost：失去装备时触发（携带装备牌类）", async () => {
  const captured: string[] = [];
  const id = registerTestSkill("失装", {
    equip_lost: (ctx, payload, logs) => {
      if (payload.actor && ctx.hasSkill(payload.actor, id) && payload.equip) {
        captured.push(payload.equip);
        logs.push("TEST_EQUIP_LOST");
      }
    },
  });
  const { game, players } = await setup();
  const [me] = players as [Player, Player];
  me.skills = [id];
  me.weapon = CardType.QinggangSword;

  const resolveEquip = (game as unknown as {
    resolveEquip(player: Player, equipType: CardType): Promise<string[]>;
  }).resolveEquip.bind(game);
  const logs = await resolveEquip(me, CardType.Crossbow);

  assert.deepEqual(captured, [CardType.QinggangSword], `应上报被替换掉的旧武器：${logs.join(" / ")}`);
  assert.ok(logs.includes("TEST_EQUIP_LOST"), logs.join(" / "));
});

void test("card_used：使用牌时触发（reason=使用）", async () => {
  const captured: string[] = [];
  const id = registerTestSkill("用牌", {
    card_used: (ctx, payload, logs) => {
      if (payload.actor && ctx.hasSkill(payload.actor, id) && payload.card) {
        captured.push(`${payload.reason ?? "?"}:${payload.card.type}`);
        logs.push("TEST_CARD_USED");
      }
    },
  });
  const { game, players } = await setup();
  const [me] = players as [Player, Player];
  me.skills = [id];
  me.hand = [makeCard("nihilo", CardType.ExNihilo)];

  const use = game.getPlayableActions(me.id).find((action) => action.type === "play" && action.cardIndex === 0);
  assert.ok(use, "应能使用无中生有");
  const logs = await game.playAction(me.id, use);

  assert.deepEqual(captured, [`使用:${CardType.ExNihilo}`]);
  assert.ok(logs.includes("TEST_CARD_USED"), logs.join(" / "));
});

void test("card_used：打出响应牌时触发（reason=打出）且记录本回合打出过杀", async () => {
  const captured: string[] = [];
  const id = registerTestSkill("响应", {
    card_used: (ctx, payload, logs) => {
      if (payload.actor && ctx.hasSkill(payload.actor, id) && payload.card) {
        captured.push(`${payload.reason ?? "?"}:${payload.card.type}`);
        logs.push("TEST_CARD_PLAYED");
      }
    },
  });
  const { game, runtime, players } = await setup();
  const [, other] = players as [Player, Player];
  other.skills = [id];
  other.hand = [makeCard("slash", CardType.Slash)];

  const logs: string[] = [];
  const consumeResponseCard = (game as unknown as {
    consumeResponseCard(player: Player, kind: string, sourceId: string, logs: string[]): Promise<boolean>;
  }).consumeResponseCard.bind(game);
  const consumed = await consumeResponseCard(other, "slash", "hand:slash", logs);

  assert.equal(consumed, true);
  assert.deepEqual(captured, [`打出:${CardType.Slash}`]);
  assert.equal(runtime.slashPlayedThisTurn, true, "打出杀应记录到本回合");
  assert.equal(runtime.slashUsedThisTurn, false, "打出杀不应占用出牌阶段的杀次数");
  assert.ok(logs.includes("TEST_CARD_PLAYED"), logs.join(" / "));
});

void test("slash_targeted：钩子可取消本次杀", async () => {
  const id = registerTestSkill("护体", {
    slash_targeted: (ctx, payload, logs) => {
      if (payload.target && ctx.hasSkill(payload.target, id)) {
        payload.canceled = true;
        logs.push("TEST_SLASH_CANCELED");
      }
    },
  });
  const { game, players } = await setup();
  const [me, other] = players as [Player, Player];
  other.skills = [id];
  me.hand = [makeCard("slash", CardType.Slash)];
  const hpBefore = other.hp;

  const slash = game
    .getPlayableActions(me.id)
    .find((action) => action.type === "play" && action.label === `使用 ${CardType.Slash}`);
  assert.ok(slash, "甲应能使用杀");
  const logs = await game.playAction(me.id, slash, other.id);

  assert.ok(logs.includes("TEST_SLASH_CANCELED"), logs.join(" / "));
  assert.ok(logs.some((line) => line.includes("令本次杀无效")), logs.join(" / "));
  assert.equal(other.hp, hpBefore, "杀被取消后目标不应受伤");
});

void test("peach_save：钩子可追加濒死回复量", async () => {
  const id = registerTestSkill("厚恩", {
    peach_save: (ctx, payload, logs) => {
      if (payload.actor && ctx.hasSkill(payload.actor, id)) {
        payload.peachSaveBonus = 1;
        logs.push("TEST_PEACH_BONUS");
      }
    },
  });
  const { game, players } = await setup();
  const [me, other] = players as [Player, Player];
  other.skills = [id];
  other.hp = 0;
  me.hand = [makeCard("peach", CardType.Peach)];

  const resolveDeaths = (game as unknown as { resolveDeaths(): Promise<string[]> }).resolveDeaths.bind(game);
  const logs = await resolveDeaths();

  assert.ok(logs.includes("TEST_PEACH_BONUS"), logs.join(" / "));
  assert.ok(logs.some((line) => line.includes("额外回复 1 点体力")), logs.join(" / "));
  assert.equal(other.hp, 2, "1 张桃 + 1 点额外回复 = 体力回到 2");
  assert.equal(other.alive, true);
});

void test("SKILL_TRIGGERS 覆盖 4 个基础触发点 + 7 个 Phase 6 拦截点", async () => {
  const { SKILL_TRIGGERS } = await import("./types.js");
  for (const trigger of ["turn_start", "before_draw", "before_damage", "after_damage"]) {
    assert.ok((SKILL_TRIGGERS as readonly string[]).includes(trigger), `SKILL_TRIGGERS 应包含基础触发点 ${trigger}`);
  }
  for (const trigger of ["judgment", "slash_targeted", "hand_card_lost", "equip_lost", "card_used", "peach_save", "discard_phase_start"]) {
    assert.ok((SKILL_TRIGGERS as readonly string[]).includes(trigger), `SKILL_TRIGGERS 应包含拦截点 ${trigger}`);
  }
  assert.equal(SKILL_TRIGGERS.length, 11);
});

void test("端到端：加载 examples/generals 后，吕蒙的克己在真实对局里跳过弃牌阶段", async () => {
  const report = await loadGeneralPacks({ dir: join(process.cwd(), "examples", "generals"), pool: "all" });
  assert.deepEqual(report.loaded, ["吕蒙"]);
  const { game, players } = await setup();
  const [me, other] = players as [Player, Player];
  // 真实武将定义来自 general.json：skills 已是命名空间 id（吕蒙/克己、吕蒙/涉猎）
  me.general = "吕蒙";
  me.skills = [...resolveGeneralByName("吕蒙").skills];
  assert.deepEqual(me.skills, ["吕蒙/克己", "吕蒙/涉猎"]);
  me.hp = 3;
  me.hand = fullHand();
  approveEffects(game, [me.id, other.id]);

  const logs = await endPlayPhase(game, me.id);
  assert.ok(
    logs.some((line) => line.includes("发动克己") && line.includes("跳过弃牌阶段")),
    `示例包的克己应真正生效：${logs.join(" / ")}`,
  );
  assert.equal(me.hand.length, 5, "克己生效时不应弃牌");
});
