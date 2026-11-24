/**
 * 牌区与伤害：摸牌/弃牌/判定牌/手牌移除、击杀归属与 `applyDamage`。
 *
 * 从 `game.ts` 拆出，遵循仓库既有的 context-interface 约定：首参是 `CardZonesContext`，
 * `game.ts` 以 `this as unknown as CardZonesContext` 传入；拆出模块之间不互相 import。
 */

import { Card, CardType, shuffle } from "./cards.js";
import { attributeDamageKind, DamageKind, describeCard } from "./card-utils.js";
import { isImmuneTo } from "./skill-rules.js";
import {
  CardSource,
  InteractionDecision,
  InteractionRequest,
  Player,
  SkillEventPayload,
  SkillHook,
  SkillName,
  SkillTrigger,
} from "./types.js";

export type CardZonesContext = {
  applyDamage(source: Player | null, target: Player, amount: number, reason: string, logs: string[], damageCard?: Card, damageKind?: DamageKind | null, isChainSpread?: boolean): Promise<void>;
  buildUsableSources(player: Player): Array<CardSource & { card: Card }>;
  checkLianYing(player: Player, logs?: string[]): Promise<void>;
  readonly currentPlayer: Player;
  damageCredit: Map<string, string | null> | undefined;
  damageCreditMap(): Map<string, string | null>;
  decide(request: InteractionRequest): Promise<InteractionDecision>;
  deck: Card[];
  discardCards(cards: Card[], actor: Player, reason: "弃置" | "判定", logs: string[]): Promise<void>;
  discardPile: Card[];
  drawCard(): Card | null;
  drawCards(playerId: string, count: number): number;
  emitSkillTrigger(trigger: SkillTrigger, payload: SkillEventPayload, logs: string[]): Promise<void>;
  hasSkill(player: Player, skill: SkillName): boolean;
  isSlashCard(cardType: CardType): boolean;
  mustGetPlayer(id: string): Player;
  nextInteractionId(): number;
  noteDamageSource(sourceId: string | null, targetId: string): void;
  oxStoredTurnMap(): Map<string, number>;
  players: Player[];
  randomIndex(length: number): number;
  removeCardFromAllZones(cardId: string): number;
  removeHandCardAt(player: Player, index: number, logs?: string[]): Promise<Card | undefined>;
  removeUsableCardBySourceId(player: Player, sourceId: string): Promise<Card | undefined>;
  rng: () => number;
  shouldActivateOptionalEffect(player: Player, effect: SkillName | CardType): Promise<boolean>;
  skillHooks: Record<SkillTrigger, SkillHook[]>;
  turn: number;
  winner: "human" | "ai" | "draw" | null;
  woodenOxStoredTurn: Map<string, number> | undefined;
};

export function drawCards(ctx: CardZonesContext, playerId: string, count: number): number {
  const player = ctx.mustGetPlayer(playerId);
  let drawn = 0;
  for (let i = 0; i < count; i += 1) {
    const card = ctx.drawCard();
    if (!card) {
      break;
    }
    player.hand.push(card);
    drawn += 1;
  }
  return drawn;
}

  /**
   * Phase 10：牌因"弃置/判定"进入弃牌堆的中央入口——逐张置入并发出 `card_discarded`
   * 触发点（`actor` 为牌的原主，`reason` 为"弃置"/"判定"），钩子可在此时把牌从弃牌堆取走
   * （如落英）。调用方负责先把牌从原区域移出（`removeHandCardAt` 等）；本方法只负责入堆+发触发点。
   * "使用/打出"的牌入堆不要走这里（直接 `discardPile.push`），否则落英会误触发；
   * 装备重建牌、拼点牌、洛神红牌同样不走这里。
   */
export async function discardCards(ctx: CardZonesContext, cards: Card[], actor: Player, reason: "弃置" | "判定", logs: string[]): Promise<void> {
  for (const card of cards) {
    ctx.discardPile.push(card);
    await ctx.emitSkillTrigger("card_discarded", { actor, card, reason }, logs);
  }
}

