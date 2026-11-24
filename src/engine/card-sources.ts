/**
 * 牌来源（CardSource）与弃牌交互：手牌/木牛流马/装备的来源枚举、peek/移除，
 * 以及响应来源（闪/杀/无懈/桃）与“弃置任意张”管线。
 *
 * 从 `game.ts` 拆出，遵循仓库既有的 context-interface 约定：首参是 `CardSourcesContext`，
 * `game.ts` 以 `this as unknown as CardSourcesContext` 传入；拆出模块之间不互相 import。
 */

import { Card, CardType } from "./cards.js";
import { describeCard, matchesConversionFilter, responseKindToCardType } from "./card-utils.js";
import {
  createCard as createCardImpl,
  discardWoodenOxStoredCards as discardWoodenOxStoredCardsImpl,
  onLoseEquip as onLoseEquipImpl,
  ResolveContext,
} from "./resolve.js";
import { resolveSkillDescriptor } from "./skill-registry.js";
import type { SkillConversion } from "./skill-registry.js";
import {
  CardSource,
  EquipCardType,
  InteractionDecision,
  InteractionRequest,
  Player,
  ResponseKind,
  SkillId,
  SkillName,
} from "./types.js";

export type CardSourcesContext = {
  appendConversionSources(player: Player, kind: ResponseKind, sources: CardSource[]): void;
  buildAnyDiscardSources(player: Player): Array<CardSource & { card: Card }>;
  buildDodgeSources(player: Player): CardSource[];
  buildNegateSources(player: Player): CardSource[];
  buildPeachSources(player: Player, selfRescue?: boolean): CardSource[];
  buildSlashSources(player: Player): CardSource[];
  buildUsableSources(player: Player): Array<CardSource & { card: Card }>;
  readonly currentPlayer: Player;
  decide(request: InteractionRequest): Promise<InteractionDecision>;
  discardCards(cards: Card[], actor: Player, reason: "弃置" | "判定", logs: string[]): Promise<void>;
  discardPile: Card[];
  hasSkill(player: Player, skill: SkillName): boolean;
  isSlashCard(cardType: CardType): boolean;
  nextInteractionId(): number;
  removeHandCardAt(player: Player, index: number, logs?: string[]): Promise<Card | undefined>;
  removeUsableCardBySourceId(player: Player, sourceId: string): Promise<Card | undefined>;
  responseConversions(player: Player, kind: ResponseKind): { skillId: SkillId; conversion: SkillConversion }[];
  takeEquipSlot(player: Player, slot: string): EquipCardType | null;
  turn: number;
};

  /**
   * "弃置任意张牌"（制衡等）的可选范围：手牌 + 木牛流马内存牌 + 装备区。
   * 装备区用 `equip:<槽位>` 作为 sourceId，客户端只回传 sourceId，因此不需要协议变更。
   */
export function buildAnyDiscardSources(ctx: CardSourcesContext, player: Player): Array<CardSource & { card: Card }> {
  const sources = [...ctx.buildUsableSources(player)];
  const equipSource = (slot: string, label: string, type: CardType | null): void => {
    if (type === null) {
      return;
    }
    sources.push({
      sourceId: `equip:${slot}`,
      origin: "equip",
      card: createCardImpl(ctx as unknown as ResolveContext, type, `equip-${slot}-${ctx.turn}`),
      label: `${label} ${type}`,
    });
  };
  equipSource("weapon", "武器", player.weapon);
  equipSource("armor", "防具", player.armor);
  equipSource("defenseHorse", "+1马", player.defenseHorse);
  equipSource("attackHorse", "-1马", player.attackHorse);
  equipSource("treasure", "宝物", player.treasure);
  return sources;
}

export function takeEquipSlot(ctx: CardSourcesContext, player: Player, slot: string): EquipCardType | null {
  if (slot === "weapon" && player.weapon !== null) {
    const type = player.weapon;
    player.weapon = null;
    return type;
  }
  if (slot === "armor" && player.armor !== null) {
    const type = player.armor;
    player.armor = null;
    return type;
  }
  if (slot === "defenseHorse" && player.defenseHorse !== null) {
    const type = player.defenseHorse;
    player.defenseHorse = null;
    return type;
  }
  if (slot === "attackHorse" && player.attackHorse !== null) {
    const type = player.attackHorse;
    player.attackHorse = null;
    return type;
  }
  if (slot === "treasure" && player.treasure !== null) {
    const type = player.treasure;
    player.treasure = null;
    return type;
  }
  return null;
}

  /**
   * 逐张询问"要弃哪张"，直到玩家放弃或已无牌可弃；返回实际弃置张数。
   * 复用现有 choose-discard 请求（allowPass=true），CLI / WebUI / Go 客户端均已支持放弃选项。
   */
