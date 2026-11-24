/**
 * 出牌阶段枚举：`getPlayableActions`（手牌/装备/木牛/内置技能/外部包主动技）
 * 与外部武将包 `conversion`（当牌转换）的可用性判定、目标复算与结算。
 *
 * 从 `game.ts` 拆出，遵循仓库既有的 context-interface 约定：首参是 `PlayEnumerateContext`，
 * `game.ts` 以 `this as unknown as PlayEnumerateContext` 传入；拆出模块之间不互相 import。
 */

import { Card, CardType } from "./cards.js";
import {
  describeCard,
  hasRemovableCard as cardUtilsHasRemovableCard,
  isDistanceOneTrickCard,
  matchesConversionFilter,
  responseKindToCardType,
  slashKindOf,
} from "./card-utils.js";
import { getPackSkill, getPackSkills } from "./skill-module.js";
import type { SkillModuleCtx } from "./skill-module.js";
import { resolveSkillDescriptor } from "./skill-registry.js";
import type { SkillConversion } from "./skill-registry.js";
import type { SlashKind } from "./card-utils.js";
import { getSkillRules, isImmuneTo } from "./skill-rules.js";
import { GameAction, Player, ResponseKind, SkillId, SkillName, TurnPhase } from "./types.js";

export type PlayEnumerateContext = {
  advanceIfCurrentPlayerDead(logs: string[]): Promise<void>;
  appendConversionActions(player: Player, actions: GameAction[], canPlaySlash: boolean): void;
  canPlaySlashInTurn(player: Player): boolean;
  canReachForDistanceOneTrick(user: Player, target: Player): boolean;
  canReachForSlash(attacker: Player, target: Player): boolean;
  canTakeStoredCard(card: Card): boolean;
  canUseAssault(player: Player): boolean;
  canUseConversionNow(player: Player, skillId: SkillId, conversion: SkillConversion): boolean;
  canUseFanJian(player: Player): boolean;
  canUseJieYin(player: Player): boolean;
  canUseKuRou(player: Player): boolean;
  canUseLiJian(player: Player): boolean;
  canUseQingNang(player: Player): boolean;
  canUseRenDe(player: Player): boolean;
  canUseZhiBa(player: Player): boolean;
  canUseZhiHeng(player: Player): boolean;
  cardNeedsTarget(cardType: CardType): boolean;
  readonly currentPlayer: Player;
  discardPile: Card[];
  findTargetsByCard(playerId: string, cardType: CardType): string[];
  getLordWithZhiBa(): Player | null;
  hasSkill(player: Player, skill: SkillName): boolean;
  isKongChengProtected(target: Player, cardType: CardType): boolean;
  isSlashCard(cardType: CardType): boolean;
  mustGetPlayer(id: string): Player;
  notifyConversionUsed(player: Player, skillId: SkillId, conversion: SkillConversion, logs: string[]): Promise<void>;
  phase: TurnPhase;
  playerConversions(player: Player): { skillId: SkillId; conversion: SkillConversion }[];
  players: Player[];
  removeHandCardAt(player: Player, index: number, logs?: string[]): Promise<Card | undefined>;
  resolveDeaths(): Promise<string[]>;
  resolveUsedCard(
    player: Player,
    usedCard: Card,
    targetId: string | undefined,
    fromTreasure: boolean,
    selectedCardId?: string,
  ): Promise<string[]>;
  resolveWinner(): string[];
  slashUsedThisTurn: boolean;
  useSlash(
    attacker: Player,
    target: Player,
    options?: { kind?: SlashKind; card?: Card; fromSerpent?: boolean },
  ): Promise<string[]>;
  validateConversionTarget(player: Player, convertTo: CardType, targetId: string | undefined): string | null;
  wineUsedPlayerIds: Set<string>;
  winner: "human" | "ai" | "draw" | null;
};

