import { GameAction, GameSnapshot, Player, PlayerRole } from "../engine/game.js";
import { CardType } from "../engine/cards.js";
import { InteractionRequest } from "../engine/interaction.js";

export type ReasoningLevel = "fast" | "normal" | "deep";

export const REASONING_EFFORT: Record<ReasoningLevel, "low" | "medium" | "high"> = {
  fast: "low",
  normal: "medium",
  deep: "high",
};

export const REASONING_THINKING_MULTIPLIER: Record<ReasoningLevel, number> = {
  fast: 0.4,
  normal: 1,
  deep: 2.5,
};

const LEVEL_INSTRUCTION: Record<ReasoningLevel, string> = {
  fast: "请快速基于当前局面直接做出决策，避免冗长思考。",
  normal: "请谨慎评估身份阵营、血量斩杀线与手牌资源后做出决策。",
  deep: "请深度思考：先分析各方身份关系、血量与斩杀线、手牌与装备资源、本轮博弈得失，再做出决策；可以给出简短思考过程，但最终必须输出符合要求的 JSON。",
};

export type PromptAgentIdentity = {
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
  reasoningLevel?: ReasoningLevel;
  strategyNote?: string;
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

/**
 * 根据当前局面自动判定推理等级。
 * 有人濒死或阵亡时：内奸（需要深度博弈）用 deep，其余角色降为 fast 避免决策耗时过长；
 * 其余局面 normal 即可。fast 也可手动强制指定（--ai-reasoning=fast）。
 */
export const pickReasoningLevel = (snapshot: GameSnapshot, viewerId?: string): ReasoningLevel => {
  const dyingOrDead = snapshot.players.some((player) => !player.alive || player.hp <= 0);
  if (!dyingOrDead) {
    return "normal";
  }
  const self = snapshot.players.find((player) => player.id === viewerId);
  return self?.role === PlayerRole.Traitor ? "deep" : "fast";
};

/**
 * 与客户端一致的视角遮蔽：只有自己、主公、已阵亡玩家的身份可见，其余显示「未知」。
 * viewerId 为空时按公共视角处理（仅主公与已阵亡可见）。
 */
export const maskRole = (player: Player, viewerId?: string): string => {
  if (viewerId !== undefined && player.id === viewerId) {
    return player.role;
  }
  if (player.role === PlayerRole.Lord || !player.alive) {
    return player.role;
  }
  return "未知";
};

const toEquipmentsText = (player: Player): string =>
  `${player.weapon ?? "无"}/${player.armor ?? "无"}/${player.attackHorse ?? "无"}/${player.defenseHorse ?? "无"}/${player.treasure ?? "无"}`;

const toPlayerBattleLine = (player: Player, viewerId?: string): string =>
  `${player.name}(${player.id})|身份:${maskRole(player, viewerId)}|武将:${player.general}|体力:${Math.max(player.hp, 0)}/${player.maxHp}|手牌:${player.hand.length}|装备:${
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

const buildPreviousRoundsText = (previousRoundContexts: RoundPromptContext[]): string => {
  if (previousRoundContexts.length === 0) {
    return "无";
  }
  return previousRoundContexts
    .map((item, index) => {
      const displayText =
        item.displayLines.length > 0 ? item.displayLines.map((line) => `  - ${line}`).join("\n") : "  - 无";
      const battlefieldText =
        item.battlefieldLines.length > 0 ? item.battlefieldLines.map((line) => `  - ${line}`).join("\n") : "  - 无";
      return [
        `${index + 1}. 第${item.round}轮`,
        " 显示区出牌内容：",
        displayText,
        " 战场状态：",
        battlefieldText,
      ].join("\n");
    })
    .join("\n");
};

const buildStrategyNoteBlock = (strategyNote: string): string =>
  `\n你上一回合末的既定策略笔记：\n${strategyNote}\n`;

const buildSystemPrompt = (
  rulesText: string,
  agent: PromptAgentIdentity,
  level: ReasoningLevel,
  extraInstructions: string[],
): string => {
  const jsonContract = extraInstructions.length > 0 ? `\n${extraInstructions.join("\n")}` : "";
  return [
    "你是三国杀游戏高手。",
    `你在本局中负责角色 ${agent.name}。`,
    `你的身份是${agent.role}，武将是${agent.general}。`,
    "你的目标是尽最大可能让自己的身份阵营获胜。",
    "你必须严格遵守规则并只从给定可选项中选择。",
    LEVEL_INSTRUCTION[level],
    "输出必须是JSON对象，禁止输出其他文本。",
    jsonContract,
    "",
    "三国杀游戏rules：",
    rulesText,
  ].join("\n");
};

export const buildAgentPrompt = (input: AgentPromptInput): AgentPromptPackage => {
  const level = input.reasoningLevel ?? "normal";
  const previousRoundsText = buildPreviousRoundsText(input.previousRoundContexts);
  const battlefieldText = input.snapshot.players.map((player) => toPlayerBattleLine(player, input.agent.playerId)).join("\n");
  const actionText = input.actions.map((action, index) => toActionLine(action, index)).join("\n");
  // 有木牛流马时可动作含存取/移动，提醒模型不要反复置入取出做无意义空转
  const oxGuidance = input.actions.some((action) => action.label.includes(CardType.WoodenOx))
    ? [
        "",
        "注意：木牛流马的「置入/取出/移动」动作仅在确有收益时使用（如寄存关键防御牌、交给队友）。反复置入再取出是无意义的空转，若没有其他有效动作请直接选择结束回合。",
      ]
    : [];
  const currentRoundStatus = buildCurrentRoundStatus(input.snapshot, input.agent);
  const systemPrompt = buildSystemPrompt(input.rulesText, input.agent, level, [
    '输出JSON格式：{"actionIndex":数字,"targetId":"可选"}，例如 {"actionIndex":1} 或 {"actionIndex":2,"targetId":"human"}。',
  ]);
  const userPrompt = [
    `游戏之前轮次上下文（保留最近 ${input.previousRoundContexts.length} 轮）：`,
    previousRoundsText,
    input.strategyNote ? buildStrategyNoteBlock(input.strategyNote) : "",
    "",
    "游戏本轮状态：",
    currentRoundStatus,
    "",
    "游戏当前战场状态：",
    battlefieldText,
    "",
    "本回合可选动作：",
    actionText,
    ...oxGuidance,
    "",
    '请严格输出JSON，例如 {"actionIndex":1} 或 {"actionIndex":2,"targetId":"human"}。',
  ].join("\n");
  return { systemPrompt, userPrompt };
};

const buildRequestDescription = (request: InteractionRequest): string => {
  // 必须同时给出 label 与 sourceId，否则模型无法输出校验通过的来源ID（尤其木牛流马的 choose-discard）
  const sourceText = (sources: Array<{ sourceId: string; label: string }>): string =>
    sources.length > 0 ? sources.map((item, index) => `${index + 1}. ${item.label}（来源ID:${item.sourceId}）`).join("\n") : "无";
  if (request.kind === "respond") {
    return [
      `你需要决定是否${request.reason}（响应类型：${request.responseKind}）。`,
      "可打出的牌：",
      sourceText(request.sources),
      "选择 pass 表示不应对。",
    ].join("\n");
  }
  if (request.kind === "collateral") {
    return [
      request.reason,
      "可选择的攻击目标（对目标使用杀）：",
      request.victims.length > 0 ? request.victims.map((id, index) => `${index + 1}. ${id}`).join("\n") : "无",
      request.sources.length > 0 ? `可用于响应的杀：\n${sourceText(request.sources)}` : "没有可用杀",
      request.allowHandOverWeapon ? "你也可以选择交出武器（输出 choice: pass）。" : "你不能交出武器。",
    ].join("\n");
  }
  if (request.kind === "choose-discard") {
    return [
      request.reason,
      `需弃置 ${request.count} 张牌，可弃置：`,
      sourceText(request.sources),
      request.allowPass ? "可选择 pass 放弃。" : "必须弃置。",
    ].join("\n");
  }
  if (request.kind === "optional-effect") {
    return [request.reason, '输出 {"choice":"effect","enabled":true} 发动，或 {"choice":"effect","enabled":false} 不发动。'].join("\n");
  }
  if (request.kind === "choose-suit") {
    return [request.reason, `可声明花色：${request.suits.join(",")}`].join("\n");
  }
  return "";
};

const buildInteractionJsonContract = (request: InteractionRequest): string => {
  if (request.kind === "respond") {
    return '输出JSON：{"choice":"card","sourceId":"<上面所列的来源ID>"} 或 {"choice":"pass"}。';
  }
  if (request.kind === "collateral") {
    return '输出JSON：{"choice":"target","targetId":"<上面所列的目标ID>","sourceId":"<上面所列的杀来源ID，可选>"} 或 {"choice":"pass"}。';
  }
  if (request.kind === "choose-discard") {
    return '输出JSON：{"choice":"card","sourceId":"<上面所列的来源ID>"} 或 {"choice":"pass"}。';
  }
  if (request.kind === "optional-effect") {
    return '输出JSON：{"choice":"effect","enabled":true} 或 {"choice":"effect","enabled":false}。';
  }
  if (request.kind === "choose-suit") {
    return '输出JSON：{"choice":"suit","suit":"<花色>"}。';
  }
  return '输出JSON对象。';
};

export const buildInteractionPrompt = (input: {
  rulesText: string;
  snapshot: GameSnapshot;
  agent: PromptAgentIdentity;
  request: InteractionRequest;
  previousRoundContexts: RoundPromptContext[];
  reasoningLevel?: ReasoningLevel;
  strategyNote?: string;
}): AgentPromptPackage => {
  const level = input.reasoningLevel ?? "normal";
  const previousRoundsText = buildPreviousRoundsText(input.previousRoundContexts);
  const battlefieldText = input.snapshot.players.map((player) => toPlayerBattleLine(player, input.agent.playerId)).join("\n");
  const systemPrompt = buildSystemPrompt(input.rulesText, input.agent, level, [buildInteractionJsonContract(input.request)]);
  const userPrompt = [
    `游戏之前轮次上下文（保留最近 ${input.previousRoundContexts.length} 轮）：`,
    previousRoundsText,
    input.strategyNote ? buildStrategyNoteBlock(input.strategyNote) : "",
    "",
    "游戏当前战场状态：",
    battlefieldText,
    "",
    "当前需要你决策的请求：",
    buildRequestDescription(input.request),
    "",
    buildInteractionJsonContract(input.request),
  ].join("\n");
  return { systemPrompt, userPrompt };
};

export const buildStrategyPrompt = (input: {
  rulesText: string;
  snapshot: GameSnapshot;
  agent: PromptAgentIdentity;
  previousRoundContexts: RoundPromptContext[];
  previousStrategyBlock?: string;
}): AgentPromptPackage => {
  const previousRoundsText = buildPreviousRoundsText(input.previousRoundContexts);
  const battlefieldText = input.snapshot.players.map((player) => toPlayerBattleLine(player, input.agent.playerId)).join("\n");
  const strategyBlock = input.previousStrategyBlock
    ? `\n你上次复盘形成的策略记忆：\n${input.previousStrategyBlock}\n`
    : "\n你还没有形成策略记忆（首次复盘）。\n";
  const systemPrompt = [
    "你是三国杀游戏高手。",
    `你在本局中负责角色 ${input.agent.name}，身份是${input.agent.role}，武将是${input.agent.general}。`,
    "你的目标是尽最大可能让自己的身份阵营获胜。",
    "现在请以真人复盘与筹划的口吻，深度推理当前局势，制定接下来几轮的打法思路。",
    "要求：先评估上次策略的执行情况与得失（若为首次复盘则写 无）；再提炼一句经验教训（可为空字符串）；再制定下一回合的战术笔记；最后给出对跨回合战略方针的增量更新（新推断或修正，若无更新写 不变）。",
    "输出必须是JSON对象，禁止输出其他文本，格式：",
    '{"execution":"上轮计划执行情况一句话评价（首次写 无）","lesson":"一句话教训（可为空字符串）","tactical":"下回合战术：首动倾向、保留关键牌、主要防范点，300字内","doctrineUpdate":"战略方针增量更新（身份推断/阵营目标/资源纪律），若无更新写 不变"}',
    "",
    "三国杀游戏rules：",
    input.rulesText,
  ].join("\n");
  const userPrompt = [
    `最近轮次上下文（保留最近 ${input.previousRoundContexts.length} 轮）：`,
    previousRoundsText,
    strategyBlock,
    "",
    "游戏当前战场状态：",
    battlefieldText,
    "",
    "请输出你的复盘JSON。",
  ].join("\n");
  return { systemPrompt, userPrompt };
};
