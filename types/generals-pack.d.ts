/**
 * CLI 三国杀 · 外部武将包作者类型契约（计划 §17 的 ③）
 *
 * 这个文件是**给武将包作者用的独立类型声明**：不依赖 `src/`，让"只能读 API 文档 +
 * 本文件 + `schema/`"的人也能拿到 `SkillModule` 与 `SkillModuleCtx` 的完整签名。
 *
 * 用法（代码技能 `<技能名>.skill.ts`）：
 *
 * ```ts
 * // 若包放在 <仓库根>/generals/<武将>/ 下：
 * import type { SkillModule, SkillModuleCtx } from "../../types/generals-pack.js";
 * // 若包放在 <仓库根>/examples/generals/<武将>/ 下，多一层：
 * // import type { SkillModule, SkillModuleCtx } from "../../../types/generals-pack.js";
 *
 * export default {
 *   id: "示例",
 *   displayName: "示例",
 *   kind: "triggered",
 *   description: "……",
 *   triggers: ["after_damage"],
 *   onTrigger: {
 *     after_damage: (ctx, payload, logs) => {
 *       const target = payload.target;      // 触发相关玩家
 *       if (!target) return;
 *       ctx.drawCards(target.id, 1);        // 只能用 ctx 暴露的能力
 *       logs.push(`${target.name} 摸 1 张`);
 *     },
 *   },
 * } satisfies SkillModule;
 * ```
 *
 * 说明：
 * - 类型只在开发期生效（`import type` 运行时被擦除），因此这个相对路径**不影响加载**；
 *   引擎实际加载的是对象字面量，字段名与语义以 `docs/generals-pack-api.md` 为准。
 * - 这里的 `CardType` 等是**字符串字面量联合**（不是 TS enum）：直接写 `"闪"` 即可，
 *   不需要（也无法）在运行时 import 引擎的枚举。
 * - 只读遍历 `ctx.players` / `player.hand` 是允许的；**修改引擎状态必须走 ctx 方法**，
 *   否则会绕过日志/钩子（例如"失去手牌"必须走 `removeHandCardAt`，否则连营不触发）。
 * - 禁止 `Math.random`，用 `ctx.randomIndex(n)`（`--seed` 复现与联机一致性依赖它）。
 *
 * 本文件与真实实现的漂移由 `src/tools/generals-pack-types.test.ts` 卡住（成员名 + 联合成员逐项比对）。
 */

/** 牌的颜色；`colorless` 是无色（装备/部分锦囊）。 */
export type CardColor = "red" | "black" | "colorless";

/** 牌的花色；`none` 是无花色（技术值，不作为当牌转换的筛选条件）。 */
export type CardSuit = "heart" | "diamond" | "club" | "spade" | "none";

/** 牌类（官方标准版 + 军争篇 + 木牛流马）。 */
export type CardType =
  | "杀"
  | "火杀"
  | "雷杀"
  | "闪"
  | "桃"
  | "酒"
  | "过河拆桥"
  | "顺手牵羊"
  | "决斗"
  | "无中生有"
  | "南蛮入侵"
  | "万箭齐发"
  | "借刀杀人"
  | "无懈可击"
  | "桃园结义"
  | "五谷丰登"
  | "火攻"
  | "铁索连环"
  | "诸葛连弩"
  | "雌雄双股剑"
  | "青釭剑"
  | "寒冰剑"
  | "银月枪"
  | "古锭刀"
  | "丈八蛇矛"
  | "青龙偃月刀"
  | "贯石斧"
  | "方天画戟"
  | "麒麟弓"
  | "朱雀羽扇"
  | "八卦阵"
  | "仁王盾"
  | "藤甲"
  | "白银狮子"
  | "的卢"
  | "绝影"
  | "爪黄飞电"
  | "骅骝"
  | "赤兔"
  | "大宛"
  | "紫骍"
  | "木牛流马"
  | "乐不思蜀"
  | "兵粮寸断"
  | "闪电";