export function getPlayableActions(ctx: PlayEnumerateContext, playerId: string): GameAction[] {
  if (ctx.winner !== null) {
    return [];
  }
  const player = ctx.mustGetPlayer(playerId);
  if (!player.alive || player.id !== ctx.currentPlayer.id || ctx.phase !== TurnPhase.Play) {
    return [];
  }
  const actions: GameAction[] = [];
  const canPlaySlash = ctx.canPlaySlashInTurn(player);

  player.hand.forEach((card, cardIndex) => {
    if (card.type === CardType.Dodge || card.type === CardType.Negate) {
      return;
    }
    if (ctx.isSlashCard(card.type) && !canPlaySlash) {
      return;
    }
    if (card.type === CardType.Peach && player.hp >= player.maxHp) {
      return;
    }
    if (card.type === CardType.Lightning && player.delayedTricks.some((t) => t.cardType === CardType.Lightning)) {
      return;
    }
    // 酒方法Ⅰ：每回合限用一次
    if (card.type === CardType.Wine && ctx.wineUsedPlayerIds.has(player.id)) {
      return;
    }
    const targets = ctx.findTargetsByCard(player.id, card.type);
    if (ctx.cardNeedsTarget(card.type) && targets.length === 0) {
      return;
    }
    actions.push({
      type: "play",
      cardIndex,
      label: `使用 ${card.type}`,
      requiresTarget: ctx.cardNeedsTarget(card.type),
      targets,
      // 顺手牵羊/过河拆桥结算时需要从目标处选一张牌，其他牌不需要
      needsTargetCard: card.type === CardType.Snatch || card.type === CardType.Dismantle,
    });
    // 铁索连环可重铸：弃置并摸一张
    if (card.type === CardType.IronChain) {
      actions.push({
        type: "play",
        cardIndex: -500 - cardIndex,
        label: `重铸 ${card.type}（弃置并摸1张牌）`,
        requiresTarget: false,
        targets: [],
        needsTargetCard: false,
      });
    }
  });
  if (canPlaySlash && ctx.hasSkill(player, SkillName.LongDan)) {
    player.hand.forEach((card, cardIndex) => {
      if (card.type !== CardType.Dodge) {
        return;
      }
      const targets = ctx.findTargetsByCard(player.id, CardType.Slash);
      if (targets.length === 0) {
        return;
      }
      actions.push({
        type: "play",
        cardIndex: -200 - cardIndex,
        label: `使用 龙胆（将${CardType.Dodge}当${CardType.Slash}）`,
        requiresTarget: true,
        targets,
      });
    });
  }
  if (canPlaySlash && ctx.hasSkill(player, SkillName.WuSheng)) {
    player.hand.forEach((card, cardIndex) => {
      if (ctx.isSlashCard(card.type) || card.color !== "red") {
        return;
      }
      const targets = ctx.findTargetsByCard(player.id, CardType.Slash);
      if (targets.length === 0) {
        return;
      }
      actions.push({
        type: "play",
        cardIndex: -400 - cardIndex,
        label: `使用 武圣（将红牌${card.type}当${CardType.Slash}）`,
        requiresTarget: true,
        targets,
      });
    });
  }
  if (ctx.hasSkill(player, SkillName.GuoSe)) {
    player.hand.forEach((card, cardIndex) => {
      if (card.suit !== "diamond") {
        return;
      }
      const targets = ctx.findTargetsByCard(player.id, CardType.Indulgence);
      if (targets.length === 0) {
        return;
      }
      actions.push({
        type: "play",
        cardIndex: -100 - cardIndex,
        label: `使用 国色（将方块牌${card.type}当${CardType.Indulgence}）`,
        requiresTarget: true,
        targets,
      });
    });
  }
  if (
    player.weapon === CardType.SerpentSpear &&
    player.hand.length >= 2 &&
    (!ctx.slashUsedThisTurn || getSkillRules(player).slashLimitExempt)
  ) {
    const targets = ctx.findTargetsByCard(player.id, CardType.Slash);
    if (targets.length > 0) {
      actions.push({
        type: "play",
        cardIndex: -1,
        label: "使用 丈八蛇矛（弃2张手牌当杀）",
        requiresTarget: true,
        targets,
      });
    }
  }
  if (player.treasure === CardType.WoodenOx) {
    if (player.hand.length > 0) {
      actions.push({
        type: "play",
        cardIndex: -11,
        label: `使用 ${CardType.WoodenOx}（置入1张手牌）`,
        requiresTarget: false,
        targets: [],
      });
    }
    const moveTargets = ctx.players
      .filter((item) => item.alive && item.id !== player.id)
      .map((item) => item.id);
    if (moveTargets.length > 0) {
      actions.push({
        type: "play",
        cardIndex: -12,
        label: `使用 ${CardType.WoodenOx}（移动给其他角色）`,
        requiresTarget: true,
        targets: moveTargets,
      });
    }
    player.treasureCards.forEach((card, index) => {
      // 木牛流马下的杀同样受每回合出杀次数限制
      if (ctx.isSlashCard(card.type) && !ctx.canPlaySlashInTurn(player)) {
        return;
      }
      const targets = ctx.findTargetsByCard(player.id, card.type);
      if (ctx.cardNeedsTarget(card.type) && targets.length === 0) {
        return;
      }
      actions.push({
        type: "play",
        cardIndex: -1000 - index,
        label: `使用 木牛流马下的 ${card.type}`,
        requiresTarget: ctx.cardNeedsTarget(card.type),
        targets,
        needsTargetCard: card.type === CardType.Snatch || card.type === CardType.Dismantle,
      });
    });
    // 取出：本回合刚置入的牌不能本回合就取出（防置入/取出无收益空转），跨回合取出不受影响
    if (player.treasureCards.some((card) => ctx.canTakeStoredCard(card))) {
      actions.push({
        type: "play",
        cardIndex: -13,
        label: `使用 ${CardType.WoodenOx}（取出1张牌）`,
        requiresTarget: false,
        targets: [],
      });
    }
  }

  if (ctx.canUseAssault(player)) {
    const targets = ctx.findTargetsByCard(player.id, CardType.Slash);
    if (targets.length > 0) {
      actions.push({
        type: "skill",
        skill: SkillName.Assault,
        label: `发动${SkillName.Assault}（弃1牌对1名角色造成1伤害）`,
        requiresTarget: true,
        targets,
      });
    }
  }
  if (ctx.canUseZhiHeng(player)) {
    actions.push({
      type: "skill",
      skill: SkillName.ZhiHeng,
      label: `发动${SkillName.ZhiHeng}（弃任意张并摸等量，限一次）`,
      requiresTarget: false,
      targets: [],
    });
  }
  if (ctx.canUseQingNang(player)) {
    const targets = ctx.players.filter((item) => item.alive && item.hp < item.maxHp).map((item) => item.id);
    if (targets.length > 0) {
      actions.push({
        type: "skill",
        skill: SkillName.QingNang,
        label: `发动${SkillName.QingNang}（弃1手牌令1名角色回复1点）`,
        requiresTarget: true,
        targets,
      });
    }
  }
  if (ctx.canUseKuRou(player)) {
    actions.push({
      type: "skill",
      skill: SkillName.KuRou,
      label: `发动${SkillName.KuRou}（失去1点体力并摸2张牌）`,
      requiresTarget: false,
      targets: [],
    });
  }
  if (ctx.canUseRenDe(player)) {
    const renDeTargets = ctx.players
      .filter((item) => item.alive && item.id !== player.id)
      .map((item) => item.id);
    if (renDeTargets.length > 0) {
      actions.push({
        type: "skill",
        skill: SkillName.RenDe,
        label: `发动${SkillName.RenDe}（将手牌交给1名角色，本回合累计给出2张回复1点）`,
        requiresTarget: true,
        targets: renDeTargets,
      });
    }
  }
  if (ctx.canUseFanJian(player)) {
    const targets = ctx.players.filter((item) => item.alive && item.id !== player.id).map((item) => item.id);
    if (targets.length > 0) {
      actions.push({
        type: "skill",
        skill: SkillName.FanJian,
        label: `发动${SkillName.FanJian}（令目标声明花色并获得一张手牌）`,
        requiresTarget: true,
        targets,
      });
    }
  }

  if (ctx.canUseZhiBa(player)) {
    const lord = ctx.getLordWithZhiBa();
    if (lord && lord.id !== player.id && lord.hand.length > 0 && player.hand.length > 0) {
      actions.push({
        type: "skill",
        skill: SkillName.ZhiBa,
        label: `发动${SkillName.ZhiBa}（与主公拼点，未赢则主公得两张拼点牌）`,
        requiresTarget: false,
        targets: [lord.id],
      });
    }
  }
  if (ctx.canUseLiJian(player)) {
    const maleTargets = ctx.players
      .filter((p) => p.alive && p.gender === "男")
      .map((p) => p.id);
    if (maleTargets.length >= 2) {
      actions.push({
        type: "skill",
        skill: SkillName.LiJian,
        label: `发动${SkillName.LiJian}（弃1牌令两名男性角色决斗）`,
        requiresTarget: true,
        targets: maleTargets,
      });
    }
  }
  if (ctx.canUseJieYin(player)) {
    const maleWounded = ctx.players
      .filter((p) => p.alive && p.gender === "男" && p.id !== player.id && p.hp < p.maxHp)
      .map((p) => p.id);
    if (player.hand.length >= 2 && maleWounded.length > 0) {
      actions.push({
        type: "skill",
        skill: SkillName.JieYin,
        label: `发动${SkillName.JieYin}（弃2牌令自己与一名男性角色各回复1点体力）`,
        requiresTarget: true,
        targets: maleWounded,
      });
    }
  }
  // 外部武将包主动技能（阶段 2）：按玩家已拥有的命名空间技能 id 枚举。
  const packCtx = ctx as unknown as SkillModuleCtx;
  for (const entry of getPackSkills()) {
    if (entry.kind !== "active" || !player.skills.includes(entry.id)) {
      continue;
    }
    if (entry.canUse && !entry.canUse(packCtx, player)) {
      continue;
    }
    const requiresTarget = entry.requiresTarget ?? false;
    const targets = requiresTarget ? (entry.getTargets?.(packCtx, player) ?? []) : [];
    if (requiresTarget && targets.length === 0) {
      continue;
    }
    actions.push({
      type: "skill",
      skill: entry.id,
      label: entry.label ?? `发动${entry.displayName}`,
      requiresTarget,
      targets,
    });
  }
  ctx.appendConversionActions(player, actions, canPlaySlash);
  actions.push({ type: "end", label: "结束出牌阶段" });
  return actions;
}

  /**
   * 外部武将包 `conversion`（当牌转换，Phase 7）的可玩动作枚举。
   *
   * 约定 `cardIndex = -10000 - 手牌下标`（避开内置已占用的 -100/-200/-400/-500/-1000 与 -1/-11/-12/-13），
   * 木牛流马内牌另用 `-20000 - 木牛下标`（与响应侧 `appendConversionSources` 同口径：手牌 + 木牛内牌都可当），
   * 并用 `convertVia`/`convertTo` 标明"通过哪个技能、当成哪张牌"，`playAction` 据此复算，不信任客户端。
   * 枚举引擎结算得了的牌类：杀/火杀/雷杀（需要目标）、桃（自己体力未满）、酒与普通锦囊
   * （Phase 8；需要目标的按牌类枚举，无目标的不设目标）。
   * 闪/无懈可击是响应牌，不进可玩动作列表（走 `provide_response`）。
   */
  /**
   * Phase 8：一条当牌转换当前是否可用。酒每回合限一次（与可玩动作列表同口径）；
   * 代码技能的 `canUseConversion` 门控（"每回合限次/消耗标记"类限制）在枚举与结算时各复算一次。
   * 必须纯（只读），枚举与结算都调它。
   */