export function drawCard(ctx: CardZonesContext): Card | null {
  if (ctx.deck.length === 0) {
    if (ctx.discardPile.length === 0) {
      return null;
    }
    ctx.deck = shuffle(ctx.discardPile, ctx.rng);
    ctx.discardPile = [];
  }
  const card = ctx.deck.shift();
  return card ?? null;
}

export async function drawJudgmentCard(ctx: CardZonesContext, reason: string, logs: string[], owner?: Player): Promise<Card | null> {
  let card = ctx.drawCard();
  if (!card) {
    logs.push(`${reason}无法判定：牌堆为空`);
    return null;
  }
  const suitNames = { heart: "红桃", diamond: "方片", club: "梅花", spade: "黑桃", none: "无花色" } as const;
  logs.push(`${reason}判定牌：${suitNames[card.suit]}${card.rank} ${card.type}`);
  // Phase 10：判定牌入弃牌堆即发 card_discarded（actor 为判定归属者；落英等技能可此时获得之）。
  // 注意：此时判定尚未结算（改判/天妒在后），落英先于天妒获得是既定顺序。
  await ctx.discardCards([card], owner ?? ctx.currentPlayer, "判定", logs);
  // 拦截点 judgment：外部包可替换判定牌实现"改判"。钩子自己负责把替换牌从原区域移除，
  // 引擎负责把替换牌置入弃牌堆并接管后续（与内置鬼才的处理方式一致）。
  const judgmentPayload: SkillEventPayload = { ...(owner ? { actor: owner } : {}), reason, card, judgmentCard: card };
  await ctx.emitSkillTrigger("judgment", judgmentPayload, logs);
  if (judgmentPayload.judgmentCard && judgmentPayload.judgmentCard.id !== card.id) {
    const replacement = judgmentPayload.judgmentCard;
    // 兜底：替换牌若还留在其他区域（外部钩子漏移除），先清掉再入弃牌堆，保证单区唯一
    const cleaned = ctx.removeCardFromAllZones(replacement.id);
    logs.push(`${reason}判定牌被替换：${describeCard(card)} → ${describeCard(replacement)}`);
    // 替换牌成为新的判定牌（原主未知，按判定归属者计 actor）。
    await ctx.discardCards([replacement], owner ?? ctx.currentPlayer, "判定", logs);
    if (cleaned > 0) {
      logs.push(`${reason}改判替换牌残留在其他区域，已清理 ${cleaned} 处`);
    }
    card = replacement;
  }
  const guiCaiPlayer = ctx.players.find((item) => item.alive && ctx.hasSkill(item, SkillName.GuiCai));
  if (guiCaiPlayer) {
    const sources = ctx.buildUsableSources(guiCaiPlayer);
    if (sources.length > 0) {
      const decision = await ctx.decide({
        kind: "choose-discard",
        requestId: ctx.nextInteractionId(),
        playerId: guiCaiPlayer.id,
        reason: `${reason}：${guiCaiPlayer.name} 是否发动${SkillName.GuiCai}，用手牌替换判定牌？`,
        sources,
        count: 1,
        allowPass: true,
        passLabel: `不发动${SkillName.GuiCai}`,
      });
      if (decision.choice === "card") {
        const replacement = await ctx.removeUsableCardBySourceId(guiCaiPlayer, decision.sourceId);
        if (replacement) {
          logs.push(`${guiCaiPlayer.name} 发动${SkillName.GuiCai}，以 ${describeCard(replacement)} 替换判定牌 ${describeCard(card)}`);
          // 替换牌出自鬼才持有者的手牌，actor 计其原主。
          await ctx.discardCards([replacement], guiCaiPlayer, "判定", logs);
          card = replacement;
        }
      }
    }
  }
  if (owner && ctx.hasSkill(owner, SkillName.TianDu) && await ctx.shouldActivateOptionalEffect(owner, SkillName.TianDu)) {
    const index = ctx.discardPile.findIndex((item) => item.id === card.id);
    if (index >= 0) {
      const [obtained] = ctx.discardPile.splice(index, 1);
      if (obtained) {
        owner.hand.push(obtained);
        logs.push(`${owner.name} 的${SkillName.TianDu}生效，获得判定牌`);
      }
    }
  }
  return card;
}