export async function requestFlexibleDiscard(
  ctx: CardSourcesContext,
  player: Player,
  reason: string,
  logs: string[],
): Promise<number> {
  const maxCount = ctx.buildAnyDiscardSources(player).length;
  let discarded = 0;
  while (discarded < maxCount) {
    const sources = ctx.buildAnyDiscardSources(player);
    if (sources.length === 0) {
      break;
    }
    const decision = await ctx.decide({
      kind: "choose-discard",
      requestId: ctx.nextInteractionId(),
      playerId: player.id,
      reason: `${reason}（已选 ${discarded} 张，可放弃）`,
      sources,
      count: 1,
      allowPass: true,
    });
    if (decision.choice !== "card") {
      break;
    }
    const sourceId = decision.sourceId;
    if (sourceId.startsWith("equip:")) {
      const removed = ctx.takeEquipSlot(player, sourceId.slice("equip:".length));
      if (removed === null) {
        break;
      }
      ctx.discardPile.push(createCardImpl(ctx as unknown as ResolveContext, removed, `discard-${ctx.turn}`));
      if (removed === CardType.WoodenOx) {
        await discardWoodenOxStoredCardsImpl(ctx as unknown as ResolveContext, player, logs);
      }
      logs.push(`${player.name} 弃置装备 ${removed}`);
      // 弃置装备同样属于"失去装备"，枭姬/白银狮子等技能应正常触发。
      logs.push(...(await onLoseEquipImpl(ctx as unknown as ResolveContext, player, removed)));
      discarded += 1;
      continue;
    }
    const card = await ctx.removeUsableCardBySourceId(player, sourceId);
    if (!card) {
      break;
    }
    logs.push(`${player.name} 弃置 ${card.type}`);
    await ctx.discardCards([card], player, "弃置", logs);
    discarded += 1;
  }
  return discarded;
}

export function buildUsableSources(ctx: CardSourcesContext, player: Player): Array<CardSource & { card: Card }> {
  const sources: Array<CardSource & { card: Card }> = [];
  for (const card of player.hand) {
    sources.push({ sourceId: `hand:${card.id}`, origin: "hand", card, label: describeCard(card) });
  }
  for (const card of player.treasureCards) {
    sources.push({ sourceId: `treasure:${card.id}`, origin: "treasure", card, label: `${describeCard(card)}（木牛流马）` });
  }
  return sources;
}

export function peekUsableCard(ctx: CardSourcesContext, player: Player, sourceId: string): (CardSource & { card: Card })| undefined {
  const separator = sourceId.indexOf(":");
  if (separator < 0) {
    return undefined;
  }
  const origin = sourceId.slice(0, separator);
  const cardId = sourceId.slice(separator + 1);
  const pool = origin === "treasure" ? player.treasureCards : origin === "hand" ? player.hand : null;
  if (!pool) {
    return undefined;
  }
  const card = pool.find((item) => item.id === cardId);
  if (!card) {
    return undefined;
  }
  return { sourceId, origin: origin as CardSource["origin"], card, label: card.type };
}

export async function removeUsableCardBySourceId(
  ctx: CardSourcesContext,
  player: Player,
  sourceId: string,
): Promise<Card | undefined> {
  const separator = sourceId.indexOf(":");
  if (separator < 0) {
    return undefined;
  }
  const origin = sourceId.slice(0, separator);
  const cardId = sourceId.slice(separator + 1);
  if (origin === "treasure") {
    const index = player.treasureCards.findIndex((item) => item.id === cardId);
    if (index < 0) {
      return undefined;
    }
    return player.treasureCards.splice(index, 1)[0];
  }
  if (origin === "hand") {
    const index = player.hand.findIndex((item) => item.id === cardId);
    if (index < 0) {
      return undefined;
    }
    return ctx.removeHandCardAt(player, index);
  }
  return undefined;
}

export function buildDodgeSources(ctx: CardSourcesContext, player: Player): CardSource[] {
  const all = ctx.buildUsableSources(player);
  const sources: CardSource[] = [];
  for (const source of all) {
    if (source.card.type === CardType.Dodge) {
      sources.push({ ...source, label: `打出${describeCard(source.card)}${source.origin === "treasure" ? "（木牛流马）" : ""}` });
    }
  }
  if (ctx.hasSkill(player, SkillName.QingGuo)) {
    for (const source of all) {
      if (source.card.color === "black" && source.card.type !== CardType.Dodge) {
        sources.push({ ...source, label: `${describeCard(source.card)}${SkillName.QingGuo}当${CardType.Dodge}` });
      }
    }
  }
  if (ctx.hasSkill(player, SkillName.LongDan)) {
    for (const source of all) {
      if (ctx.isSlashCard(source.card.type)) {
        sources.push({ ...source, label: `${describeCard(source.card)}${SkillName.LongDan}当${CardType.Dodge}` });
      }
    }
  }
  ctx.appendConversionSources(player, "dodge", sources);
  return sources;
}