export function canUseConversionNow(
  ctx: PlayEnumerateContext,
  player: Player,
  skillId: SkillId,
  conversion: SkillConversion,
): boolean {
  if (conversion.to === CardType.Wine && ctx.wineUsedPlayerIds.has(player.id)) {
    return false;
  }
  const module = getPackSkill(skillId);
  if (module?.canUseConversion && !module.canUseConversion(ctx as unknown as SkillModuleCtx, player, conversion)) {
    return false;
  }
  return true;
}

  /** Phase 8：转换成功结算后通知技能扣费（只在成功时调用一次）。 */
export async function notifyConversionUsed(
  ctx: PlayEnumerateContext,
  player: Player,
  skillId: SkillId,
  conversion: SkillConversion,
  logs: string[],
): Promise<void> {
  const module = getPackSkill(skillId);
  await module?.onConversionUsed?.(ctx as unknown as SkillModuleCtx, player, conversion, logs);
}

export function appendConversionActions(
  ctx: PlayEnumerateContext,
  player: Player,
  actions: GameAction[],
  canPlaySlash: boolean,
): void {
  for (const { skillId, conversion } of ctx.playerConversions(player)) {
    // Phase 8：门控（限次/标记）不过的转换不枚举。
    if (!ctx.canUseConversionNow(player, skillId, conversion)) {
      continue;
    }
    const isSlashLike = ctx.isSlashCard(conversion.to);
    if (isSlashLike && !canPlaySlash) {
      continue;
    }
    if (conversion.to === CardType.Peach && player.hp >= player.maxHp) {
      continue;
    }
    // Phase 8：闪/无懈可击只能响应（走 provide_response），不能主动使用。
    if (conversion.to === CardType.Dodge || conversion.to === CardType.Negate) {
      continue;
    }
    const displayName = resolveSkillDescriptor(skillId).displayName ?? skillId;
    // Phase 8：酒与普通锦囊也可当——需要目标的按牌类枚举目标（决斗/拆/顺/借刀/火攻/铁索），
    // 不需要目标的（无中生有/五谷丰登/桃园结义/万箭齐发/南蛮入侵/酒）不设目标。
    const needsTarget = isSlashLike || ctx.cardNeedsTarget(conversion.to);
    const targets = needsTarget ? ctx.findTargetsByCard(player.id, conversion.to) : [];
    if (needsTarget && targets.length === 0) {
      continue;
    }
    player.hand.forEach((card, cardIndex) => {
      if (!matchesConversionFilter(card, conversion.from)) {
        return;
      }
      actions.push({
        type: "play",
        cardIndex: -10000 - cardIndex,
        label: `发动${displayName}：将${describeCard(card)}当${conversion.to}${conversion.to === CardType.Peach ? "对自己使用" : "使用"}`,
        requiresTarget: needsTarget,
        targets,
        convertVia: skillId,
        convertTo: conversion.to,
      });
    });
    // 木牛流马内牌也可当牌转换（与响应侧同口径；`treasureCards` 只在装备木牛时非空）。
    player.treasureCards.forEach((card, oxIndex) => {
      if (!matchesConversionFilter(card, conversion.from)) {
        return;
      }
      actions.push({
        type: "play",
        cardIndex: -20000 - oxIndex,
        label: `发动${displayName}：将${describeCard(card)}（木牛流马）当${conversion.to}${conversion.to === CardType.Peach ? "对自己使用" : "使用"}`,
        requiresTarget: needsTarget,
        targets,
        convertVia: skillId,
        convertTo: conversion.to,
      });
    });
  }
}

  /** 该玩家拥有的全部当牌转换（外部包声明式 `conversions`；内置技能不走这里）。 */
