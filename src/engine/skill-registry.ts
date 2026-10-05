import { CardColor, CardSuit, CardType } from "./cards.js";
import { ResponseKind } from "./interaction.js";
import { BuiltinSkillId, Player, SkillId, SkillName, SkillTrigger } from "./types.js";
import { getPackSkill } from "./skill-module.js";

export type SkillKind = "active" | "triggered" | "conversion" | "passive" | "lord";

/**
 * 主动技能的目标取向：让 AI（本地策略 / Jev / LLM）知道该技能的 `targets` 是敌人还是队友，
 * 避免把"青囊/结姻/仁德"这类支援技丢到敌方身上。只影响 AI 的选目标启发式，不影响引擎合法性校验。
 * - `enemy`：敌方（杀/强袭/反间/离间…）
 * - `ally`：己方或自己（青囊/仁德/结姻/制霸…）
 * - `any`：无所谓（默认）
 */
export type SkillTargetIntent = "enemy" | "ally" | "any";

export const SKILL_TARGET_INTENTS: SkillTargetIntent[] = ["enemy", "ally", "any"];

/** 目标免疫可覆盖的牌类（targetImmunity.cards 的取值）。 */
export type TargetImmunityCard = "slash" | "duel" | "snatch" | "indulgence" | "supplies-cut";

/**
 * 声明式规则数值/豁免词汇表（Phase 3）。内置技能与外部武将包的 `.skill.json` 共用同一套字段，
 * 由 `skill-rules.ts` 的谓词层消费。合并语义见各字段注释。
 */
export type SkillRules = {
  /** 计算与其他角色的距离时 -N（求和）。下限仍由距离计算函数兜底。 */
  distanceDelta?: number;
  /** 使用受距离限制的锦囊（顺手牵羊/兵粮寸断）无距离限制（OR）。 */
  trickDistanceExempt?: boolean;
  /** 出牌阶段使用杀无次数限制（OR）。 */
  slashLimitExempt?: boolean;
  /** 需要 N 张闪/杀响应（取最大值，默认 1）。 */
  responseMultiplier?: number;
  /** 不能成为某些牌的目标（并集）；requireEmptyHand 为真时还需手牌为空（空城）。 */
  targetImmunity?: { cards: TargetImmunityCard[]; requireEmptyHand?: boolean };
  /** 摸牌阶段摸牌数 ±N（求和；由 before_draw 钩子消费）。 */
  drawPhaseDelta?: number;
  /** 杀/决斗伤害 ±N（求和；由「本回合已发动技能」求和消费）。 */
  damageDelta?: number;
  /** 被桃救时额外回复 N（求和）。 */
  peachSaveBonus?: number;
  /**
   * 本回合未使用/打出过杀时，可以跳过弃牌阶段（OR；Phase 6 新增）。
   * 由 `game.ts` 的弃牌阶段入口消费，需要玩家确认发动（`optional` 语义）。
   */
  skipDiscardPhaseIfNoSlash?: boolean;
  /**
   * 手牌上限 +N（求和；默认手牌上限 = 当前体力值）。
   * 由 `skill-rules.ts` 的 `getHandLimit` 消费，弃牌阶段（`endPlayPhase` / `discardForCurrentPlayer` /
   * `getPendingDiscardCount`）与 UI 提示统一走它。
   */
  handLimitDelta?: number;
};

/**
 * `SkillRules` 词表的**单一真相**（键 → 值类型），供校验器（`src/tools/generals-check.ts`）、
 * 文档与测试查询；`general-pack.ts` 的 `validateRules` 按同一批键做逐键类型校验。
 * 新增声明式规则时改这里 + `SkillRules` + `validateRules` + `docs/generals-pack-api.md`（测试会卡住漏改）。
 */
export const SKILL_RULE_KEY_KINDS = {
  distanceDelta: "number",
  trickDistanceExempt: "boolean",
  slashLimitExempt: "boolean",
  responseMultiplier: "number",
  targetImmunity: "targetImmunity",
  drawPhaseDelta: "number",
  damageDelta: "number",
  peachSaveBonus: "number",
  skipDiscardPhaseIfNoSlash: "boolean",
  handLimitDelta: "number",
} as const;

