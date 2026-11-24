/**
 * 决策与响应管线：`decide` 分发（DecisionHandler / 自动决策）、
 * 响应牌打出（闪/杀/无懈/桃）、求桃与响应选择状态。
 *
 * 从 `game.ts` 拆出，遵循仓库既有的 context-interface 约定：首参是 `ResponsePipelineContext`，
 * `game.ts` 以 `this as unknown as ResponsePipelineContext` 传入；拆出模块之间不互相 import。
 */

import { Card, CardType } from "./cards.js";
import { matchesConversionFilter } from "./card-utils.js";
import { resolveSkillDescriptor } from "./skill-registry.js";
import type { SkillConversion } from "./skill-registry.js";
import {
  CardSource,
  DecisionHandler,
  InteractionDecision,
  InteractionRequest,
  Player,
  ResponseKind,
  ResponseOption,
  SkillEventPayload,
  SkillId,
  SkillName,
  SkillTrigger,
} from "./types.js";

export type ResponsePipelineContext = {
  autoDecision(request: InteractionRequest): InteractionDecision;
  autoDecisionForDeadPlayer(request: InteractionRequest): InteractionDecision;
  buildResponseSources(player: Player, kind: ResponseKind, selfRescue?: boolean): CardSource[];
  canPlayerRespond(playerId: string, kind: ResponseKind): boolean;
  consumeResponseCard(player: Player, kind: ResponseKind, sourceId: string, logs: string[]): Promise<boolean>;
  consumeSelectedResponse(player: Player, kind: ResponseKind, optionId: string, logs: string[]): Promise<boolean>;
  decide(request: InteractionRequest): Promise<InteractionDecision>;
  decisionHandlers: Map<string, DecisionHandler>;
  discardPile: Card[];
  emitSkillTrigger(trigger: SkillTrigger, payload: SkillEventPayload, logs: string[]): Promise<void>;
  hasSkill(player: Player, skill: SkillName): boolean;
  isSlashCard(cardType: CardType): boolean;
  nextInteractionId(): number;
  notifyConversionUsed(player: Player, skillId: SkillId, conversion: SkillConversion, logs: string[]): Promise<void>;
  peachDecisions: Map<string, Map<string, string | null>>;
  peekUsableCard(player: Player, sourceId: string): (CardSource & { card: Card })| undefined;
  players: Player[];
  randomIndex(length: number): number;
  removeUsableCardBySourceId(player: Player, sourceId: string): Promise<Card | undefined>;
  requestCardResponse(player: Player, kind: ResponseKind, trigger: { cardName: string; actorId: string }, logs: string[]): Promise<boolean>;
  responseConversions(player: Player, kind: ResponseKind): { skillId: SkillId; conversion: SkillConversion }[];
  responsePolicyByPlayer: Map<string, Partial<Record<ResponseKind, boolean>>>;
  responseSelectionByPlayer: Map<string, Partial<Record<ResponseKind, string>>>;
  setPlayerResponseSelection(playerId: string, kind: ResponseKind, optionId: string | null): void;
  slashPlayedThisTurn: boolean;
  takePlayerResponseSelection(playerId: string, kind: ResponseKind): string | undefined;
};

export async function decide(ctx: ResponsePipelineContext, request: InteractionRequest): Promise<InteractionDecision> {
  const playerId =
    request.kind === "respond" ? request.responderId : request.kind === "collateral" ? request.targetId : request.playerId;
  const target = ctx.players.find((player) => player.id === playerId);
  if (target && !target.alive) {
    return ctx.autoDecisionForDeadPlayer(request);
  }
  const handler = ctx.decisionHandlers.get(playerId);
  if (handler) {
    try {
      const decision = await handler(request);
      if (decision) {
        return decision;
      }
    } catch {
      // 处理器异常时回退自动决策，避免结算中断
    }
  }
  return ctx.autoDecision(request);
}

export function autoDecisionForDeadPlayer(ctx: ResponsePipelineContext, request: InteractionRequest): InteractionDecision {
  if (
    request.kind === "optional-effect" ||
    request.kind === "respond" ||
    request.kind === "collateral"
  ) {
    return { choice: "pass" };
  }
  if (request.kind === "choose-discard") {
    return request.sources[0] ? { choice: "pass" } : { choice: "card", sourceId: "" };
  }
  if (request.kind === "choose-suit") {
    return { choice: "suit", suit: request.suits[0] ?? "heart" };
  }
  return { choice: "pass" };
}

