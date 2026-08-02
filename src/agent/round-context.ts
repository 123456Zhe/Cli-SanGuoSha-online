import { Player } from "../engine/game.js";
import { maskRole, RoundPromptContext } from "./prompt.js";

/**
 * 从日志中按「第 N 回合/第 N 轮」标记切分每轮的显示区内容，
 * 结合战场历史快照，构造最近 maxRounds 轮的上下文（供 LLM 与本地策略引擎使用）。
 */
export const buildRoundContexts = (
  logs: string[],
  battlefieldHistory: Map<number, string[]>,
  currentRound: number,
  maxRounds: number,
): RoundPromptContext[] => {
  const roundLogs = new Map<number, string[]>();
  let activeRound: number | null = null;
  for (const line of logs) {
    const matched = line.match(/^第\s*(\d+)\s*(?:回合|轮)[:：]/);
    if (matched?.[1]) {
      activeRound = Number.parseInt(matched[1], 10);
    }
    if (activeRound === null || Number.isNaN(activeRound)) {
      continue;
    }
    if (!roundLogs.has(activeRound)) {
      roundLogs.set(activeRound, []);
    }
    roundLogs.get(activeRound)?.push(line);
  }
  const rounds = Array.from(roundLogs.keys())
    .filter((round) => round < currentRound)
    .sort((a, b) => a - b)
    .slice(-maxRounds);
  return rounds.map((round) => ({
    round,
    displayLines: roundLogs.get(round) ?? [],
    battlefieldLines: battlefieldHistory.get(round) ?? [],
  }));
};

export const toPromptBattlefieldLine = (player: Player, viewerId?: string): string => {
  const equipments = `${player.weapon ?? "无"}/${player.armor ?? "无"}/${player.attackHorse ?? "无"}/${player.defenseHorse ?? "无"}/${player.treasure ?? "无"}`;
  return `${player.name}(${player.id})|身份:${maskRole(player, viewerId)}|武将:${player.general}|体力:${Math.max(player.hp, 0)}/${player.maxHp}|手牌:${player.hand.length}|装备:${equipments}|状态:${player.alive ? "存活" : "阵亡"}`;
};

export const buildBattlefieldLines = (players: readonly Player[], viewerId?: string): string[] =>
  players.map((player) => toPromptBattlefieldLine(player, viewerId));

/**
 * 记录某轮次的战场快照，超出 maxRounds 时裁剪最旧轮次。
 */
export const trackRoundBattlefield = (
  history: Map<number, string[]>,
  turn: number,
  lines: string[],
  maxRounds: number,
): void => {
  history.set(turn, lines);
  if (history.size <= maxRounds) {
    return;
  }
  const rounds = Array.from(history.keys()).sort((a, b) => a - b);
  const toDelete = rounds.slice(0, rounds.length - maxRounds);
  for (const round of toDelete) {
    history.delete(round);
  }
};