export type SkillRuleKey = keyof typeof SKILL_RULE_KEY_KINDS;

/**
 * 当牌转换（Phase 7）：把满足 `from` 的牌当作 `to` 使用或打出。
 *
 * - `from` 的三个条件之间是 **AND**（都不给 = 任何牌都能变，慎用）；
 * - `to` 只支持引擎真正结算得了的牌类：`杀/火杀/雷杀/桃/闪/无懈可击`
 *   （其他牌类如延时锦囊需要目标/距离/判定区逻辑，loader 会明确拒绝）；
 * - `asResponse` 列出可作为哪些响应打出（闪/杀/无懈可击/桃）；缺省 = 只能在出牌阶段主动使用。
 *
 * 出牌阶段主动使用时走 `GameAction.convertVia`/`convertTo`（`cardIndex = -10000 - 手牌下标`）。
 * **内置技能（武圣/龙胆/国色/倾国/急救）仍是各自硬编码的分支**，不要给它们再填 `conversion`，否则会重复枚举。
 */
export type SkillConversion = {
  from: {
    suit?: CardSuit[];
    color?: CardColor[];
    type?: CardType[];
  };
  to: CardType;
  asResponse?: ResponseKind[];
};

/** `conversion.to` 允许的牌类（引擎有对应结算路径）。 */
export const CONVERTIBLE_CARD_TYPES: CardType[] = [
  CardType.Slash,
  CardType.FireSlash,
  CardType.ThunderSlash,
  CardType.Peach,
  CardType.Dodge,
  CardType.Negate,
];

/** 可作为响应打出的牌类 → 响应时机。 */
export const CONVERSION_RESPONSE_KINDS: ResponseKind[] = ["dodge", "slash", "negate", "peach"];

export type SkillDescriptor = {
  id: SkillId;
  kind: SkillKind;
  description: string;
  /** 展示名（UI/AI）。内置技能缺省即 id；外部包为声明的中文名。 */
  displayName?: string;
  triggers?: SkillTrigger[];
  optional?: boolean;
  priority?: number;
  label?: string;
  /** 主动技能的目标取向（供 AI 选择目标；缺省视为 `any`）。 */
  targetIntent?: SkillTargetIntent;
  /** 声明式规则数值/豁免（Phase 3 谓词层消费）。 */
  rules?: SkillRules;
  /**
   * 手牌上限修正的**运行时**版本：纯函数，只读传入的 `player`，返回值就地累加。
   * 用于"手牌上限 +X（X 为运行时变量，如已损失体力值）"这类 `rules.handLimitDelta` 表达不了的技能。
   * 由 `skill-rules.ts` 的 `getHandLimit` 消费；必须**纯**（不能读全局状态），否则 UI 与引擎会算出不同结果。
   */
  handLimit?: (player: Player) => number;
  /**
   * 当牌转换（Phase 7）：把满足 `from` 的牌当作 `to` 使用或打出。**一个技能可以声明多条**
   * （龙魂就是 4 条：红桃→桃、方块→火杀、梅花→闪、黑桃→无懈可击）。
   */
  conversions?: SkillConversion[];
};

const triggered = (
  id: SkillId,
  triggers: SkillTrigger[],
  description: string,
  extra?: Partial<SkillDescriptor>,
): SkillDescriptor => ({ id, kind: "triggered", triggers, description, ...extra });

const active = (id: SkillId, description: string, extra?: Partial<SkillDescriptor>): SkillDescriptor => ({
  id,
  kind: "active",
  description,
  ...extra,
});

const conversion = (id: SkillId, description: string, extra?: Partial<SkillDescriptor>): SkillDescriptor => ({
  id,
  kind: "conversion",
  description,
  ...extra,
});

const passive = (id: SkillId, description: string, extra?: Partial<SkillDescriptor>): SkillDescriptor => ({
  id,
  kind: "passive",
  description,
  ...extra,
});

const lord = (id: SkillId, description: string, extra?: Partial<SkillDescriptor>): SkillDescriptor => ({
  id,
  kind: "lord",
  description,
  ...extra,
});