export function autoDecision(ctx: ResponsePipelineContext, request: InteractionRequest): InteractionDecision {
  if (request.kind === "optional-effect") {
    return { choice: "effect", enabled: false };
  }
  if (request.kind === "collateral") {
    const victim = request.victims[0];
    if (victim) {
      const firstSlash = request.sources[0];
      return firstSlash
        ? { choice: "target", targetId: victim, sourceId: firstSlash.sourceId }
        : { choice: "target", targetId: victim };
    }
    return { choice: "pass" };
  }
  if (request.kind === "choose-discard") {
    const first = request.sources[0];
    if (first) {
      return { choice: "card", sourceId: first.sourceId };
    }
    return { choice: "pass" };
  }
  if (request.kind === "choose-suit") {
    const suit = request.suits[ctx.randomIndex(request.suits.length)] ?? "heart";
    return { choice: "suit", suit };
  }
  const first = request.sources[0];
  if (first) {
    return { choice: "card", sourceId: first.sourceId };
  }
  return { choice: "pass" };
}

export async function consumeResponseCard(ctx: ResponsePipelineContext, player: Player, kind: ResponseKind, sourceId: string, logs: string[]): Promise<boolean> {
  const source = ctx.peekUsableCard(player, sourceId);
  if (!source) {
    return false;
  }
  const card = source.card;
  // 酒方法Ⅱ：濒死者本人可将酒当桃使用（仅自救，他人救援只能用桃）
  const wineAsPeach = kind === "peach" && card.type === CardType.Wine && player.hp <= 0;
  const direct =
    kind === "dodge"
      ? card.type === CardType.Dodge
      : kind === "slash"
        ? ctx.isSlashCard(card.type)
        : kind === "negate"
          ? card.type === CardType.Negate
          : card.type === CardType.Peach || wineAsPeach;
  // Phase 8：本次响应若走了当牌转换，成功后要通知技能扣费（限次/标记）。
  let viaConversion: { skillId: SkillId; conversion: SkillConversion } | undefined;
  if (!direct) {
    // 声明式 conversions（`viaSkill` 凭据）与内置转换技各自的"当 X"判定。
    // 凭据只在来源列表里（`peekUsableCard` 只回 {card}），所以这里按 sourceId 回查一次候选来源；
    // 再以技能的真实声明复算 `from`，让伪造的 sourceId 无法蒙过去。
    const candidate = ctx.buildResponseSources(player, kind, kind === "peach" && player.hp <= 0).find(
      (entry) => entry.sourceId === sourceId && entry.viaSkill,
    );
    viaConversion = candidate
      ? ctx.responseConversions(player, kind).find(
          (entry) => entry.skillId === candidate.viaSkill && matchesConversionFilter(card, entry.conversion.from),
        )
      : undefined;
    const convertedLabel = viaConversion
      ? `${resolveSkillDescriptor(viaConversion.skillId).displayName ?? viaConversion.skillId}当${viaConversion.conversion.to}`
      : kind === "dodge" && card.color === "black" && ctx.hasSkill(player, SkillName.QingGuo)
        ? `${SkillName.QingGuo}当${CardType.Dodge}`
        : kind === "dodge" && ctx.isSlashCard(card.type) && ctx.hasSkill(player, SkillName.LongDan)
          ? `${SkillName.LongDan}当${CardType.Dodge}`
          : kind === "slash" && card.color === "red" && ctx.hasSkill(player, SkillName.WuSheng)
            ? `${SkillName.WuSheng}当${CardType.Slash}`
            : kind === "slash" && card.type === CardType.Dodge && ctx.hasSkill(player, SkillName.LongDan)
              ? `${SkillName.LongDan}当${CardType.Slash}`
              : kind === "peach" && card.color === "red" && ctx.hasSkill(player, SkillName.JiJiu)
                ? `${SkillName.JiJiu}当${CardType.Peach}`
                : null;
    if (!convertedLabel) {
      return false;
    }
    logs.push(`${player.name} 发动${convertedLabel}（${card.type}）`);
  }
  const removed = await ctx.removeUsableCardBySourceId(player, sourceId);
  if (!removed) {
    return false;
  }
  ctx.discardPile.push(removed);
  // 本回合"打出"过杀（与出牌阶段"使用"杀分开计数，供克己等技能判定）。
  if (kind === "slash") {
    ctx.slashPlayedThisTurn = true;
  }
  // 拦截点 card_used：打出一张响应牌（reason="打出"）。
  await ctx.emitSkillTrigger("card_used", { actor: player, card: removed, reason: "打出" }, logs);
  if (viaConversion) {
    await ctx.notifyConversionUsed(player, viaConversion.skillId, viaConversion.conversion, logs);
  }
  if (wineAsPeach) {
    logs.push(`${player.name} 使用酒自救（当${CardType.Peach}）`);
  }
  return true;
}