export type Card = {
  id: string;
  type: CardType;
  color: CardColor;
  suit: CardSuit;
  rank: number;
};

export type PlayerRole = "主公" | "忠臣" | "反贼" | "内奸";

export type TurnPhase = "判定阶段" | "摸牌阶段" | "出牌阶段" | "弃牌阶段" | "结束阶段";

/** `ctx.useSlash` 的杀类型（火杀/雷杀触发藤甲/铁索等）。 */
export type SlashKind = "normal" | "fire" | "thunder";

/** 属性伤害类型（`ctx.applyDamage` 的 `damageKind`）。 */
export type DamageKind = "fire" | "thunder";

/** 响应时机：闪 / 杀 / 无懈可击 / 桃。 */
export type ResponseKind = "dodge" | "slash" | "negate" | "peach";

/** 可选牌来源的区域。 */
export type CardOrigin = "hand" | "treasure" | "equip";

/**
 * 触发点与拦截点（共 12 个）。**单一真相**是 `src/engine/types.ts` 的 `SKILL_TRIGGERS`，
 * loader 只接受这里的字符串，写错会被静默丢弃（`npm run generals:check` 会报出来）。
 *
 * - 事件类：`turn_start` / `before_draw` / `before_damage` / `after_damage`
 * - 拦截类：`judgment` / `slash_targeted` / `hand_card_lost` / `equip_lost` /
 *   `card_used` / `peach_save` / `discard_phase_start` / `provide_response`
 */
export type SkillTrigger =
  | "turn_start"
  | "before_draw"
  | "before_damage"
  | "after_damage"
  | "judgment"
  | "slash_targeted"
  | "hand_card_lost"
  | "equip_lost"
  | "card_used"
  | "peach_save"
  | "discard_phase_start"
  | "provide_response";

export type SkillKind = "active" | "triggered" | "conversion" | "passive" | "lord";

/** 主动技能的目标取向（只影响 AI 选目标，不参与合法性校验）。 */
export type SkillTargetIntent = "enemy" | "ally" | "any";

/** `rules.targetImmunity.cards` 允许的牌类。 */
export type TargetImmunityCard = "slash" | "duel" | "snatch" | "indulgence" | "supplies-cut";

export type WeaponType =
  | "诸葛连弩"
  | "雌雄双股剑"
  | "青釭剑"
  | "寒冰剑"
  | "银月枪"
  | "古锭刀"
  | "丈八蛇矛"
  | "青龙偃月刀"
  | "贯石斧"
  | "方天画戟"
  | "麒麟弓"
  | "朱雀羽扇";
export type ArmorType = "八卦阵" | "仁王盾" | "藤甲" | "白银狮子";
export type DefenseHorseType = "的卢" | "绝影" | "爪黄飞电" | "骅骝";
export type AttackHorseType = "赤兔" | "大宛" | "紫骍";
export type TreasureType = "木牛流马";

/** 判定区里的一张延时锦囊（`player.delayedTricks` 的元素）。 */
export type DelayedTrickEntry = { cardType: CardType; sourcePlayerId: string; card?: Card };

/** 玩家状态（只读视图；改动必须走 ctx 方法）。 */
export type Player = {
  id: string;
  name: string;
  role: PlayerRole;
  gender: "男" | "女";
  general: string;
  /** 技能 id 列表：内置技能就是中文技能名，外部技能是 `<文件夹名>/<技能名>`。 */
  skills: string[];
  isAI: boolean;
  hp: number;
  maxHp: number;
  hand: Card[];
  weapon: WeaponType | null;
  armor: ArmorType | null;
  defenseHorse: DefenseHorseType | null;
  attackHorse: AttackHorseType | null;
  treasure: TreasureType | null;
  /** 木牛流马里的牌（也算手牌上限；用 ctx 的 sources 接口操作）。 */
  treasureCards: Card[];
  delayedTricks: DelayedTrickEntry[];
  alive: boolean;
  faceDown: boolean;
  /** 铁索连环（横置）状态。 */
  chained: boolean;
};

