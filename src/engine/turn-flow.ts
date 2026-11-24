/**
 * 回合流程：准备/判定/摸牌/出牌/弃牌/结束六个阶段的推进与轮转。
 *
 * 从 `game.ts` 拆出，遵循仓库既有的 context-interface 约定：首参是 `TurnFlowContext`，
 * `game.ts` 以 `this as unknown as TurnFlowContext` 传入；拆出模块之间不互相 import。
 */

import { Card, CardType } from "./cards.js";
import { resolveSkillDescriptor } from "./skill-registry.js";
import { findSkillWithBooleanRule, getHandLimit } from "./skill-rules.js";
import { Player, SkillEventPayload, SkillName, SkillTrigger, TurnPhase } from "./types.js";

const drawCountPerTurn = 2;

export type TurnFlowContext = {
  aiTurnSeenStatesSet(): Set<string>;
  readonly currentPlayer: Player;
  currentPlayerIndex: number;
  discardCards(cards: Card[], actor: Player, reason: "弃置" | "判定", logs: string[]): Promise<void>;
  drawCards(playerId: string, count: number): number;
  emitSkillTrigger(trigger: SkillTrigger, payload: SkillEventPayload, logs: string[]): Promise<void>;
  endPlayPhase(playerId: string): Promise<string[]>;
  finishTurn(player: Player): Promise<string[]>;
  hasSkill(player: Player, skill: SkillName): boolean;
  moveToNextPlayer(): void;
  mustGetPlayer(id: string): Player;
  pendingNextTurn: boolean;
  pendingTurnEndPlayer: string | null;
  phase: TurnPhase;
  players: Player[];
  randomIndex(length: number): number;
  removeHandCardAt(player: Player, index: number, logs?: string[]): Promise<Card | undefined>;
  resetTurnSkillState(playerId: string): void;
  resolveDeaths(): Promise<string[]>;
  resolveDelayedJudgments(player: Player): Promise<string[]>;
  resolveWinner(): string[];
  round: number;
  roundStartIndex: number;
  shouldActivateOptionalEffect(player: Player, effect: SkillName | CardType): Promise<boolean>;
  shouldSkipDiscardPhase(player: Player, logs: string[]): Promise<boolean>;
  skillUsedThisRound: Map<string, Set<SkillName>>;
  skipDrawPhase: string | null;
  skipPlayPhase: string | null;
  slashPlayedThisTurn: boolean;
  slashUsedThisTurn: boolean;
  staged: boolean;
  startTurn(): Promise<string[]>;
  turn: number;
  wineBuffPlayerIds: Set<string>;
  wineUsedPlayerIds: Set<string>;
  winner: "human" | "ai" | "draw" | null;
};