export async function requestCardResponse(ctx: ResponsePipelineContext, player: Player, kind: ResponseKind, trigger: { cardName: string; actorId: string }, logs: string[]): Promise<boolean> {
  const policy = ctx.responsePolicyByPlayer.get(player.id);
  if (policy && policy[kind] === false) {
    ctx.setPlayerResponseSelection(player.id, kind, null);
    return false;
  }
  const selection = ctx.takePlayerResponseSelection(player.id, kind);
  if (selection) {
    return await ctx.consumeSelectedResponse(player, kind, selection, logs);
  }
  // 酒方法Ⅱ：濒死者本人可将酒当桃自救
  const selfRescue = kind === "peach" && trigger.actorId === player.id;
  const sources = ctx.buildResponseSources(player, kind, selfRescue);
  // 拦截点 provide_response（Phase 7）：在"没有任何来源 → 直接判为无法响应"**之前**发出，
  // 钩子可往 payload.responseSources 里 push 额外来源（代码技能的当牌转换）。
  const payload: SkillEventPayload = { actor: player, need: kind, responseSources: sources };
  await ctx.emitSkillTrigger("provide_response", payload, logs);
  const usable = payload.responseSources ?? sources;
  if (usable.length === 0) {
    return false;
  }
  const cardNames: Record<ResponseKind, string> = {
    dodge: CardType.Dodge,
    slash: CardType.Slash,
    negate: CardType.Negate,
    peach: CardType.Peach,
  };
  // 求桃时明确濒死者，救援者才知道要救谁
  let reason = `${trigger.cardName}：是否打出${cardNames[kind]}？`;
  if (kind === "peach") {
    const dying = ctx.players.find((item) => item.id === trigger.actorId);
    const dyingName = dying ? dying.name : "";
    reason = trigger.actorId === player.id
      ? `你濒死：是否打出${CardType.Peach}自救？`
      : `${dyingName}濒死：是否打出${CardType.Peach}救援？`;
  }
  const decision = await ctx.decide({
    kind: "respond",
    requestId: ctx.nextInteractionId(),
    responderId: player.id,
    trigger,
    responseKind: kind,
    sources: usable,
    allowPass: true,
    reason,
  });
  if (decision.choice !== "card") {
    return false;
  }
  return await ctx.consumeResponseCard(player, kind, decision.sourceId, logs);
}

export function canPlayerRespond(ctx: ResponsePipelineContext, playerId: string, kind: ResponseKind): boolean {
  const policy = ctx.responsePolicyByPlayer.get(playerId);
  if (!policy) {
    return true;
  }
  const allowed = policy[kind];
  return allowed !== false;
}

export async function consumeSelectedResponse(ctx: ResponsePipelineContext, player: Player, kind: ResponseKind, optionId: string, logs: string[]): Promise<boolean> {
  let cardId = optionId;
  if (optionId.startsWith("qingguo:") || optionId.startsWith("wusheng:") || optionId.startsWith("longdan:")) {
    cardId = optionId.slice(optionId.indexOf(":") + 1);
  }
  const handSourceId = `hand:${cardId}`;
  if (ctx.peekUsableCard(player, handSourceId)) {
    return await ctx.consumeResponseCard(player, kind, handSourceId, logs);
  }
  const treasureSourceId = `treasure:${cardId}`;
  if (ctx.peekUsableCard(player, treasureSourceId)) {
    return await ctx.consumeResponseCard(player, kind, treasureSourceId, logs);
  }
  return false;
}