export function playerConversions(ctx: PlayEnumerateContext, player: Player): { skillId: SkillId; conversion: SkillConversion }[] {
  const result: { skillId: SkillId; conversion: SkillConversion }[] = [];
  for (const skillId of new Set(player.skills)) {
    for (const conversion of resolveSkillDescriptor(skillId).conversions ?? []) {
      result.push({ skillId, conversion });
    }
  }
  return result;
}

  /** 该玩家能否用某种转换作为 `kind` 响应打出（`asResponse` 命中且源牌匹配）。 */
export function responseConversions(ctx: PlayEnumerateContext, player: Player, kind: ResponseKind): { skillId: SkillId; conversion: SkillConversion }[] {
  return ctx.playerConversions(player).filter(
    (entry) =>
      (entry.conversion.asResponse ?? []).includes(kind) &&
      responseKindToCardType(kind) === entry.conversion.to &&
      // Phase 8：门控（限次/标记）不过的转换既不提供来源、也不被验证接受。
      ctx.canUseConversionNow(player, entry.skillId, entry.conversion),
  );
}

  /**
   * Phase 8：当牌转换（酒/普通锦囊）的目标合法性复算，与 `playAction` 的手牌使用前检查同口径：
   * 需要目标的牌必须给目标、铁索连环以外不能指定自己、决斗受空城保护、
   * 距离 1 锦囊（顺手牵羊）看距离。杀走原有分支，这里不管。
   */