export async function startTurn(ctx: TurnFlowContext): Promise<string[]> {
  if (ctx.winner !== null) {
    return [];
  }
  ctx.phase = TurnPhase.Judgment;
  ctx.slashUsedThisTurn = false;
  ctx.slashPlayedThisTurn = false;
  ctx.aiTurnSeenStatesSet().clear();
  ctx.wineBuffPlayerIds = new Set();
  ctx.wineUsedPlayerIds = new Set();
  const player = ctx.currentPlayer;
  const logs = [`第 ${ctx.turn} 回合：${player.name} 的回合`];
  // Phase 8：准备阶段触发点（官方回合流程的第一阶段，在判定阶段之前）。
  await ctx.emitSkillTrigger("prepare_phase_start", { actor: player }, logs);
  logs.push(`进入${TurnPhase.Judgment}`);
  if (player.delayedTricks.length > 0) {
    logs.push(...(await ctx.resolveDelayedJudgments(player)));
  } else {
    logs.push(`${player.name} 的判定区为空`);
  }
  logs.push(...(await ctx.resolveDeaths()));
  if (ctx.winner !== null) {
    return logs;
  }
  ctx.phase = TurnPhase.Draw;
  logs.push(`进入${TurnPhase.Draw}`);
  if (player.faceDown) {
    player.faceDown = false;
    logs.push(`${player.name} 翻至正面，跳过本回合`);
    if (ctx.hasSkill(player, SkillName.JieWei) && await ctx.shouldActivateOptionalEffect(player, SkillName.JieWei)) {
      const drawn = ctx.drawCards(player.id, 1);
      logs.push(`${player.name} 发动${SkillName.JieWei}，摸了 ${drawn} 张牌`);
    }
    ctx.moveToNextPlayer();
    if (ctx.winner !== null) return logs;
    if (ctx.staged) {
      ctx.pendingNextTurn = true;
      return logs;
    }
    logs.push(...(await ctx.startTurn()));
    return logs;
  }
  ctx.resetTurnSkillState(player.id);
  await ctx.emitSkillTrigger("turn_start", { actor: player }, logs);
  if (ctx.skipDrawPhase === player.id) {
    ctx.skipDrawPhase = null;
    logs.push(`${player.name} 跳过摸牌阶段`);
  } else {
    const drawPayload: SkillEventPayload = { actor: player, drawCount: drawCountPerTurn };
    await ctx.emitSkillTrigger("before_draw", drawPayload, logs);
    const drawn = ctx.drawCards(player.id, drawPayload.drawCount ?? drawCountPerTurn);
    logs.push(`${player.name} 摸了 ${drawn} 张牌`);
  }
  ctx.phase = TurnPhase.Play;
  // 克己口径：官方是"出牌阶段内未使用/打出过杀"。杀只能在出牌阶段使用/打出，
  // 在此重置后，这两个 flag 即精确等于"本出牌阶段"的使用记录。
  ctx.slashUsedThisTurn = false;
  ctx.slashPlayedThisTurn = false;
  if (ctx.skipPlayPhase === player.id) {
    ctx.skipPlayPhase = null;
    logs.push(`${player.name} 跳过出牌阶段`);
    logs.push(...(await ctx.endPlayPhase(player.id)));
    return logs;
  }
  logs.push(`进入${TurnPhase.Play}`);
  return logs;
}

export async function endPlayPhase(ctx: TurnFlowContext, playerId: string): Promise<string[]> {
  const player = ctx.mustGetPlayer(playerId);
  if (!player.alive || player.id !== ctx.currentPlayer.id || ctx.phase !== TurnPhase.Play) {
    return [];
  }
  ctx.phase = TurnPhase.Discard;
  const logs: string[] = [];
  logs.push(`进入${TurnPhase.Discard}`);
  if (!await ctx.shouldSkipDiscardPhase(player, logs)) {
    // 手牌上限 = 体力值 + rules.handLimitDelta（绝境这类技能会把它抬高），统一走 getHandLimit。
    const handLimit = getHandLimit(player);
    if (!player.isAI && player.hand.length > handLimit) {
      logs.push(`${player.name} 需要弃置 ${player.hand.length - handLimit} 张手牌`);
      return logs;
    }
    while (player.hand.length > handLimit) {
      const index = ctx.randomIndex(player.hand.length);
      const removed = await ctx.removeHandCardAt(player, index);
      if (removed) {
        logs.push(`${player.name} 弃置了 ${removed.type}`);
        await ctx.discardCards([removed], player, "弃置", logs);
      }
    }
  }
  if (ctx.staged) {
    ctx.pendingTurnEndPlayer = player.id;
  } else {
    logs.push(...(await ctx.finishTurn(player)));
  }
  return logs;
}

  /**
   * 弃牌阶段入口的拦截点（Phase 6）：让外部武将包与声明式规则有机会跳过整个弃牌阶段。
   *
   * 两条路径，任一命中即跳过：
   * 1. `discard_phase_start` 钩子把 `payload.skipDiscardPhase` 置 true（钩子自行处理"是否发动"询问）；
   * 2. 声明式规则 `rules.skipDiscardPhaseIfNoSlash`：出牌阶段内未使用/打出过杀时，询问玩家是否发动（克己）。
   */