export function buildSlashSources(ctx: CardSourcesContext, player: Player): CardSource[] {
  const all = ctx.buildUsableSources(player);
  const sources: CardSource[] = [];
  for (const source of all) {
    if (ctx.isSlashCard(source.card.type)) {
      sources.push({ ...source, label: `打出${describeCard(source.card)}${source.origin === "treasure" ? "（木牛流马）" : ""}` });
    }
  }
  if (ctx.hasSkill(player, SkillName.WuSheng)) {
    for (const source of all) {
      if (source.card.color === "red" && !ctx.isSlashCard(source.card.type)) {
        sources.push({ ...source, label: `${describeCard(source.card)}${SkillName.WuSheng}当${CardType.Slash}` });
      }
    }
  }
  if (ctx.hasSkill(player, SkillName.LongDan)) {
    for (const source of all) {
      if (source.card.type === CardType.Dodge) {
        sources.push({ ...source, label: `${describeCard(source.card)}${SkillName.LongDan}当${CardType.Slash}` });
      }
    }
  }
  ctx.appendConversionSources(player, "slash", sources);
  return sources;
}

  /**
   * 外部武将包 `conversion.asResponse`（Phase 7）的响应来源：把满足 `from` 的牌标成"可当 `kind` 打出"。
   * `viaSkill`/`asType` 是给 `consumeResponseCard` 的凭据——只有带标记的来源才允许"非直接牌类"响应。
   */
export function appendConversionSources(
  ctx: CardSourcesContext,
  player: Player,
  kind: ResponseKind,
  sources: CardSource[],
): void {
  const conversions = ctx.responseConversions(player, kind);
  if (conversions.length === 0) {
    return;
  }
  const direct = responseKindToCardType(kind);
  const all = ctx.buildUsableSources(player);
  for (const { skillId, conversion } of conversions) {
    const displayName = resolveSkillDescriptor(skillId).displayName ?? skillId;
    for (const source of all) {
      if (source.card.type === direct) {
        continue;
      }
      if (!matchesConversionFilter(source.card, conversion.from)) {
        continue;
      }
      sources.push({
        ...source,
        label: `${describeCard(source.card)}${displayName}当${conversion.to}`,
        viaSkill: skillId,
        asType: conversion.to,
      });
    }
  }
}

export function buildNegateSources(ctx: CardSourcesContext, player: Player): CardSource[] {
  const sources = ctx.buildUsableSources(player)
    .filter((source) => source.card.type === CardType.Negate)
    .map((source) => ({ ...source, label: `打出${describeCard(source.card)}${source.origin === "treasure" ? "（木牛流马）" : ""}` }));
  ctx.appendConversionSources(player, "negate", sources);
  return sources;
}

export function buildPeachSources(ctx: CardSourcesContext, player: Player, selfRescue = false): CardSource[] {
  const all = ctx.buildUsableSources(player);
  const sources: CardSource[] = [];
  for (const source of all) {
    if (source.card.type === CardType.Peach) {
      sources.push({ ...source, label: `使用${describeCard(source.card)}${source.origin === "treasure" ? "（木牛流马）" : ""}` });
    }
  }
  if (selfRescue) {
    // 酒方法Ⅱ：濒死时可将酒当桃对自己使用（仅自救）
    for (const source of all) {
      if (source.card.type === CardType.Wine) {
        sources.push({ ...source, label: `使用${describeCard(source.card)}自救（当${CardType.Peach}）` });
      }
    }
  }
  if (ctx.hasSkill(player, SkillName.JiJiu) && player.id !== ctx.currentPlayer.id) {
    for (const source of all) {
      if (source.card.color === "red" && source.card.type !== CardType.Peach) {
        sources.push({ ...source, label: `${describeCard(source.card)}${SkillName.JiJiu}当${CardType.Peach}` });
      }
    }
  }
  ctx.appendConversionSources(player, "peach", sources);
  return sources;
}

export function buildResponseSources(
  ctx: CardSourcesContext,
  player: Player,
  kind: ResponseKind,
  selfRescue = false,
): CardSource[] {
  if (kind === "dodge") return ctx.buildDodgeSources(player);
  if (kind === "slash") return ctx.buildSlashSources(player);
  if (kind === "negate") return ctx.buildNegateSources(player);
  return ctx.buildPeachSources(player, selfRescue);
}

export async function requestDiscardSelection(
  ctx: CardSourcesContext,
  player: Player,
  count: number,
  reason: string,
  providedSources?: CardSource[],
): Promise<Card[]> {
  const picked: Card[] = [];
  for (let i = 0; i < count; i += 1) {
    const sources = providedSources ?? ctx.buildUsableSources(player);
    if (sources.length === 0) {
      break;
    }
    const decision = await ctx.decide({
      kind: "choose-discard",
      requestId: ctx.nextInteractionId(),
      playerId: player.id,
      reason: count > 1 ? `${reason}（第 ${i + 1}/${count} 张）` : reason,
      sources,
      count: 1,
      allowPass: false,
    });
    if (decision.choice !== "card") {
      break;
    }
    const card = await ctx.removeUsableCardBySourceId(player, decision.sourceId);
    if (!card) {
      break;
    }
    picked.push(card);
  }
  return picked;
}