export type GeneralDefinition = {
  kingdom: string;
  name: string;
  gender: "男" | "女";
  maxHp: number;
  skills: string[];
  description?: string;
};

/**
 * 声明式规则词汇表（`rules`）；语义与合并方式见 `docs/generals-pack-api.md`「规则词汇表」。
 * 固定数值用这里，运行时变量用代码技能的 `handLimit(player)`。
 */
export type SkillRules = {
  /** 计算距离时 -N（求和）。 */
  distanceDelta?: number;
  /** 使用受距离限制的锦囊无距离限制（OR）。 */
  trickDistanceExempt?: boolean;
  /** 出牌阶段使用【杀】无次数限制（OR）。 */
  slashLimitExempt?: boolean;
  /** 需 N 张闪/杀响应（取最大，默认 1）。 */
  responseMultiplier?: number;
  /** 不能成为某些牌的目标（并集）。 */
  targetImmunity?: { cards: TargetImmunityCard[]; requireEmptyHand?: boolean };
  /** 摸牌阶段摸牌数 ±N（求和）。 */
  drawPhaseDelta?: number;
  /** 【杀】/【决斗】伤害 ±N（求和，仅本回合已发动的技能）。 */
  damageDelta?: number;
  /** 被【桃】救起时额外回复 N（求和）。 */
  peachSaveBonus?: number;
  /** 本回合未使用/打出过【杀】时可跳过弃牌阶段（OR）。 */
  skipDiscardPhaseIfNoSlash?: boolean;
  /** 手牌上限 +N（求和；默认上限 = 当前体力值）。 */
  handLimitDelta?: number;
};

/** 当牌转换：把满足 `from` 的牌当作 `to` 使用或打出。 */
export type SkillConversion = {
  from: {
    suit?: CardSuit[];
    color?: CardColor[];
    type?: CardType[];
  };
  /** 只放行 `杀/火杀/雷杀/桃/闪/无懈可击`；其他牌类 loader 报错。 */
  to: CardType;
  /** 可作为哪些响应时机打出；必须与 `to` 对得上。缺省 = 只能在出牌阶段主动使用。 */
  asResponse?: ResponseKind[];
};

/** 触发钩子收到的上下文数据；只有部分字段对特定触发点有意义（见各字段注释）。 */
export type SkillEventPayload = {
  /** 触发相关玩家（多数触发点的"你"）。 */
  actor?: Player;
  source?: Player | null;
  target?: Player;
  /** `before_draw`：可改写摸牌数。 */
  drawCount?: number;
  damage?: number;
  /** `card_used`：`"使用"` 或 `"打出"`；其他触发点含义另见文档。 */
  reason?: string;
  card?: Card;
  /** `judgment`：判定牌；改成别的牌 = 改判（替换牌须由钩子自己从原区域移除）。 */
  judgmentCard?: Card;
  /** `equip_lost`：失去的装备牌类（装备区没有 Card 实体）。 */
  equip?: CardType;
  /** `slash_targeted`：置 `true` 取消本次杀。 */
  canceled?: boolean;
  /** `discard_phase_start`：置 `true` 跳过整个弃牌阶段。 */
  skipDiscardPhase?: boolean;
  /** `peach_save`：累加"每张桃额外回复"的点数。 */
  peachSaveBonus?: number;
  /** `provide_response`：本次要响应的时机。 */
  need?: ResponseKind;
  /** `provide_response`：可选来源；钩子可就地 push（来源必须带 `viaSkill`）。 */
  responseSources?: CardSource[];
};

/** 一个可选牌来源（手牌 / 木牛内牌 / 装备区）。 */
export type CardSource = {
  sourceId: string;
  origin: CardOrigin;
  card?: Card;
  label: string;
  /** 当牌转换来源的技能 id（防伪造凭据）。 */
  viaSkill?: string;
  /** 当牌转换成的牌类。 */
  asType?: CardType;
};