export function validateConversionTarget(
  ctx: PlayEnumerateContext,
  player: Player,
  convertTo: CardType,
  targetId: string | undefined,
): string | null {
  if (!ctx.cardNeedsTarget(convertTo)) {
    return null;
  }
  if (!targetId) {
    return "需要选择目标";
  }
  const target = ctx.mustGetPlayer(targetId);
  if (!target.alive || (target.id === player.id && convertTo !== CardType.IronChain)) {
    return "目标无效";
  }
  if (convertTo === CardType.Duel && ctx.isKongChengProtected(target, convertTo)) {
    return `${target.name} 的${SkillName.KongCheng}生效，无法成为目标`;
  }
  if (isDistanceOneTrickCard(convertTo) && !ctx.canReachForDistanceOneTrick(player, target)) {
    return `目标超出距离，${convertTo}只能对距离 1 以内的角色使用`;
  }
  return null;
}

  /**
   * 当牌转换在**出牌阶段**的结算（`playAction` 的 `cardIndex <= -10000` 分支）。
   * 复算全部条件：技能归属、转换声明、源牌是否满足 `from`、杀次数、目标合法性。
   * 源牌分两处：`origin: "hand"` 取手牌下标（`removeHandCardAt`，触发失去手牌钩子），
   * `origin: "treasure"` 取木牛下标（直接 splice，木牛内牌不是手牌，不触发失去手牌钩子）。
   */
