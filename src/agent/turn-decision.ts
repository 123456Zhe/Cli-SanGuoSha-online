import { GameAction, SanGuoGame } from "../engine/game.js";
import { AiDriverLabel, GameAiLoop } from "./ai.js";
import { LocalAiEngine } from "./local-engine.js";

export type AiTurnDecision = {
  action: GameAction;
  targetId?: string;
};

export type AiTurnDecisionResult = {
  decision: AiTurnDecision | null;
  driverLabel: AiDriverLabel | "本地AI";
  fallbackReason: string | null;
  localInsight?: string;
  modelUsed: boolean;
};

export const isSameAction = (left: GameAction, right: GameAction): boolean => {
  if (left.type !== right.type) {
    return false;
  }
  if (left.type === "end" && right.type === "end") {
    return true;
  }
  if (left.type === "skill" && right.type === "skill") {
    return left.skill === right.skill && left.label === right.label;
  }
  if (left.type === "play" && right.type === "play") {
    return left.cardIndex === right.cardIndex && left.label === right.label;
  }
  return false;
};

/**
 * AI 单个出牌阶段的最大动作数：正常回合远小于此值；
 * 主要用于兜底防止 LLM 反复执行木牛流马「置入/取出」等无收益空转导致回合永不结束。
 * 上限随可用牌数放宽（乘 3），且下限设 20，避免误伤甄姬/黄月英等摸牌流的超长合法回合。
 */
export const computeAiTurnActionLimit = (handCount: number, treasureCount: number): number =>
  Math.max(20, (handCount + treasureCount) * 3);

const normalizeAiDecision = (
  game: SanGuoGame,
  playerId: string,
  decision: AiTurnDecision | null | undefined,
): AiTurnDecision | null => {
  if (!decision) {
    return null;
  }
  const actions = game.getPlayableActions(playerId);
  const matchedAction = actions.find((action) => isSameAction(action, decision.action));
  if (!matchedAction) {
    return null;
  }
  if (matchedAction.type === "end") {
    return { action: matchedAction };
  }
  if (matchedAction.type !== "play" && matchedAction.type !== "skill") {
    return { action: matchedAction };
  }
  if (!matchedAction.requiresTarget) {
    return { action: matchedAction };
  }
  const targetId =
    decision.targetId && matchedAction.targets.includes(decision.targetId)
      ? decision.targetId
      : (matchedAction.targets[0] ?? null);
  if (!targetId) {
    return null;
  }
  return { action: matchedAction, targetId };
};

/**
 * AI 出牌决策链：LLM（GameAiLoop）→ 本地策略引擎（LocalAiEngine）→ 引擎内置启发式。
 * 返回经过校验的决策与驱动信息；LLM 不可用时 modelUsed=false 并携带回退原因。
 * aiLoop 传 null 表示强制只用本地策略（simple 模式）。
 */
export const pickAiTurnDecision = async (
  game: SanGuoGame,
  playerId: string,
  aiLoop: GameAiLoop | null,
  localAiEngine: LocalAiEngine,
): Promise<AiTurnDecisionResult> => {
  const modelDecision = aiLoop ? await aiLoop.decide(game, playerId) : null;
  const localDecision = localAiEngine.decide(game, playerId);
  const fallbackDecision: AiTurnDecision | null = localDecision
    ? localDecision.targetId
      ? { action: localDecision.action, targetId: localDecision.targetId }
      : { action: localDecision.action }
    : game.getBestAiDecision(playerId);
  const decision = modelDecision ?? fallbackDecision;
  const driverLabel: AiDriverLabel | "本地AI" = modelDecision?.driverLabel ?? "本地AI";
  const fallbackReason = !modelDecision && aiLoop ? aiLoop.getLastFailureReason() : null;
  const normalized = normalizeAiDecision(game, playerId, decision);
  return {
    decision: normalized,
    driverLabel,
    fallbackReason,
    ...(!modelDecision && localDecision ? { localInsight: localDecision.insight } : {}),
    modelUsed: Boolean(modelDecision),
  };
};
