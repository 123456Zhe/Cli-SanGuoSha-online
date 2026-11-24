/**
 * AI 回合驱动与防空转：`runAITurn` / `getBestAiDecision`，以及
 * “本回合已出现过的局面签名”记录（决策器零收益打转时强制结束出牌）。
 *
 * 从 `game.ts` 拆出，遵循仓库既有的 context-interface 约定：首参是 `AiDriverContext`，
 * `game.ts` 以 `this as unknown as AiDriverContext` 传入；拆出模块之间不互相 import。
 */

import { Card } from "./cards.js";
import { AiHeuristicsContext, pickBestAiAction, pickBestTarget } from "./ai-heuristics.js";
import { GameAction, Player, TurnPhase } from "./types.js";

export type AiDriverContext = {
  aiTurnSeenStates: Set<string> | undefined;
  aiTurnSeenStatesSet(): Set<string>;
  beginAiTurnProgress(): void;
  buildAiTurnProgressKey(): string;
  readonly currentPlayer: Player;
  deck: Card[];
  discardPile: Card[];
  endPlayPhase(playerId: string): Promise<string[]>;
  getPlayableActions(playerId: string): GameAction[];
  noteAiTurnProgress(): boolean;
  phase: TurnPhase;
  playAction(playerId: string, action: GameAction, targetId?: string, selectedCardId?: string): Promise<string[]>;
  players: Player[];
  turn: number;
  winner: "human" | "ai" | "draw" | null;
};

export async function runAITurn(ctx: AiDriverContext): Promise<string[]> {
  if (ctx.winner !== null || !ctx.currentPlayer.isAI || !ctx.currentPlayer.alive) {
    return [];
  }
  const logs: string[] = [];
  ctx.beginAiTurnProgress();
  while (true) {
    const ai = ctx.currentPlayer;
    const actions = ctx.getPlayableActions(ai.id);
    const best = pickBestAiAction(ctx as unknown as AiHeuristicsContext, actions, ai.id);
    if (!best || best.type === "end") {
      logs.push(...(await ctx.endPlayPhase(ai.id)));
      return logs;
    }
    const targetId = best.requiresTarget ? pickBestTarget(ctx as unknown as AiHeuristicsContext, best.targets) : undefined;
    logs.push(...(await ctx.playAction(ai.id, best, targetId)));
    if (ctx.winner !== null) {
      return logs;
    }
    // 兜底：决策器零收益打转（局面重复出现）时强制结束，不再无限出牌
    if (ctx.noteAiTurnProgress()) {
      logs.push(`${ai.name} 的出牌陷入重复局面，强制结束出牌阶段`);
      logs.push(...(await ctx.endPlayPhase(ai.id)));
      return logs;
    }
  }
}

export function getBestAiDecision(ctx: AiDriverContext, playerId: string): { action: GameAction; targetId?: string } | null {
  const player = ctx.players.find((item) => item.id === playerId);
  if (!player || !player.alive || !player.isAI) {
    return null;
  }
  const actions = ctx.getPlayableActions(player.id);
  const best = pickBestAiAction(ctx as unknown as AiHeuristicsContext, actions, player.id);
  if (!best) {
    return null;
  }
  if (best.type === "end" || !best.requiresTarget) {
    return { action: best };
  }
  const targetId = pickBestTarget(ctx as unknown as AiHeuristicsContext, best.targets);
  return targetId ? { action: best, targetId } : { action: best };
}

export function aiTurnSeenStatesSet(ctx: AiDriverContext): Set<string> {
  ctx.aiTurnSeenStates ??= new Set<string>();
  return ctx.aiTurnSeenStates;
}

export function buildAiTurnProgressKey(ctx: AiDriverContext): string {
  const parts: string[] = [`t${ctx.turn}`, `p${ctx.phase}`, `d${ctx.deck.length}`, `x${ctx.discardPile.length}`];
  for (const player of ctx.players) {
    parts.push(
      [
        player.id,
        player.alive ? 1 : 0,
        player.hp,
        player.hand.map((card) => card.id).join(","),
        player.weapon ?? "",
        player.armor ?? "",
        player.defenseHorse ?? "",
        player.attackHorse ?? "",
        player.treasure ?? "",
        player.treasureCards.map((card) => card.id).join(","),
        player.chained ? 1 : 0,
      ].join("|"),
    );
  }
  return parts.join("#");
}

  /**
   * AI 驱动每执行一个动作后调用：当前局面若本回合已出现过则返回 true
   *（决策器在零收益打转，调用方应强制结束出牌），否则记录并返回 false。
   */
export function noteAiTurnProgress(ctx: AiDriverContext): boolean {
  const seen = ctx.aiTurnSeenStatesSet();
  const key = ctx.buildAiTurnProgressKey();
  if (seen.has(key)) {
    return true;
  }
  if (seen.size > 1000) {
    seen.clear();
  }
  seen.add(key);
  return false;
}

  /** AI 驱动在回合开始时调用：清空局面记录并记下初始局面。 */
export function beginAiTurnProgress(ctx: AiDriverContext): void {
  ctx.aiTurnSeenStatesSet().clear();
  ctx.noteAiTurnProgress();
}