export async function discardFromPlayerHand(ctx: CardZonesContext, player: Player, count: number, logs: string[]): Promise<number> {
  let discarded = 0;
  const discardLogs: string[] = [];
  for (let i = 0; i < count && player.hand.length > 0; i += 1) {
    const index = ctx.randomIndex(player.hand.length);
    const removed = await ctx.removeHandCardAt(player, index);
    if (removed) {
      await ctx.discardCards([removed], player, "弃置", discardLogs);
      discarded += 1;
    }
  }
  if (discarded > 0) {
    logs.push(`${player.name} 弃置了 ${discarded} 张手牌`);
    logs.push(...discardLogs);
  }
  return discarded;
}

export async function removeHandCardAt(ctx: CardZonesContext, player: Player, index: number, logs?: string[]): Promise<Card | undefined> {
  const removed = player.hand.splice(index, 1)[0];
  if (removed) {
    // 拦截点 hand_card_lost：只通知，不改变移除结果。
    // 注意：调用方未传 logs 时，钩子产生的日志会被丢弃（不进入对局日志）。
    await ctx.emitSkillTrigger("hand_card_lost", { actor: player, card: removed }, logs ?? []);
    await ctx.checkLianYing(player, logs);
  }
  return removed;
}

export async function checkLianYing(ctx: CardZonesContext, player: Player, logs?: string[]): Promise<void> {
  if (ctx.winner !== null || !player.alive || player.hand.length > 0) {
    return;
  }
  if (!ctx.hasSkill(player, SkillName.LianYing)) {
    return;
  }
  if (!await ctx.shouldActivateOptionalEffect(player, SkillName.LianYing)) {
    return;
  }
  const drawn = ctx.drawCards(player.id, 1);
  if (drawn > 0 && logs) {
    logs.push(`${player.name} 的${SkillName.LianYing}生效，失去最后手牌后摸了 ${drawn} 张牌`);
  }
}

export async function takeRandomHandCard(ctx: CardZonesContext, player: Player, receiver: Player): Promise<Card | undefined> {
  if (player.hand.length === 0) {
    return undefined;
  }
  const index = ctx.randomIndex(player.hand.length);
  const removed = await ctx.removeHandCardAt(player, index);
  if (removed) {
    receiver.hand.push(removed);
  }
  return removed;
}

export function drawTopCards(ctx: CardZonesContext, count: number): Card[] {
  const drawn: Card[] = [];
  for (let i = 0; i < count; i += 1) {
    const card = ctx.drawCard();
    if (!card) {
      break;
    }
    drawn.push(card);
  }
  return drawn;
}

export function placeCardsOnTop(ctx: CardZonesContext, cards: Card[]): void {
  for (let i = cards.length - 1; i >= 0; i -= 1) {
    const card = cards[i];
    if (card) {
      ctx.deck.unshift(card);
    }
  }
}

export function placeCardsOnBottom(ctx: CardZonesContext, cards: Card[]): void {
  ctx.deck.push(...cards);
}

export async function emitSkillTrigger(ctx: CardZonesContext, trigger: SkillTrigger, payload: SkillEventPayload, logs: string[]): Promise<void> {
  const hooks = ctx.skillHooks[trigger];
  for (const hook of hooks) {
    await hook(payload, logs);
  }
}