export const SKILL_REGISTRY: Record<BuiltinSkillId, SkillDescriptor> = {
  [SkillName.Heroic]: triggered(
    SkillName.Heroic,
    ["before_draw"],
    "摸牌阶段开始时可发动，额外摸 1 张牌。",
    { optional: true, rules: { drawPhaseDelta: 1 } },
  ),
  [SkillName.Roar]: passive(SkillName.Roar, "锁定技：出牌阶段使用杀无次数限制。", {
    rules: { slashLimitExempt: true },
  }),
  [SkillName.Assault]: active(
    SkillName.Assault,
    "出牌阶段每回合限一次：弃置 1 张牌（手牌或装备），对攻击范围内 1 名角色造成 1 点伤害。",
    { targetIntent: "enemy" },
  ),
  [SkillName.JuShou]: triggered(
    SkillName.JuShou,
    [],
    "结束阶段可发动：摸 3 张牌并将武将牌翻至背面。",
    { optional: true },
  ),
  [SkillName.JieWei]: triggered(
    SkillName.JieWei,
    [],
    "武将牌翻至正面时可发动（回合开始跳过时也一样）：摸 1 张牌。",
    { optional: true },
  ),
  [SkillName.JianXiong]: triggered(
    SkillName.JianXiong,
    ["after_damage"],
    "受到伤害后可发动：获得造成本次伤害的牌（通常已在弃牌堆）。",
    { optional: true },
  ),
  [SkillName.HuJia]: lord(SkillName.HuJia, "主公技：需要闪时，可按座次请求其他魏势力角色代为打出闪。"),
  [SkillName.QingGuo]: conversion(SkillName.QingGuo, "可将黑色手牌当闪使用或打出。"),
  [SkillName.LuoShen]: triggered(
    SkillName.LuoShen,
    ["turn_start"],
    "回合开始时可发动：连续判定牌堆顶牌，黑色则获得之并继续，红色则弃置并停止。",
    { optional: true },
  ),
  [SkillName.GangLie]: triggered(
    SkillName.GangLie,
    ["after_damage"],
    "受到伤害后可发动：判定，若非红桃，来源需弃 2 张牌，否则受到你造成的 1 点伤害。",
    { optional: true },
  ),
  [SkillName.LuoYi]: triggered(
    SkillName.LuoYi,
    ["before_draw"],
    "摸牌阶段开始时可发动：本回合少摸 1 张牌，你本回合的杀与决斗伤害 +1。",
    { optional: true, rules: { drawPhaseDelta: -1, damageDelta: 1 } },
  ),
  [SkillName.TuXi]: triggered(
    SkillName.TuXi,
    ["before_draw"],
    "摸牌阶段开始时可发动：跳过摸牌，改为从至多两名手牌最多的角色处各获得 1 张手牌。",
    { optional: true },
  ),
  [SkillName.TianDu]: triggered(
    SkillName.TianDu,
    [],
    "你的判定牌生效后可发动：获得该判定牌。",
    { optional: true },
  ),
  // NOTE(§8歧义4)：实现是自己摸 2 张，不可分配；rules.md 写"可分配"与实现冲突，以代码为准。
  [SkillName.YiJi]: triggered(
    SkillName.YiJi,
    ["after_damage"],
    "每受到 1 点伤害后可发动（可多次触发）：自己摸 2 张牌。",
    { optional: true },
  ),
  [SkillName.FanKui]: triggered(
    SkillName.FanKui,
    ["after_damage"],
    "受到伤害后可发动：获得来源 1 张牌（手牌或装备）。",
    { optional: true },
  ),
  [SkillName.GuiCai]: triggered(
    SkillName.GuiCai,
    [],
    "任意判定生效前可用 1 张手牌替换判定牌（询问所有存活的鬼才持有者）。",
  ),
  [SkillName.RenDe]: active(
    SkillName.RenDe,
    "出牌阶段可反复发动（每次给 1 张手牌，每张一次询问）：将手牌交给其他角色；本回合累计给出 2 张时回复 1 点体力。",
    { targetIntent: "ally" },
  ),
  [SkillName.JiJiang]: lord(SkillName.JiJiang, "主公技：需要杀时，可按座次请求其他蜀势力角色代为打出杀。"),
  [SkillName.WuSheng]: conversion(SkillName.WuSheng, "可将红色牌（手牌或木牛流马下）当杀使用或打出。"),
  [SkillName.LongDan]: conversion(SkillName.LongDan, "可将杀当闪、闪当杀使用或打出。"),
  [SkillName.MaShu]: passive(SkillName.MaShu, "锁定技：你计算与其他角色的距离 -1（下限 1）。", {
    rules: { distanceDelta: 1 },
  }),
  [SkillName.TieQi]: triggered(
    SkillName.TieQi,
    [],
    "使用杀指定目标后可发动：判定，红色则此杀不可被闪避。",
    { optional: true },
  ),
  [SkillName.GuanXing]: triggered(
    SkillName.GuanXing,
    ["turn_start"],
    "回合开始时可发动：观看牌堆顶至多 5 张（存活人数上限），逐张选择保留在牌堆顶，其余置入牌堆底。",
    { optional: true },
  ),
  [SkillName.KongCheng]: passive(SkillName.KongCheng, "锁定技：无手牌时不能成为杀或决斗的目标。", {
    rules: { targetImmunity: { cards: ["slash", "duel"], requireEmptyHand: true } },
  }),
  [SkillName.JiZhi]: triggered(
    SkillName.JiZhi,
    [],
    "使用非延时锦囊结算后可发动：摸 1 张牌。",
    { optional: true },
  ),
  [SkillName.QiCai]: passive(SkillName.QiCai, "锁定技：使用受距离限制的锦囊（顺手牵羊、兵粮寸断）无距离限制。", {
    rules: { trickDistanceExempt: true },
  }),
  [SkillName.ZhiHeng]: active(
    SkillName.ZhiHeng,
    "出牌阶段限一次：弃置任意张牌（张数自选、可只弃 1 张、可含装备区；一张都不弃视为未发动、不消耗次数），摸等量牌。",
  ),
  [SkillName.JiuYuan]: lord(
    SkillName.JiuYuan,
    "主公技：其他吴势力角色用桃救你时，你额外回复 1 点体力。",
    { rules: { peachSaveBonus: 1 } },
  ),
  [SkillName.FanJian]: active(
    SkillName.FanJian,
    "出牌阶段限一次：令 1 名角色声明一种花色并获得你 1 张手牌，若花色猜错则其受到你造成的 1 点伤害。",
    { targetIntent: "enemy" },
  ),
  [SkillName.KuRou]: active(SkillName.KuRou, "出牌阶段可发动：失去 1 点体力并摸 2 张牌。"),
  [SkillName.QianXun]: passive(SkillName.QianXun, "锁定技：不能成为顺手牵羊与乐不思蜀的目标。", {
    rules: { targetImmunity: { cards: ["snatch", "indulgence"] } },
  }),
  [SkillName.LianYing]: triggered(
    SkillName.LianYing,
    [],
    "失去最后 1 张手牌时可发动：摸 1 张牌。",
    { optional: true },
  ),
  [SkillName.GuoSe]: conversion(
    SkillName.GuoSe,
    "可将方片牌当乐不思蜀使用（出牌阶段按锦囊使用规则）。",
  ),
  [SkillName.LiuLi]: triggered(
    SkillName.LiuLi,
    [],
    "成为杀的目标时可发动：弃置 1 张牌，将此杀转移给你攻击范围内的一名其他角色。",
    { optional: true },
  ),
  [SkillName.JieYin]: active(
    SkillName.JieYin,
    "出牌阶段限一次：弃置 2 张手牌，令你与 1 名受伤男性角色各回复 1 点体力。",
    { targetIntent: "ally" },
  ),
  [SkillName.XiaoJi]: triggered(
    SkillName.XiaoJi,
    [],
    "失去装备区里的牌时（被弃置、被顺走或被换装）：每失去 1 张摸 2 张牌。",
  ),
  [SkillName.WuShuang]: passive(
    SkillName.WuShuang,
    "锁定技：你的杀需 2 张闪抵消；你参与的决斗，对方每次需打出 2 张杀响应。",
    { rules: { responseMultiplier: 2 } },
  ),
  [SkillName.LiJian]: active(
    SkillName.LiJian,
    "出牌阶段限一次：弃置 1 张牌，令两名男性角色相互决斗（你选择出杀方）。",
    { targetIntent: "enemy" },
  ),
  [SkillName.BiYue]: triggered(
    SkillName.BiYue,
    [],
    "结束阶段可发动：摸 1 张牌。",
    { optional: true },
  ),
  [SkillName.QingNang]: active(
    SkillName.QingNang,
    "出牌阶段限一次：弃置 1 张手牌，令 1 名受伤角色回复 1 点体力。",
    { targetIntent: "ally" },
  ),
  [SkillName.JiJiu]: conversion(
    SkillName.JiJiu,
    "队友濒死求桃时，可将红色手牌当桃使用（自己濒死时不可对自己发动）。",
  ),
  // NOTE(§8问题6)：决斗与杀均按牌色判定（红色才触发）；无牌来源的技能型决斗（离间）不触发。
  [SkillName.JiAng]: triggered(
    SkillName.JiAng,
    [],
    "使用或成为红色杀/红色决斗的目标时，双方有激昂者可各摸 1 张牌。",
    { optional: true },
  ),
  [SkillName.HunZi]: triggered(
    SkillName.HunZi,
    ["turn_start", "after_damage"],
    "觉醒技：体力值降到 1 时（含回合开始），体力上限 -1 并获得英姿、英魂。",
  ),
  [SkillName.YingHun]: triggered(
    SkillName.YingHun,
    ["turn_start"],
    "回合开始时可发动：令 1 名其他角色按你已损失体力摸牌并弃牌（摸 X 弃 1 或摸 1 弃 X，二选一随机）。",
    { optional: true },
  ),
  [SkillName.ZhiBa]: active(
    SkillName.ZhiBa,
    "出牌阶段限一次：与有制霸的主公拼点；你未赢则主公获得两张拼点牌，赢则按拼点规则结算（已觉醒的主公拒绝拼点）。",
    { targetIntent: "ally" },
  ),
};