export async function shouldSkipDiscardPhase(ctx: TurnFlowContext, player: Player, logs: string[]): Promise<boolean> {
  const payload: SkillEventPayload = { actor: player };
  await ctx.emitSkillTrigger("discard_phase_start", payload, logs);
  if (payload.skipDiscardPhase) {
    logs.push(`${player.name} 跳过弃牌阶段`);
    return true;
  }
  const skillId = findSkillWithBooleanRule(player, "skipDiscardPhaseIfNoSlash");
  if (!skillId || ctx.slashUsedThisTurn || ctx.slashPlayedThisTurn) {
    return false;
  }
  if (!await ctx.shouldActivateOptionalEffect(player, skillId)) {
    return false;
  }
  const displayName = resolveSkillDescriptor(skillId).displayName ?? skillId;
  logs.push(`${player.name} 发动${displayName}，跳过弃牌阶段`);
  return true;
}

export async function finishTurn(ctx: TurnFlowContext, player: Player): Promise<string[]> {
  const logs: string[] = [];
  ctx.phase = TurnPhase.End;
  logs.push(`进入${TurnPhase.End}`);
  // Phase 8：结束阶段触发点（弃牌阶段之后、回合结束之前；闭月/据守等内置结束阶段效果之前发出）。
  await ctx.emitSkillTrigger("end_phase_start", { actor: player }, logs);
  if (ctx.hasSkill(player, SkillName.BiYue) && await ctx.shouldActivateOptionalEffect(player, SkillName.BiYue)) {
    const drawn = ctx.drawCards(player.id, 1);
    logs.push(`${player.name} 的${SkillName.BiYue}生效，摸了 ${drawn} 张牌`);
  }
  if (ctx.hasSkill(player, SkillName.JuShou) && await ctx.shouldActivateOptionalEffect(player, SkillName.JuShou)) {
    const drawn = ctx.drawCards(player.id, 3);
    player.faceDown = true;
    logs.push(`${player.name} 发动${SkillName.JuShou}，摸了 ${drawn} 张牌并将武将牌翻至背面`);
  }
  logs.push(`${player.name} 结束回合`);
  ctx.moveToNextPlayer();
  if (ctx.winner !== null) {
    return logs;
  }
  if (ctx.staged) {
    ctx.pendingNextTurn = true;
    return logs;
  }
  logs.push(...(await ctx.startTurn()));
  return logs;
}

export function moveToNextPlayer(ctx: TurnFlowContext): void {
  const livingPlayers = ctx.players.filter((player) => player.alive);
  if (livingPlayers.length <= 1) {
    ctx.resolveWinner();
    return;
  }
  let moved = false;
  // Phase 9：轮次推进——遍历经过本轮起始座位即一轮结束（起始玩家已阵亡时，
  // 遍历会直接越过其座位，轮次照常推进，锚点顺延到落点座位）。
  let wrapped = false;
  for (let i = 0; i < ctx.players.length; i += 1) {
    ctx.currentPlayerIndex = (ctx.currentPlayerIndex + 1) % ctx.players.length;
    if (ctx.currentPlayerIndex === ctx.roundStartIndex) {
      wrapped = true;
    }
    if (ctx.players[ctx.currentPlayerIndex]?.alive) {
      moved = true;
      break;
    }
  }
  if (moved) {
    ctx.turn += 1;
    if (wrapped) {
      ctx.round += 1;
      ctx.roundStartIndex = ctx.currentPlayerIndex;
      ctx.skillUsedThisRound = new Map();
    }
  }
}

export async function advanceIfCurrentPlayerDead(ctx: TurnFlowContext, logs: string[]): Promise<void> {
  if (ctx.winner !== null) {
    return;
  }
  const current = ctx.players[ctx.currentPlayerIndex];
  if (current?.alive) {
    return;
  }
  ctx.moveToNextPlayer();
  if (ctx.winner !== null) {
    return;
  }
  if (ctx.staged) {
    ctx.pendingNextTurn = true;
    return;
  }
  logs.push(...(await ctx.startTurn()));
}
