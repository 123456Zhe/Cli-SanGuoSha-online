import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
  extra?: Partial<SkillModule>,
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
    ...(extra ?? {}),
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

void test("globalHook：声明后钩子在非持有者事件上也会触发（武庫监听他人失装）", async () => {
  let globalCount = 0;
  const globalId = registerTestSkill(
    "全局失装",
    {
      equip_lost: (ctx, payload, logs) => {
        // 钩子自行定位持有者：场上持有本技能的玩家。
        const holder = ctx.players.find((player) => ctx.hasSkill(player, globalId));
        if (!holder || !holder.alive || !payload.equip) {
          return;
        }
        // 只计其他角色失装（自己失装不算，防与 card_used 双计）。
        if (payload.actor && payload.actor.id !== holder.id) {
          globalCount += 1;
          logs.push("TEST_GLOBAL_EQUIP_LOST");
        }
      },
    },
    undefined,
    { globalHook: true },
  );
  let localCount = 0;
  const localId = registerTestSkill("本家失装", {
    equip_lost: (ctx, payload, logs) => {
      if (payload.actor && ctx.hasSkill(payload.actor, localId) && payload.equip) {
        localCount += 1;
      }
    },
  });
  const { game, players } = await setup();
  const [me, other] = players as [Player, Player];
  me.skills = [globalId, localId];
  other.weapon = CardType.QinggangSword;

  const resolveEquip = (game as unknown as {
    resolveEquip(player: Player, equipType: CardType): Promise<string[]>;
  }).resolveEquip.bind(game);
  const logs = await resolveEquip(other, CardType.Crossbow);

  assert.equal(globalCount, 1, "全局钩子应在他人失装时触发");
  assert.ok(logs.includes("TEST_GLOBAL_EQUIP_LOST"), logs.join(" / "));
  assert.equal(localCount, 0, "非全局钩子不应在他人失装时触发（默认过滤）");
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

void test("card_used：payload.targets 按指定目标填入（杀/南蛮有目标、无中生有没有）", async () => {
  const captured: Array<{ card: CardType; targets: string[] }> = [];
  const id = registerTestSkill("记目标", {
    card_used: (ctx, payload, logs) => {
      if (payload.actor && ctx.hasSkill(payload.actor, id) && payload.card) {
        captured.push({
          card: payload.card.type,
          targets: (payload.targets ?? []).map((p) => p.id),
        });
        logs.push("TEST_CARD_TARGETS");
      }
    },
  });
  const { game, players } = await setup();
  const [me, other] = players as [Player, Player];
  me.skills = [id];
  me.hand = [
    makeCard("slash", CardType.Slash),
    makeCard("nihilo", CardType.ExNihilo),
    makeCard("barbarian", CardType.Barbarian),
  ];

  const slash = game.getPlayableActions(me.id).find((action) => action.type === "play" && action.cardIndex === 0);
  assert.ok(slash, "应能出杀");
  const logs = await game.playAction(me.id, slash, other.id);
  assert.ok(logs.includes("TEST_CARD_TARGETS"), logs.join(" / "));

  const nihilo = game
    .getPlayableActions(me.id)
    .find((action) => action.type === "play" && me.hand[action.cardIndex]?.type === CardType.ExNihilo);
  assert.ok(nihilo, "应能用无中生有");
  await game.playAction(me.id, nihilo);

  const barbarian = game
    .getPlayableActions(me.id)
    .find((action) => action.type === "play" && me.hand[action.cardIndex]?.type === CardType.Barbarian);
  assert.ok(barbarian, "应能用南蛮入侵");
  await game.playAction(me.id, barbarian);

  assert.deepEqual(captured, [
    { card: CardType.Slash, targets: [other.id] },
    { card: CardType.ExNihilo, targets: [] },
    { card: CardType.Barbarian, targets: [other.id] },
  ]);
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

void test("card_discarded：弃牌阶段弃牌时逐张触发（reason=弃置，actor 为弃牌者）", async () => {
  const captured: Array<{ actor: string; card: string; reason: string }> = [];
  const id = registerTestSkill("记弃牌", {
    card_discarded: (ctx, payload, logs) => {
      if (payload.actor && payload.card) {
        captured.push({ actor: payload.actor.id, card: payload.card.id, reason: payload.reason ?? "?" });
        logs.push("TEST_CARD_DISCARDED");
      }
    },
  });
  const { game, players } = await setup();
  const [me] = players as [Player, Player];
  me.skills = [id];
  me.isAI = true;
  me.hp = 3;
  me.hand = fullHand();

  const logs = await endPlayPhase(game, me.id);
  assert.ok(logs.includes("TEST_CARD_DISCARDED"), logs.join(" / "));
  assert.equal(captured.length, 2, "5 手牌、上限 3，应弃 2 张并触发 2 次");
  assert.ok(captured.every((entry) => entry.actor === me.id && entry.reason === "弃置"));
  assert.equal(me.hand.length, 3);
});

void test("card_discarded：判定牌入弃牌堆时触发（reason=判定），使用/打出的牌入堆不触发", async () => {
  const captured: Array<{ card: string; reason: string }> = [];
  const id = registerTestSkill("记判定弃牌", {
    card_discarded: (ctx, payload, logs) => {
      if (payload.actor && payload.card) {
        captured.push({ card: payload.card.id, reason: payload.reason ?? "?" });
        logs.push("TEST_CARD_DISCARDED");
      }
    },
  });
  const { game, players } = await setup();
  const [me, other] = players as [Player, Player];
  me.skills = [id];
  me.hand = [makeCard("slash", CardType.Slash, "club")];

  // 判定：直接调 drawJudgmentCard（白盒，绕过判定阶段编排）。
  const logs: string[] = [];
  const drawJudgmentCard = (
    game as unknown as {
      drawJudgmentCard(reason: string, logs: string[], owner?: Player): Promise<Card | null>;
    }
  ).drawJudgmentCard.bind(game);
  const judgment = await drawJudgmentCard("测试判定", logs, me);
  assert.ok(judgment, "应能翻出判定牌");
  assert.deepEqual(captured, [{ card: judgment.id, reason: "判定" }]);

  // 使用：梅花杀使用后入弃牌堆，不应触发 card_discarded。
  const slash = game.getPlayableActions(me.id).find((action) => action.type === "play" && action.cardIndex === 0);
  assert.ok(slash, "应能出杀");
  await game.playAction(me.id, slash, other.id);
  assert.equal(captured.length, 1, "使用过的杀入堆不应触发 card_discarded");
  assert.ok(logs.includes("TEST_CARD_DISCARDED"), logs.join(" / "));
});

void test("card_discarded：globalHook 可监听他人弃牌，钩子可从弃牌堆取走梅花牌（落英模式）", async () => {
  const id = registerTestSkill(
    "落英样例",
    {
      card_discarded: (ctx, payload, logs) => {
        const holder = ctx.players.find((p) => ctx.hasSkill(p, id));
        if (!holder || !payload.actor || !payload.card) return;
        if (payload.actor.id === holder.id) return;
        if (payload.card.suit !== "club") return;
        const index = ctx.discardPile.findIndex((item) => item.id === payload.card?.id);
        if (index < 0) return;
        const [taken] = ctx.discardPile.splice(index, 1);
        if (taken) {
          holder.hand.push(taken);
          logs.push("TEST_LUO_YING_TOOK_CARD");
        }
      },
    },
    undefined,
    { globalHook: true },
  );
  const { game, runtime, players } = await setup();
  const [me, other] = players as [Player, Player];
  me.skills = [id];
  // 乙的回合：AI 自动弃牌；rng 恒 0，randomIndex(2)=0，弃手牌首张（梅花杀）。
  runtime.currentPlayerIndex = 1;
  other.isAI = true;
  other.hp = 1;
  other.hand = [makeCard("club-slash", CardType.Slash, "club"), makeCard("heart-dodge", CardType.Dodge, "heart")];

  const logs = await endPlayPhase(game, other.id);
  assert.ok(logs.includes("TEST_LUO_YING_TOOK_CARD"), logs.join(" / "));
  assert.ok(me.hand.some((card) => card.id === "club-slash"), "甲应获得乙弃置的梅花杀");
  assert.ok(!(game as unknown as { discardPile: Card[] }).discardPile.some((card) => card.id === "club-slash"), "梅花杀已被取走，不应在弃牌堆");
  assert.equal(other.hand.length, 1, "乙弃 1 张后剩 1 张");
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

void test("SKILL_TRIGGERS 覆盖 4 个基础触发点 + 7 个 Phase 6 拦截点 + Phase 7 的 provide_response + Phase 8 的准备/结束阶段 + Phase 9 的 dying + Phase 10 的 card_discarded", async () => {
  const { SKILL_TRIGGERS } = await import("./types.js");
  for (const trigger of ["turn_start", "before_draw", "before_damage", "after_damage"]) {
    assert.ok((SKILL_TRIGGERS as readonly string[]).includes(trigger), `SKILL_TRIGGERS 应包含基础触发点 ${trigger}`);
  }
  for (const trigger of ["judgment", "slash_targeted", "hand_card_lost", "equip_lost", "card_used", "peach_save", "discard_phase_start"]) {
    assert.ok((SKILL_TRIGGERS as readonly string[]).includes(trigger), `SKILL_TRIGGERS 应包含拦截点 ${trigger}`);
  }
  for (const trigger of ["provide_response"]) {
    assert.ok((SKILL_TRIGGERS as readonly string[]).includes(trigger), `SKILL_TRIGGERS 应包含 Phase 7 拦截点 ${trigger}`);
  }
  for (const trigger of ["prepare_phase_start", "end_phase_start"]) {
    assert.ok((SKILL_TRIGGERS as readonly string[]).includes(trigger), `SKILL_TRIGGERS 应包含 Phase 8 触发点 ${trigger}`);
  }
  for (const trigger of ["dying"]) {
    assert.ok((SKILL_TRIGGERS as readonly string[]).includes(trigger), `SKILL_TRIGGERS 应包含 Phase 9 触发点 ${trigger}`);
  }
  for (const trigger of ["card_discarded"]) {
    assert.ok((SKILL_TRIGGERS as readonly string[]).includes(trigger), `SKILL_TRIGGERS 应包含 Phase 10 触发点 ${trigger}`);
  }
  assert.equal(SKILL_TRIGGERS.length, 16);
});

void test("Phase 9 dying：钩子在桃救援之前发出，可直接回血救人（无桃也存活）", async () => {
  const id = registerTestSkill("救命", {
    dying: (ctx, payload, logs) => {
      if (payload.actor && ctx.hasSkill(payload.actor, id)) {
        payload.actor.hp = 1;
        logs.push("TEST_DYING_HEALED");
      }
    },
  });
  const { game, players } = await setup();
  const [me, other] = players as [Player, Player];
  other.skills = [id];
  other.hp = 0;
  // 双方手里都没有桃：能活下来只能是 dying 钩子救的。
  me.hand = [];
  other.hand = [];

  const resolveDeaths = (game as unknown as { resolveDeaths(): Promise<string[]> }).resolveDeaths.bind(game);
  const logs = await resolveDeaths();

  assert.ok(logs.includes("TEST_DYING_HEALED"), logs.join(" / "));
  assert.equal(other.hp, 1);
  assert.equal(other.alive, true);
});

void test("Phase 9 dying：globalHook 可监听其他角色濒死（挽危模式）", async () => {
  const id = registerTestSkill(
    "舍身救人",
    {
      dying: (ctx, payload, logs) => {
        const holder = ctx.players.find((p) => ctx.hasSkill(p, id));
        const dying = payload.actor;
        if (!holder || !dying || dying.id === holder.id || !holder.alive) {
          return;
        }
        dying.hp = 1;
        holder.hp = 0;
        logs.push(`TEST_DYING_RESCUE:${dying.id}`);
      },
    },
    undefined,
    { globalHook: true },
  );
  const { game, players } = await setup();
  const [me, other] = players as [Player, Player];
  me.skills = [id];
  me.hp = 2;
  other.hp = 0;
  me.hand = [];
  other.hand = [];

  const resolveDeaths = (game as unknown as { resolveDeaths(): Promise<string[]> }).resolveDeaths.bind(game);
  const logs = await resolveDeaths();

  assert.ok(logs.some((line) => line === "TEST_DYING_RESCUE:p1"), logs.join(" / "));
  assert.equal(other.hp, 1, "被救者应回到 1 点体力");
  assert.equal(other.alive, true);
  // 救人者自损到 0 体力：他在同次结算里已被扫过（座位在前），靠重扫才不被漏掉；
  // 无桃可救，最终阵亡——关键是他得到了濒死结算，而不是带着 0 体力活着。
  assert.equal(me.hp, 0);
  assert.equal(me.alive, false, "救人者自损到 0 体力后应被重扫结算为阵亡（无桃）");
});

void test("Phase 9 轮次：回到起始座位时 round+1 且本轮已用标记清空", async () => {
  const { game, players } = await setup(2);
  const runtime = game as unknown as {
    round: number;
    roundStartIndex: number;
    currentPlayerIndex: number;
    staged: boolean;
    markSkillUsedThisRound(playerId: string, skill: string): void;
    isSkillUsedThisRound(playerId: string, skill: string): boolean;
  };
  // setup() 把 currentPlayerIndex 钉到 0，这里同步把轮次锚点也钉到 0；
  // staged 关掉，让 finishTurn 直接链到下个 startTurn。
  runtime.roundStartIndex = 0;
  runtime.staged = false;
  assert.equal(runtime.round, 1);
  assert.equal(runtime.currentPlayerIndex, 0);

  runtime.markSkillUsedThisRound("p0", "测试技能");
  assert.equal(runtime.isSkillUsedThisRound("p0", "测试技能"), true);

  const [me, other] = players as [Player, Player];
  await game.startTurn();
  await game.finishTurn(me);
  assert.equal(runtime.currentPlayerIndex, 1, "甲回合结束应轮到乙");
  assert.equal(runtime.round, 1, "未回到起始座位，轮次不变");
  assert.equal(runtime.isSkillUsedThisRound("p0", "测试技能"), true, "同轮内标记不应清空");

  await game.finishTurn(other);
  assert.equal(runtime.currentPlayerIndex, 0, "乙回合结束应回到甲");
  assert.equal(runtime.round, 2, "回到起始座位，轮次 +1");
  assert.equal(runtime.isSkillUsedThisRound("p0", "测试技能"), false, "新一轮开始，本轮标记应清空");
});

void test("Phase 8：prepare_phase_start 在判定阶段之前、end_phase_start 在结束阶段入口发出", async () => {
  const seen: string[] = [];
  const prepareId = registerTestSkill("准备", {
    prepare_phase_start: (ctx, payload, logs) => {
      if (payload.actor && ctx.hasSkill(payload.actor, "测试/准备")) {
        seen.push(`prepare:${payload.actor.id}`);
        logs.push("测试准备触发");
      }
    },
    end_phase_start: (ctx, payload, logs) => {
      if (payload.actor && ctx.hasSkill(payload.actor, "测试/准备")) {
        seen.push(`end:${payload.actor.id}`);
        logs.push("测试结束触发");
      }
    },
  });
  const { game, players } = await setup();
  const [me] = players as [Player, Player];
  me.skills = [prepareId];
  const logs = await game.startTurn();
  const prepareIndex = logs.findIndex((line) => line.includes("测试准备触发"));
  const judgmentIndex = logs.findIndex((line) => line.includes("进入判定阶段"));
  assert.ok(prepareIndex >= 0, `准备触发点应在回合开始时发出：${logs.join(" / ")}`);
  assert.ok(judgmentIndex >= 0, "应有判定阶段日志");
  assert.ok(prepareIndex < judgmentIndex, "准备触发点应在判定阶段之前");
  assert.deepEqual(seen, ["prepare:p0"]);

  const endLogs = await game.finishTurn(me);
  assert.ok(endLogs.some((line) => line.includes("测试结束触发")), `结束触发点应在结束阶段入口发出：${endLogs.join(" / ")}`);
  assert.deepEqual(seen, ["prepare:p0", "end:p0"]);
});

void test("端到端：加载 examples/generals 后，吕蒙的克己在真实对局里跳过弃牌阶段", async () => {
  const report = await loadGeneralPacks({ dir: join(process.cwd(), "examples", "generals"), pool: "all" });
  // examples/generals 里有吕蒙与神赵云两个包；这里只关心吕蒙。
  assert.deepEqual(report.errors, []);
  assert.ok(report.loaded.includes("吕蒙"), `吕蒙应被加载：${report.loaded.join("、")}`);
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

void test("端到端：加载 generals/诸葛瑾 后，弘援在摸牌阶段真正生效（回归：payload.player 笔误）", async () => {
  // 真包只读复制到临时目录再加载（与 generals:check 的 .check-tmp 同口径，不动原包）。
  const tmp = mkdtempSync(join(tmpdir(), "zhugejin-"));
  try {
    cpSync(join(process.cwd(), "generals", "诸葛瑾"), join(tmp, "诸葛瑾"), { recursive: true });
    const report = await loadGeneralPacks({ dir: tmp, pool: "all" });
    assert.deepEqual(report.errors, []);
    assert.ok(report.loaded.includes("诸葛瑾"), `诸葛瑾应被加载：${report.loaded.join("、")}`);
    const { game, players } = await setup();
    const [me, other] = players as [Player, Player];
    me.general = "诸葛瑾";
    me.skills = [...resolveGeneralByName("诸葛瑾").skills];
    assert.deepEqual(me.skills, ["诸葛瑾/弘援"]);
    approveEffects(game, [me.id, other.id]);

    const logs = await game.startTurn();
    assert.ok(
      logs.some((line) => line.includes("发动弘援")),
      `弘援应在摸牌阶段生效：${logs.join(" / ")}`,
    );
    assert.equal(me.hand.length, 1, "少摸一张：本应摸 2 张，实摸 1 张");
    assert.equal(other.hand.length, 1, "另一名角色应摸 1 张");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

void test("after_damage：钩子看到的是白银狮子压过之后的实际伤害", async () => {
  const seen: Array<number | undefined> = [];
  const id = registerTestSkill("记录伤害", {
    after_damage: (_ctx, payload) => {
      seen.push(payload.damage);
    },
  });
  const { game, players } = await setup();
  const [me, other] = players as [Player, Player];
  other.skills = [id];
  me.hand = [makeCard("wine", CardType.Wine), makeCard("slash", CardType.Slash)];
  other.hp = 4;
  other.hand = [];
  other.armor = CardType.SilverLion;

  const wine = game.getPlayableActions(me.id).find((action) => action.type === "play" && action.cardIndex === 0);
  assert.ok(wine, "应能使用酒");
  await game.playAction(me.id, wine);
  const slash = game.getPlayableActions(me.id).find((action) => action.type === "play" && action.cardIndex === 0);
  assert.ok(slash, "喝酒后应能出杀");
  const logs = await game.playAction(me.id, slash, other.id);

  assert.equal(other.hp, 3, logs.join(" / "));
  assert.deepEqual(seen, [1], `after_damage 应传封顶后的 1 点而非原始 2 点：${logs.join(" / ")}`);
});