export async function resolveConversionUse(
  ctx: PlayEnumerateContext,
  player: Player,
  source: { origin: "hand" | "treasure"; index: number },
  viaSkillId: SkillId | undefined,
  convertTo: CardType | undefined,
  targetId: string | undefined,
): Promise<string[]> {
  // 木牛内牌：必须确实装备着木牛流马（防客户端伪造 -20000 段下标）。
  if (source.origin === "treasure" && player.treasure !== CardType.WoodenOx) {
    return ["使用卡牌失败"];
  }
  const pool = source.origin === "treasure" ? player.treasureCards : player.hand;
  const card = pool[source.index];
  if (!card || !viaSkillId || !convertTo) {
    return ["使用卡牌失败"];
  }
  // 同一技能可声明多条相同 `to`、不同 `from` 的转换：必须找到"源牌也匹配"的那一条，
  // 不能只按 skillId+to 取第一条（否则合法牌会被误拒）。
  const conversion = ctx.playerConversions(player).find(
    (entry) =>
      entry.skillId === viaSkillId &&
      entry.conversion.to === convertTo &&
      matchesConversionFilter(card, entry.conversion.from),
  )?.conversion;
  if (!conversion) {
    return ["使用卡牌失败"];
  }
  const displayName = resolveSkillDescriptor(viaSkillId).displayName ?? viaSkillId;
  // Phase 8：门控复算（不信任客户端；枚举时已算过一次，这里防过期快照/伪造）。
  if (!ctx.canUseConversionNow(player, viaSkillId, conversion)) {
    return [`${player.name} 当前无法发动${displayName}的当牌转换`];
  }
  // 取走源牌：手牌走 removeHandCardAt（触发失去手牌钩子），木牛内牌直接 splice。
  const takeSourceCard = async (): Promise<Card | undefined> =>
    source.origin === "treasure"
      ? player.treasureCards.splice(source.index, 1)[0]
      : ctx.removeHandCardAt(player, source.index);
  const isSlashLike = ctx.isSlashCard(conversion.to);
  if (!isSlashLike && conversion.to !== CardType.Peach) {
    // Phase 8：酒与普通锦囊——造一张"源牌花色/点数 + 目标牌类"的合成牌，走通用结算
    // `resolveUsedCard`（决斗/拆/顺/无中生有/借刀/火攻/铁索/桃园/五谷/万箭/南蛮/酒都在其中）。
    // 杀/桃仍走原有分支，避免既有转换的行为变化。合成牌沿用源牌 id 进弃牌堆（源牌本身不再另行入堆）。
    const targetError = ctx.validateConversionTarget(player, conversion.to, targetId);
    if (targetError) {
      return [targetError];
    }
    const used = await takeSourceCard();
    if (!used) {
      return ["使用卡牌失败"];
    }
    const synthetic: Card = { id: used.id, type: conversion.to, color: used.color, suit: used.suit, rank: used.rank };
    const logs = [`${player.name} 发动${displayName}，将${describeCard(used)}当${conversion.to}使用`];
    logs.push(...(await ctx.resolveUsedCard(player, synthetic, targetId, false)));
    await ctx.notifyConversionUsed(player, viaSkillId, conversion, logs);
    return logs;
  }
  if (conversion.to === CardType.Peach && player.hp >= player.maxHp) {
    return [`${player.name} 当前体力已满`];
  }
  let target: Player | null = null;
  if (isSlashLike) {
    if (ctx.slashUsedThisTurn && !getSkillRules(player).slashLimitExempt && player.weapon !== CardType.Crossbow) {
      return [`${player.name} 本回合已使用过杀`];
    }
    if (!targetId) {
      return ["需要选择目标"];
    }
    const candidate = ctx.mustGetPlayer(targetId);
    if (
      !candidate.alive ||
      candidate.id === player.id ||
      !ctx.canReachForSlash(player, candidate) ||
      ctx.isKongChengProtected(candidate, conversion.to)
    ) {
      return ["目标无效"];
    }
    target = candidate;
  }
  const used = await takeSourceCard();
  if (!used) {
    return ["使用卡牌失败"];
  }
  ctx.discardPile.push(used);
  const logs = [`${player.name} 发动${displayName}，将${describeCard(used)}当${conversion.to}使用`];
  if (isSlashLike && target) {
    if (!getSkillRules(player).slashLimitExempt) {
      ctx.slashUsedThisTurn = true;
    }
    logs.push(...(await ctx.useSlash(player, target, { kind: slashKindOf(player, conversion.to), card: used })));
    await ctx.notifyConversionUsed(player, viaSkillId, conversion, logs);
    return logs;
  }
  player.hp = Math.min(player.maxHp, player.hp + 1);
  logs.push(`${player.name} 回复 1 点体力`);
  logs.push(...(await ctx.resolveDeaths()));
  logs.push(...ctx.resolveWinner());
  await ctx.advanceIfCurrentPlayerDead(logs);
  await ctx.notifyConversionUsed(player, viaSkillId, conversion, logs);
  return logs;
}

