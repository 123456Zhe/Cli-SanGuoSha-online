import { GameAction, GameSnapshot, Player } from "../engine/game.js";

type PromptAgentIdentity = {
  playerId: string;
  name: string;
  role: string;
  general: string;
};

export type AgentPromptInput = {
  rulesText: string;
  snapshot: GameSnapshot;
  agent: PromptAgentIdentity;
  actions: GameAction[];
  previousRoundContexts: RoundPromptContext[];
};

export type RoundPromptContext = {
  round: number;
  displayLines: string[];
  battlefieldLines: string[];
};

export type AgentPromptPackage = {
  systemPrompt: string;
  userPrompt: string;
};

const toEquipmentsText = (player: Player): string =>
  `${player.weapon ?? "无"}/${player.armor ?? "无"}/${player.attackHorse ?? "无"}/${player.defenseHorse ?? "无"}/${player.treasure ?? "无"}`;

const toPlayerBattleLine = (player: Player): string =>
  `${player.name}(${player.id})|身份:${player.role}|武将:${player.general}|体力:${Math.max(player.hp, 0)}/${player.maxHp}|手牌:${player.hand.length}|装备:${
    toEquipmentsText(player)
  }|状态:${player.alive ? "存活" : "阵亡"}`;

const toActionLine = (action: GameAction, index: number): string => {
  if (action.type === "end") {
    return `${index + 1}. ${action.label} | requiresTarget=false`;
  }
  const targetText = action.targets.length > 0 ? action.targets.join(",") : "无";
  return `${index + 1}. ${action.label} | requiresTarget=${action.requiresTarget} | targets=${targetText}`;
};

const buildCurrentRoundStatus = (snapshot: GameSnapshot, agent: PromptAgentIdentity): string => {
  const currentPlayer = snapshot.players.find((item) => item.id === snapshot.currentPlayerId);
  const currentPlayerLabel = currentPlayer ? `${currentPlayer.name}(${currentPlayer.id})` : snapshot.currentPlayerId;
  return [
    `轮次: 第${snapshot.turn}轮`,
    `阶段: ${snapshot.phase}`,
    `当前行动角色: ${currentPlayerLabel}`,
    `你控制角色: ${agent.name}(${agent.playerId})`,
  ].join("\n");
};

export const buildAgentPrompt = (input: AgentPromptInput): AgentPromptPackage => {
  const previousRoundsText =
    input.previousRoundContexts.length > 0
      ? input.previousRoundContexts
          .map((item, index) => {
            const displayText =
              item.displayLines.length > 0 ? item.displayLines.map((line) => `  - ${line}`).join("\n") : "  - 无";
            const battlefieldText =
              item.battlefieldLines.length > 0
                ? item.battlefieldLines.map((line) => `  - ${line}`).join("\n")
                : "  - 无";
            return [
              `${index + 1}. 第${item.round}轮`,
              " 显示区出牌内容：",
              displayText,
              " 战场状态：",
              battlefieldText,
            ].join("\n");
          })
          .join("\n")
      : "无";
  const battlefieldText = input.snapshot.players.map((player) => toPlayerBattleLine(player)).join("\n");
  const actionText = input.actions.map((action, index) => toActionLine(action, index)).join("\n");
  const currentRoundStatus = buildCurrentRoundStatus(input.snapshot, input.agent);
  const systemPrompt = [
    "你是三国杀游戏高手。",
    `你在本局中负责角色 ${input.agent.name}。`,
    `你的身份是${input.agent.role}，武将是${input.agent.general}。`,
    "你的目标是尽最大可能让自己的身份阵营获胜。",
    "你必须严格遵守规则并只从给定可行动作中选择。",
    '输出必须是JSON对象：{"actionIndex":数字,"targetId":"可选"}，禁止输出其他文本。',
    "",
    "三国杀游戏rules：",
    input.rulesText,
  ].join("\n");
  const userPrompt = [
    "游戏之前轮次上下文（仅保留最近前三轮）：",
    previousRoundsText,
    "",
    "游戏本轮状态：",
    currentRoundStatus,
    "",
    "游戏当前战场状态：",
    battlefieldText,
    "",
    "本回合可选动作：",
    actionText,
    "",
    '请严格输出JSON，例如 {"actionIndex":1} 或 {"actionIndex":2,"targetId":"human"}。',
  ].join("\n");
  return { systemPrompt, userPrompt };
};