/**
 * 已实现、但**不归属任何内置武将**的内置技能（§8 问题 1 的受控状态）：
 * - 强袭：供测试与外部武将包引用；
 * - 英魂：仅由魂姿觉醒获得，无武将直接声明。
 * 双向校验测试据此放行，而不是各写一份白名单。
 */
export const UNOWNED_BUILTIN_SKILLS: ReadonlySet<SkillId> = new Set([SkillName.Assault, SkillName.YingHun]);

const UNKNOWN_SKILL = (id: SkillId): SkillDescriptor => ({
  id,
  kind: "passive",
  description: `未知技能（${id}）`,
  displayName: id,
});

/** 已警告过的未知技能 id（去重：`resolveSkillDescriptor` 在热路径上被反复调用）。 */
const warnedUnknownSkills = new Set<SkillId>();

/** 内置注册表查询（外部技能不会命中）；未知 id 兜底为无效果被动技并警告一次（多为拼写错误）。 */
export function describeSkill(id: SkillId): SkillDescriptor {
  const found = (SKILL_REGISTRY as Record<SkillId, SkillDescriptor | undefined>)[id];
  if (found) {
    return found;
  }
  if (!warnedUnknownSkills.has(id)) {
    warnedUnknownSkills.add(id);
    console.warn(`[skill-registry] 未知技能 id「${id}」，已按无效果被动技处理（请检查拼写或技能注册）`);
  }
  return UNKNOWN_SKILL(id);
}

/** 统一查询：先外部武将包注册表，再回落内置，最后兜底“未知技能”。 */
export function resolveSkillDescriptor(id: SkillId): SkillDescriptor {
  const packSkill = getPackSkill(id);
  if (packSkill) {
    return packSkill;
  }
  return describeSkill(id);
}