export async function applyDamage(ctx: CardZonesContext, source: Player | null, target: Player, amount: number, reason: string, logs: string[], damageCard?: Card, damageKind?: DamageKind | null, isChainSpread = false): Promise<void> {
  const payload: SkillEventPayload = {
    source,
    target,
    damage: amount,
    reason,
    ...(damageCard ? { card: damageCard } : {}),
  };
  await ctx.emitSkillTrigger("before_damage", payload, logs);
  let finalDamage = Math.max(0, payload.damage ?? 0);
  if (target.armor === CardType.SilverLion && finalDamage > 1) {
    finalDamage = 1;
    logs.push(`${target.name} 的白银狮子生效，本次伤害改为 1`);
  }
  if (finalDamage === 0) {
    logs.push(`${target.name} 未受到伤害`);
    return;
  }
  target.hp -= finalDamage;
  // 记录击杀归属：伤害来源即"凶手"，无来源伤害（闪电、苦肉等 source === target）记 null。
  ctx.noteDamageSource(source && source.id !== target.id ? source.id : null, target.id);
  logs.push(`${target.name} 受到 ${finalDamage} 点伤害，当前体力 ${Math.max(target.hp, 0)}`);
  // 铁索连环传导：处于连环状态的角色受到属性伤害时，其他连环角色受到等量同属性伤害（单波次，不递归）。
  // 属性伤害结算完成后，受到影响的所有角色（含被传导者）立即重置武将牌、脱离连环状态。
  if (!isChainSpread && target.chained) {
    const kind = damageKind ?? attributeDamageKind(damageCard?.type);
    if (kind) {
      const kindLabel = kind === "fire" ? "火焰" : "雷电";
      target.chained = false;
      logs.push(`${target.name} 受到${kindLabel}属性伤害，铁索连环状态重置`);
      const others = ctx.players.filter((p) => p.alive && p.chained && p.id !== target.id);
      for (const other of others) {
        other.chained = false;
        logs.push(`铁索连环传导：${other.name} 受到 ${finalDamage} 点${kindLabel}伤害，铁索连环状态重置`);
        await ctx.applyDamage(source, other, finalDamage, "铁索连环", logs, damageCard, kind, true);
      }
    }
  }
  // after_damage 钩子看到的是实际造成的伤害（白银狮子等压过之后的值），而非原始数值
  payload.damage = finalDamage;
  await ctx.emitSkillTrigger("after_damage", payload, logs);
}

export function isKongChengProtected(ctx: CardZonesContext, target: Player, cardType: CardType): boolean {
  if (ctx.isSlashCard(cardType)) {
    return isImmuneTo(target, "slash");
  }
  if (cardType === CardType.Duel) {
    return isImmuneTo(target, "duel");
  }
  return false;
}

export function damageCreditMap(ctx: CardZonesContext): Map<string, string | null> {
  ctx.damageCredit ??= new Map<string, string | null>();
  return ctx.damageCredit;
}

  /**
   * 把一张牌从所有已知区域移除（牌堆/弃牌堆/所有人手牌/木牛流马存牌），返回移除数量。
   * 外部改判钩子漏移除时的兜底：保证同一张牌只存在于一个区域。
   */
export function removeCardFromAllZones(ctx: CardZonesContext, cardId: string): number {
  let removed = 0;
  const sweep = (pool: Card[]): void => {
    for (let index = pool.length - 1; index >= 0; index -= 1) {
      if (pool[index]?.id === cardId) {
        pool.splice(index, 1);
        removed += 1;
      }
    }
  };
  sweep(ctx.deck);
  sweep(ctx.discardPile);
  for (const player of ctx.players) {
    sweep(player.hand);
    sweep(player.treasureCards);
  }
  return removed;
}

export function oxStoredTurnMap(ctx: CardZonesContext): Map<string, number> {
  ctx.woodenOxStoredTurn ??= new Map<string, number>();
  return ctx.woodenOxStoredTurn;
}

  /** 木牛流马取出资格：本回合刚置入的牌本回合不能取出（防置入/取出空转）。 */
export function canTakeStoredCard(ctx: CardZonesContext, card: Card): boolean {
  return (ctx.oxStoredTurnMap().get(card.id) ?? -1) < ctx.turn;
}

export function noteDamageSource(ctx: CardZonesContext, sourceId: string | null, targetId: string): void {
  ctx.damageCreditMap().set(targetId, sourceId);
}

export function takeDamageSource(ctx: CardZonesContext, targetId: string): string | null {
  const map = ctx.damageCreditMap();
  const sourceId = map.get(targetId) ?? null;
  map.delete(targetId);
  return sourceId;
}