export async function consumePeachResponse(ctx: ResponsePipelineContext, player: Player, dyingPlayerId: string, logs: string[]): Promise<boolean> {
  const targetedDecisions = ctx.peachDecisions.get(dyingPlayerId);
  if (targetedDecisions?.has(player.id)) {
    const optionId = targetedDecisions.get(player.id);
    if (optionId === null || optionId === undefined) return false;
    return await ctx.consumeSelectedResponse(player, "peach", optionId, logs);
  }
  if (!ctx.canPlayerRespond(player.id, "peach")) return false;
  return ctx.requestCardResponse(player, "peach", { cardName: CardType.Peach, actorId: dyingPlayerId }, logs);
}

export function takePlayerResponseSelection(ctx: ResponsePipelineContext, playerId: string, kind: ResponseKind): string | undefined {
  const selected = ctx.responseSelectionByPlayer.get(playerId);
  if (!selected) {
    return undefined;
  }
  const optionId = selected[kind];
  delete selected[kind];
  if (Object.keys(selected).length === 0) {
    ctx.responseSelectionByPlayer.delete(playerId);
  } else {
    ctx.responseSelectionByPlayer.set(playerId, selected);
  }
  return optionId;
}

export function getPlayerResponseOptions(ctx: ResponsePipelineContext, playerId: string, kind: ResponseKind): ResponseOption[] {
  const player = ctx.players.find((item) => item.id === playerId);
  if (!player || !player.alive) {
    return [];
  }
  if (kind === "negate" || kind === "peach") {
    const cardType = kind === "negate" ? CardType.Negate : CardType.Peach;
    return player.hand
      .filter((card) => card.type === cardType)
      .map((card) => ({ id: card.id, kind, label: `打出${cardType}` }));
  }
  if (kind === "dodge") {
    const direct = player.hand
      .filter((card) => card.type === CardType.Dodge)
      .map((card) => ({ id: card.id, kind, label: `打出${CardType.Dodge}` }));
    const qingGuo = ctx.hasSkill(player, SkillName.QingGuo)
      ? player.hand
          .filter((card) => card.color === "black" && card.type !== CardType.Dodge)
          .map((card) => ({ id: `qingguo:${card.id}`, kind, label: `${SkillName.QingGuo}当${CardType.Dodge}` }))
      : [];
    const longDan = ctx.hasSkill(player, SkillName.LongDan)
      ? player.hand
          .filter((card) => ctx.isSlashCard(card.type))
          .map((card) => ({ id: `longdan:${card.id}`, kind, label: `${SkillName.LongDan}当${CardType.Dodge}` }))
      : [];
    return [...direct, ...qingGuo, ...longDan];
  }
  const direct = player.hand
    .filter((card) => ctx.isSlashCard(card.type))
    .map((card) => ({ id: card.id, kind, label: `打出${card.type}` }));
  const wuSheng = ctx.hasSkill(player, SkillName.WuSheng)
    ? player.hand
        .filter((card) => card.color === "red" && !ctx.isSlashCard(card.type))
        .map((card) => ({ id: `wusheng:${card.id}`, kind, label: `${SkillName.WuSheng}当${CardType.Slash}` }))
    : [];
  const longDan = ctx.hasSkill(player, SkillName.LongDan)
    ? player.hand
        .filter((card) => card.type === CardType.Dodge)
        .map((card) => ({ id: `longdan:${card.id}`, kind, label: `${SkillName.LongDan}当${CardType.Slash}` }))
    : [];
  return [...direct, ...wuSheng, ...longDan];
}

export function setPlayerResponseSelection(ctx: ResponsePipelineContext, playerId: string, kind: ResponseKind, optionId: string | null): void {
  if (optionId === null) {
    const existed = ctx.responseSelectionByPlayer.get(playerId);
    if (!existed) {
      return;
    }
    delete existed[kind];
    if (Object.keys(existed).length === 0) {
      ctx.responseSelectionByPlayer.delete(playerId);
    }
    return;
  }
  const existed = ctx.responseSelectionByPlayer.get(playerId) ?? {};
  existed[kind] = optionId;
  ctx.responseSelectionByPlayer.set(playerId, existed);
}

export function setPeachDecision(ctx: ResponsePipelineContext, dyingPlayerId: string, rescuerId: string, optionId: string | null): void {
  const decisions = ctx.peachDecisions.get(dyingPlayerId) ?? new Map<string, string | null>();
  decisions.set(rescuerId, optionId);
  ctx.peachDecisions.set(dyingPlayerId, decisions);
}

export function clearPeachDecisions(ctx: ResponsePipelineContext): void {
  ctx.peachDecisions.clear();
}