export type InteractionTrigger = { cardName: string; actorId: string };

export type InteractionRequest =
  | {
      kind: "respond";
      requestId: number;
      responderId: string;
      trigger: InteractionTrigger;
      responseKind: ResponseKind;
      sources: CardSource[];
      allowPass: true;
      reason: string;
    }
  | {
      kind: "collateral";
      requestId: number;
      targetId: string;
      actorId: string;
      victims: string[];
      sources: CardSource[];
      allowHandOverWeapon: boolean;
      reason: string;
    }
  | {
      kind: "choose-discard";
      requestId: number;
      playerId: string;
      reason: string;
      sources: CardSource[];
      count: number;
      allowPass: boolean;
      passLabel?: string;
    }
  | {
      kind: "choose-suit";
      requestId: number;
      playerId: string;
      reason: string;
      suits: CardSuit[];
    }
  | {
      kind: "optional-effect";
      requestId: number;
      playerId: string;
      effect: string;
      reason: string;
    };

export type InteractionDecision =
  | { choice: "pass" }
  | { choice: "card"; sourceId: string }
  | { choice: "target"; targetId: string; sourceId?: string }
  | { choice: "suit"; suit: CardSuit }
  | { choice: "effect"; enabled: boolean };

/**
 * 代码技能能用的引擎能力集合（运行时就是存活的对局实例）。
 *
 * 隐式约定（漏做会**静默**坏掉，详见 `docs/generals-pack-api.md`）：
 * - `requestDiscardSelection` 返回的牌**不会自动进弃牌堆**，调用方要自己 `ctx.discardPile.push`；
 * - 造成伤害后必须走 `resolveDeaths()` → `resolveWinner()` → `advanceIfCurrentPlayerDead(logs)`；
 * - 失去手牌必须走 `removeHandCardAt`，否则连营等"失去手牌"技能不触发；
 * - `judgment` 改判时替换牌要从原区域移除，引擎只负责把它置入弃牌堆；
 * - 别在钩子里做会再次触发同一钩子的事（`card_used` 里再"使用"牌会无限递归）；
 * - 触发钩子里**无法交互式选目标**（`InteractionRequest` 没有"选玩家"类型）：
 *   需要选人的效果请像内置「英魂」那样自动挑选，或把技能做成 `kind: "active"` + `getTargets`。
 */
