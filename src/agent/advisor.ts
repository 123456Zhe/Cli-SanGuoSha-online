import { GameSnapshot } from "../engine/game.js";
import { buildBattlefieldLines } from "./round-context.js";
import { RoleGuess } from "./local-engine.js";

const CONFIDENCE_TEXT = { high: "高", medium: "中", low: "低" } as const;

/**
 * 规则助手报告（纯函数，无 I/O、无网络）。
 * 身份部分只消费调用方给的 guesses（公开身份直读 + 行为推断），本文件不读隐藏身份。
 */
export const buildRuleAdvisorReport = (
  snapshot: GameSnapshot,
  viewerId: string,
  guesses: RoleGuess[],
): string[] => {
  const lines: string[] = [];
  const viewer = snapshot.players.find((player) => player.id === viewerId);
  lines.push(`—— 局势（第${snapshot.turn}轮${snapshot.phase ? `·${snapshot.phase}` : ""}，你的视角：${viewer ? `${viewer.name}/${viewer.general}` : viewerId}） ——`);
  lines.push(...buildBattlefieldLines(snapshot.players, viewerId));
  const alive = snapshot.players.filter((player) => player.alive);
  const lowHp = alive.filter((player) => player.hp <= 2).map((player) => `${player.name}(${player.hp}血)`);
  if (lowHp.length > 0) {
    lines.push(`濒危：${lowHp.join("、")}`);
  }
  lines.push("—— 身份判断 ——");
  for (const guess of guesses) {
    const player = snapshot.players.find((item) => item.id === guess.playerId);
    const general = player ? `/${player.general}` : "";
    if (!guess.inferred) {
      lines.push(`${guess.name}${general}：${guess.role}（公开）`);
      continue;
    }
    const basis = guess.reasons.length > 0 ? `，依据：${guess.reasons.join("、")}` : "，依据：暂无明显行为";
    lines.push(`${guess.name}${general}：推断${guess.role}（置信${CONFIDENCE_TEXT[guess.confidence]}）${basis}`);
  }
  return lines;
};