export function findTargetsByCard(ctx: PlayEnumerateContext, playerId: string, cardType: CardType): string[] {
  if (!ctx.cardNeedsTarget(cardType)) {
    return [];
  }
  const targets = ctx.players
    .filter((player) => player.id !== playerId && player.alive)
    .map((player) => player.id);
  if (ctx.isSlashCard(cardType)) {
    const attacker = ctx.mustGetPlayer(playerId);
    return targets.filter((id) => {
      const target = ctx.mustGetPlayer(id);
      return ctx.canReachForSlash(attacker, target) && !ctx.isKongChengProtected(target, cardType);
    });
  }
  if (cardType === CardType.Duel) {
    return targets.filter((id) => !ctx.isKongChengProtected(ctx.mustGetPlayer(id), cardType));
  }
  if (cardType === CardType.Dismantle) {
    return targets.filter((id) => cardUtilsHasRemovableCard(ctx.mustGetPlayer(id)));
  }
  if (cardType === CardType.Snatch) {
    const user = ctx.mustGetPlayer(playerId);
    return targets.filter((id) => {
      const holder = ctx.mustGetPlayer(id);
      if (isImmuneTo(holder, "snatch")) {
        return false;
      }
      // 顺手牵羊只能对距离 1 以内的角色使用（奇才无视该限制）
      if (!ctx.canReachForDistanceOneTrick(user, holder)) {
        return false;
      }
      return cardUtilsHasRemovableCard(holder);
    });
  }
  if (cardType === CardType.Collateral) {
    return targets.filter((id) => {
      const holder = ctx.mustGetPlayer(id);
      // 借刀杀人只能对装备武器的角色使用
      if (holder.weapon === null) {
        return false;
      }
      return true;
    });
  }
  if (cardType === CardType.Indulgence || cardType === CardType.SuppliesCut) {
    const user = ctx.mustGetPlayer(playerId);
    return targets.filter((id) => {
      const holder = ctx.mustGetPlayer(id);
      if (cardType === CardType.Indulgence && isImmuneTo(holder, "indulgence")) {
        return false;
      }
      // 兵粮寸断只能对距离 1 以内的角色使用（奇才无视该限制）；乐不思蜀无距离限制
      if (cardType === CardType.SuppliesCut && !ctx.canReachForDistanceOneTrick(user, holder)) {
        return false;
      }
      return !holder.delayedTricks.some((t) => t.cardType === cardType);
    });
  }
  if (cardType === CardType.FireAttack) {
    // 火攻：对一名其他角色使用，无距离限制
    return targets;
  }
  if (cardType === CardType.IronChain) {
    // 铁索连环：可对包括自己在内的存活角色使用
    return ctx.players.filter((player) => player.alive).map((player) => player.id);
  }
  return targets;
}