export type SkillModuleCtx = {
  /** 全部玩家（只读遍历；改状态用下面的方法）。 */
  players: Player[];
  discardPile: Card[];
  currentPlayer: Player;
  phase: TurnPhase;
  slashUsedThisTurn: boolean;
  rng: () => number;
  skillUsedThisTurn: Map<string, Set<string>>;
  skillCountsThisTurn: Map<string, Map<string, number>>;
  skillFlagsThisTurn: Map<string, Set<string>>;
  optionalEffectDecisions: Map<string, boolean>;
  /** 按 id 取玩家；不存在即抛错。 */
  mustGetPlayer(id: string): Player;
  /** 引擎 RNG（禁止 Math.random）。 */
  randomIndex(length: number): number;
  /** 问一次交互（返回决策；无人应答时引擎给默认）。 */
  decide(request: InteractionRequest): Promise<InteractionDecision>;
  nextInteractionId(): number;
  hasSkill(player: Player, skill: string): boolean;
  markSkillUsed(playerId: string, skill: string): void;
  shouldActivateOptionalEffect(player: Player, effect: string): Promise<boolean>;
  /** 玩家可用的全部来源（手牌 + 木牛内牌），统一编号。 */
  buildUsableSources(player: Player): CardSource[];
  requestDiscardSelection(player: Player, count: number, reason: string, providedSources?: CardSource[]): Promise<Card[]>;
  /** "弃置任意张牌"：逐张询问直到放弃，返回实际弃置张数（已入弃牌堆并结算失去装备）。 */
  requestFlexibleDiscard(player: Player, reason: string, logs: string[]): Promise<number>;
  removeUsableCardBySourceId(player: Player, sourceId: string): Promise<Card | undefined>;
  removeHandCardAt(player: Player, index: number, logs?: string[]): Promise<Card | undefined>;
  /** 摸牌（从牌堆顶）。 */
  drawCard(): Card | null;
  drawCards(playerId: string, count: number): number;
  drawTopCards(count: number): Card[];
  placeCardsOnTop(cards: Card[]): void;
  placeCardsOnBottom(cards: Card[]): void;
  discardFromPlayerHand(player: Player, count: number, logs: string[]): Promise<number>;
  discardSelfCards(player: Player, count: number): Promise<string[]>;
  takeRandomHandCard(player: Player, receiver: Player): Promise<Card | undefined>;
  hasRemovableCard(player: Player): boolean;
  removeRandomCardFromPlayer(player: Player, mode: "弃置" | "获得", receiver?: Player): Promise<string[]>;
  /** 判定：翻一张判定牌（会自动触发 `judgment` 钩子）。 */
  drawJudgmentCard(reason: string, logs: string[], owner: Player): Promise<Card | null>;
  /** 造成伤害（**之后必须自己结算死亡/胜负**）。 */
  applyDamage(
    source: Player | null,
    target: Player,
    amount: number,
    reason: string,
    logs: string[],
    damageCard?: Card,
    damageKind?: DamageKind | null,
    isChainSpread?: boolean,
  ): Promise<void>;
  resolveDuel(user: Player, target: Player): Promise<string[]>;
  /**
   * 完整结算一张杀（含闪响应/铁骑/藤甲/濒死/胜负/回合推进）。
   * 调用方自己负责把源牌移出手牌并置入弃牌堆，并把 `card` 传进来当伤害来源牌。
   */
  useSlash(
    attacker: Player,
    target: Player,
    options?: { kind?: SlashKind; card?: Card; fromSerpent?: boolean },
  ): Promise<string[]>;
  resolveDeaths(): Promise<string[]>;
  resolveWinner(): string[];
  advanceIfCurrentPlayerDead(logs: string[]): Promise<void>;
};

export type PackSkillHook = (ctx: SkillModuleCtx, payload: SkillEventPayload, logs: string[]) => void | Promise<void>;

/**
 * 一个技能的完整声明（`.skill.json` 与 `.skill.ts` 归一到此结构）。
 *
 * 代码技能专有：`canUse` / `getTargets` / `play` / `handLimit` / `onTrigger`；
 * 声明式技能（`.skill.json`）只能用其余的字段，见 `schema/skill.schema.json`。
 */
export type SkillModule = {
  id: string;
  displayName: string;
  kind: SkillKind;
  /** 必填：AI 与 UI 的唯一来源（会进 AI 上下文与 rules.md §14）。 */
  description: string;
  triggers?: SkillTrigger[];
  /** 需要询问"是否发动"。 */
  optional?: boolean;
  /** 预留的钩子顺序（当前引擎不排序，写了也不生效）。 */
  priority?: number;
  requiresTarget?: boolean;
  targetIntent?: SkillTargetIntent;
  /** 出牌动作标签。 */
  label?: string;
  rules?: SkillRules;
  /** 当牌转换（声明式即可生效；出牌阶段与响应时机都覆盖）。 */
  conversions?: SkillConversion[];
  /** 手牌上限的运行时修正（**纯函数**，只读传入的 player）。 */
  handLimit?(player: Player): number;
  canUse?(ctx: SkillModuleCtx, player: Player): boolean;
  getTargets?(ctx: SkillModuleCtx, player: Player): string[];
  play?(ctx: SkillModuleCtx, player: Player, targetId?: string): Promise<string[]>;
  onTrigger?: Partial<Record<SkillTrigger, PackSkillHook>>;
};
