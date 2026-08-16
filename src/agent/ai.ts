import { callOllamaChatDetailed, listOllamaModels, OllamaCallResult, probeOllamaConnectivity } from "./ollama.js";
import {
  buildAgentPrompt,
  buildInteractionPrompt,
  buildStrategyPrompt,
  pickReasoningLevel,
  REASONING_EFFORT,
  REASONING_THINKING_MULTIPLIER,
  ReasoningLevel,
  RoundPromptContext,
} from "./prompt.js";
import { callQwen35PlusDetailed, probeQwenConnectivity, QwenCallResult } from "./qwen.js";
import { GameAction, GameSnapshot, SanGuoGame } from "../engine/game.js";
import { CardSuit, InteractionDecision, InteractionRequest } from "../engine/interaction.js";
import { writeAiLog } from "../devlog/ailog.js";

export type AiModelProvider = "ollama" | "qwen";

export type AiDriverLabel = "Ollama" | "Qwen";

export type ReasoningMode = ReasoningLevel | "auto";

type AgentMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type AiDecision = {
  action: GameAction;
  targetId?: string;
  driverLabel: AiDriverLabel;
};

type SubAgent = {
  playerId: string;
  name: string;
  role: string;
  general: string;
  strategyNote?: string;
};

type ModelDecision = {
  actionIndex?: number | string;
  targetId?: string;
};

type DecisionCallResult = {
  content: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

type DecisionParseResult =
  | {
      ok: true;
      action: GameAction;
      targetId?: string;
    }
  | {
      ok: false;
      reason: string;
    };

const DEFAULT_MAX_CONTEXT_ROUNDS = 30;

const DEFAULT_THINKING_MS = 1200;

const STRATEGY_NOTE_MAX_LENGTH = 600;

const delay = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(() => resolve(), ms);
  });
};

const normalizeJson = (text: string): string => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  return text.trim();
};

const parseJsonObject = (text: string): Record<string, unknown> | null => {
  const payload = normalizeJson(text);
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    const objectMatch = payload.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
      return null;
    }
    try {
      const parsed = JSON.parse(objectMatch[0]) as Record<string, unknown>;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
};

const parseModelDecision = (text: string): ModelDecision | null => {
  const parsed = parseJsonObject(text);
  if (!parsed) {
    return null;
  }
  const actionIndex = parsed.actionIndex;
  const targetId = typeof parsed.targetId === "string" ? parsed.targetId : undefined;
  if (typeof actionIndex === "number" || (typeof actionIndex === "string" && /^\d+$/.test(actionIndex.trim()))) {
    return targetId ? { actionIndex, targetId } : { actionIndex };
  }
  return null;
};

const normalizeActionIndex = (value: number | string | undefined): number | null => {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return null;
};

export class GameAiLoop {
  private readonly rulesText: string;

  private started: boolean;

  private preferredProvider: AiModelProvider;

  private providerStatus: Record<AiModelProvider, "unknown" | "ready" | "failed">;

  private failedAttempts: number;

  private subAgents: Map<string, SubAgent>;

  private lastFailureReason: string | null;

  private preferredOllamaModel: string | null;

  private previousRoundContexts: RoundPromptContext[];

  private maxContextRounds: number;

  private thinkingMs: number;

  private reasoningMode: ReasoningMode;

  /** 联机断线托管：允许驱动 isAI=false 的人类座位（玩家掉线后由 AI 代打）。 */
  private allowNonAiSeats = false;

  constructor(rulesText: string, preferredProvider: AiModelProvider = "qwen") {
    this.rulesText = rulesText;
    this.started = false;
    this.preferredProvider = preferredProvider;
    this.providerStatus = {
      qwen: "unknown",
      ollama: "unknown",
    };
    this.failedAttempts = 0;
    this.subAgents = new Map();
    this.lastFailureReason = null;
    this.preferredOllamaModel = null;
    this.previousRoundContexts = [];
    this.maxContextRounds = DEFAULT_MAX_CONTEXT_ROUNDS;
    this.thinkingMs = DEFAULT_THINKING_MS;
    this.reasoningMode = "auto";
  }

  setPreferredProvider(provider: AiModelProvider): void {
    this.preferredProvider = provider;
    this.failedAttempts = 0;
    this.lastFailureReason = null;
  }

  setPreferredOllamaModel(model: string | null): void {
    const normalized = model?.trim() ?? "";
    this.preferredOllamaModel = normalized.length > 0 ? normalized : null;
    this.failedAttempts = 0;
    this.lastFailureReason = null;
  }

  getPreferredOllamaModel(): string | null {
    return this.preferredOllamaModel;
  }

  getAvailableOllamaModels(): Promise<string[]> {
    return listOllamaModels();
  }

  getPreferredProvider(): AiModelProvider {
    return this.preferredProvider;
  }

  getPreferredDriverLabel(): AiDriverLabel {
    return this.preferredProvider === "ollama" ? "Ollama" : "Qwen";
  }

  setMaxContextRounds(rounds: number): void {
    if (Number.isInteger(rounds) && rounds > 0) {
      this.maxContextRounds = rounds;
    }
  }

  getMaxContextRounds(): number {
    return this.maxContextRounds;
  }

  setThinkingMs(ms: number): void {
    if (Number.isFinite(ms) && ms >= 0) {
      this.thinkingMs = ms;
    }
  }

  setReasoningMode(mode: ReasoningMode): void {
    this.reasoningMode = mode;
  }

  getReasoningMode(): ReasoningMode {
    return this.reasoningMode;
  }

  /** 联机断线托管用：允许对 isAI=false 的人类座位做出牌/交互决策。 */
  setAllowNonAiSeats(enabled: boolean): void {
    this.allowNonAiSeats = enabled;
  }

  /** 为断线托管的人类座位注册子代理，使 decide/decideInteraction 可为其工作。 */
  registerSeatForTakeover(playerId: string, name: string, role: string, general: string): void {
    this.subAgents.set(playerId, { playerId, name, role, general });
  }

  start(snapshot: GameSnapshot): number {
    this.subAgents.clear();
    this.previousRoundContexts = [];
    this.providerStatus.qwen = "unknown";
    this.providerStatus.ollama = "unknown";
    this.failedAttempts = 0;
    this.lastFailureReason = null;
    for (const player of snapshot.players) {
      if (!player.isAI) {
        continue;
      }
      this.subAgents.set(player.id, {
        playerId: player.id,
        name: player.name,
        role: player.role,
        general: player.general,
      });
    }
    this.previousRoundContexts = [];
    this.started = true;
    return this.subAgents.size;
  }

  stop(): void {
    this.started = false;
    this.providerStatus.qwen = "unknown";
    this.providerStatus.ollama = "unknown";
    this.failedAttempts = 0;
    this.subAgents.clear();
    this.previousRoundContexts = [];
    this.lastFailureReason = null;
  }

  setPreviousRoundContexts(contexts: RoundPromptContext[]): void {
    this.previousRoundContexts = contexts.slice(-this.maxContextRounds);
  }

  getLastFailureReason(): string | null {
    return this.lastFailureReason;
  }

  getStrategyNote(playerId: string): string | undefined {
    return this.subAgents.get(playerId)?.strategyNote;
  }

  async probe(): Promise<{ available: boolean; detail: string; driverLabel: AiDriverLabel }> {
    const driverLabel = this.getPreferredDriverLabel();
    if (this.preferredProvider === "ollama") {
      try {
        const options = this.preferredOllamaModel
          ? { model: this.preferredOllamaModel, temperature: 0 }
          : { temperature: 0 };
        const result = await callOllamaChatDetailed([{ role: "user", content: "who are you" }], options);
        writeAiLog({
          provider: "ollama",
          model: result.model,
          stage: "probe",
          playerId: "system",
          playerName: "system",
          prompt: [{ role: "user", content: "who are you" }],
          responseText: result.content,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          totalTokens: result.totalTokens,
        });
        this.providerStatus.ollama = "ready";
        this.failedAttempts = 0;
        this.lastFailureReason = null;
        const brief = result.content.replace(/\s+/g, " ").trim().slice(0, 80);
        return { available: true, detail: brief, driverLabel };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const connectivity = await probeOllamaConnectivity(undefined, this.preferredOllamaModel ?? undefined);
        this.providerStatus.ollama = "failed";
        this.failedAttempts += 1;
        this.lastFailureReason = `Ollama 不可用(${connectivity.detail || reason})`;
        return { available: false, detail: connectivity.detail || reason, driverLabel };
      }
    }
    try {
      const result = await callQwen35PlusDetailed([{ role: "user", content: "who are you" }], { temperature: 0 });
      writeAiLog({
        provider: "qwen",
        model: result.model,
        stage: "probe",
        playerId: "system",
        playerName: "system",
        prompt: [{ role: "user", content: "who are you" }],
        responseText: result.content,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
      });
      this.providerStatus.qwen = "ready";
      this.failedAttempts = 0;
      this.lastFailureReason = null;
      const brief = result.content.replace(/\s+/g, " ").trim().slice(0, 80);
      return { available: true, detail: brief, driverLabel };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const connectivity = await probeQwenConnectivity();
      if (connectivity.available) {
        this.providerStatus.qwen = "unknown";
        this.lastFailureReason = null;
        return { available: true, detail: `连通性已确认，运行中继续尝试(${connectivity.detail})`, driverLabel };
      }
      this.providerStatus.qwen = "failed";
      this.failedAttempts += 1;
      this.lastFailureReason = `网络不可达(${connectivity.detail || reason})`;
      return { available: false, detail: `网络不可达(${connectivity.detail || reason})`, driverLabel };
    }
  }

  private resolveLevel(snapshot: GameSnapshot, viewerId?: string): ReasoningLevel {
    return this.reasoningMode === "auto" ? pickReasoningLevel(snapshot, viewerId) : this.reasoningMode;
  }

  private async think(level: ReasoningLevel): Promise<void> {
    const ms = Math.round(this.thinkingMs * REASONING_THINKING_MULTIPLIER[level]);
    if (ms > 0) {
      await delay(ms);
    }
  }

  private parseDecision(text: string, actions: GameAction[]): DecisionParseResult {
    const parsed = parseModelDecision(text);
    const actionIndex = normalizeActionIndex(parsed?.actionIndex);
    if (!actionIndex) {
      return { ok: false, reason: "模型未返回可解析的 actionIndex" };
    }
    const action = actions[actionIndex - 1];
    if (!action) {
      return { ok: false, reason: `actionIndex 超出范围(${actionIndex})` };
    }
    if (action.type === "end" || !action.requiresTarget) {
      return { ok: true, action };
    }
    const preferredTargetId = action.targets.includes(parsed?.targetId ?? "") ? parsed?.targetId : action.targets[0];
    if (!preferredTargetId) {
      return { ok: false, reason: `动作 ${action.label} 缺少有效 targetId` };
    }
    return { ok: true, action, targetId: preferredTargetId };
  }

  private parseInteractionDecision(text: string, request: InteractionRequest): InteractionDecision | null {
    const parsed = parseJsonObject(text);
    if (!parsed) {
      return null;
    }
    const choice = parsed.choice;
    if (request.kind === "respond" || request.kind === "choose-discard") {
      if (choice === "pass") {
        return { choice: "pass" };
      }
      if (choice === "card") {
        const sourceId = typeof parsed.sourceId === "string" ? parsed.sourceId : "";
        if (!request.sources.some((source) => source.sourceId === sourceId)) {
          return null;
        }
        return { choice: "card", sourceId };
      }
      return null;
    }
    if (request.kind === "collateral") {
      if (choice === "pass") {
        return { choice: "pass" };
      }
      if (choice === "target") {
        const targetId = typeof parsed.targetId === "string" ? parsed.targetId : "";
        if (!request.victims.includes(targetId)) {
          return null;
        }
        const sourceId = typeof parsed.sourceId === "string" ? parsed.sourceId : undefined;
        if (sourceId && !request.sources.some((source) => source.sourceId === sourceId)) {
          return { choice: "target", targetId };
        }
        return sourceId ? { choice: "target", targetId, sourceId } : { choice: "target", targetId };
      }
      return null;
    }
    if (request.kind === "optional-effect") {
      if (choice === "effect") {
        return { choice: "effect", enabled: Boolean(parsed.enabled) };
      }
      return null;
    }
    if (request.kind === "choose-suit") {
      if (choice === "suit") {
        const suit = typeof parsed.suit === "string" ? parsed.suit : "";
        if (!request.suits.includes(suit as CardSuit)) {
          return null;
        }
        return { choice: "suit", suit: suit as CardSuit };
      }
      return null;
    }
    return null;
  }

  private mapProviderResult(result: QwenCallResult | OllamaCallResult): DecisionCallResult {
    return {
      content: result.content,
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
    };
  }

  private async requestDecision(messages: AgentMessage[], level: ReasoningLevel): Promise<DecisionCallResult> {
    if (this.preferredProvider === "ollama") {
      const options = this.preferredOllamaModel
        ? { model: this.preferredOllamaModel, temperature: 0, timeoutMs: 120_000 }
        : { temperature: 0, timeoutMs: 120_000 };
      const result = await callOllamaChatDetailed(messages, options);
      return this.mapProviderResult(result);
    }
    const result = await callQwen35PlusDetailed(messages, {
      temperature: 0,
      timeoutMs: 45_000,
      reasoningEffort: REASONING_EFFORT[level],
    });
    return this.mapProviderResult(result);
  }

  private async requestDecisionWithRetry(messages: AgentMessage[], level: ReasoningLevel): Promise<DecisionCallResult | null> {
    const driverLabel = this.getPreferredDriverLabel();
    try {
      const result = await this.requestDecision(messages, level);
      this.providerStatus[this.preferredProvider] = "ready";
      this.failedAttempts = 0;
      this.lastFailureReason = null;
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const connectivity =
        this.preferredProvider === "ollama"
          ? await probeOllamaConnectivity(undefined, this.preferredOllamaModel ?? undefined)
          : await probeQwenConnectivity();
      if (connectivity.available) {
        try {
          const result = await this.requestDecision(messages, level);
          this.providerStatus[this.preferredProvider] = "ready";
          this.failedAttempts = 0;
          this.lastFailureReason = null;
          return result;
        } catch (retryError) {
          this.providerStatus[this.preferredProvider] = "failed";
          this.failedAttempts += 1;
          const retryReason = retryError instanceof Error ? retryError.message : String(retryError);
          this.lastFailureReason = `${driverLabel} 决策请求失败：${retryReason}`;
          return null;
        }
      }
      this.providerStatus[this.preferredProvider] = "failed";
      this.failedAttempts += 1;
      this.lastFailureReason = `${driverLabel} 决策请求失败：${reason}`;
      return null;
    }
  }

  private writeDecisionLog(params: {
    callResult: DecisionCallResult;
    stage: string;
    playerId: string;
    playerName: string;
    prompt: AgentMessage[];
    responseText: string;
  }): void {
    writeAiLog({
      provider: this.preferredProvider,
      model: params.callResult.model ?? this.getPreferredDriverLabel(),
      stage: params.stage,
      playerId: params.playerId,
      playerName: params.playerName,
      prompt: params.prompt,
      responseText: params.responseText,
      promptTokens: params.callResult.promptTokens ?? null,
      completionTokens: params.callResult.completionTokens ?? null,
      totalTokens: params.callResult.totalTokens ?? null,
    });
  }

  private buildRepairPrompt(kind: string): string {
    return `你上一条回答无法被程序解析（${kind}）。请基于同一局面重新只输出符合要求的 JSON，禁止解释。`;
  }

  async decide(game: SanGuoGame, playerId: string): Promise<AiDecision | null> {
    if (!this.started) {
      return null;
    }
    const agent = this.subAgents.get(playerId);
    if (!agent) {
      return null;
    }
    const snapshot = game.getSnapshot();
    const current = snapshot.players.find((item) => item.id === playerId);
    if (!current || !current.alive || (!current.isAI && !this.allowNonAiSeats) || snapshot.currentPlayerId !== playerId) {
      return null;
    }
    const actions = game.getPlayableActions(playerId);
    if (actions.length <= 0) {
      return null;
    }
    const level = this.resolveLevel(snapshot, agent.playerId);
    await this.think(level);
    const promptPackage = buildAgentPrompt({
      rulesText: this.rulesText,
      snapshot,
      agent: {
        playerId: agent.playerId,
        name: agent.name,
        role: agent.role,
        general: agent.general,
      },
      actions,
      previousRoundContexts: this.previousRoundContexts,
      reasoningLevel: level,
      ...(agent.strategyNote ? { strategyNote: agent.strategyNote } : {}),
    });
    const messages: AgentMessage[] = [
      { role: "system", content: promptPackage.systemPrompt },
      { role: "user", content: promptPackage.userPrompt },
    ];
    const callResult = await this.requestDecisionWithRetry(messages, level);
    if (!callResult) {
      return null;
    }
    this.writeDecisionLog({
      callResult,
      stage: "decision",
      playerId: current.id,
      playerName: current.name,
      prompt: messages,
      responseText: callResult.content,
    });
    let decisionResult = this.parseDecision(callResult.content, actions);
    if (!decisionResult.ok) {
      const repairPrompt = this.buildRepairPrompt(decisionResult.reason);
      try {
        const repairMessages: AgentMessage[] = [
          ...messages,
          { role: "assistant", content: callResult.content },
          { role: "user", content: repairPrompt },
        ];
        const repairResult = await this.requestDecision(repairMessages, level);
        this.writeDecisionLog({
          callResult: repairResult,
          stage: "decision-repair",
          playerId: current.id,
          playerName: current.name,
          prompt: repairMessages,
          responseText: repairResult.content,
        });
        decisionResult = this.parseDecision(repairResult.content, actions);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.lastFailureReason = `${this.getPreferredDriverLabel()} 决策修正请求失败：${reason}`;
        return null;
      }
    }
    if (!decisionResult.ok) {
      this.lastFailureReason = decisionResult.reason;
      return null;
    }
    const decision: AiDecision = decisionResult.targetId
      ? { action: decisionResult.action, targetId: decisionResult.targetId, driverLabel: this.getPreferredDriverLabel() }
      : { action: decisionResult.action, driverLabel: this.getPreferredDriverLabel() };
    return decision;
  }

  async decideInteraction(game: SanGuoGame, playerId: string, request: InteractionRequest): Promise<InteractionDecision | null> {
    if (!this.started) {
      return null;
    }
    const agent = this.subAgents.get(playerId);
    if (!agent) {
      return null;
    }
    const snapshot = game.getSnapshot();
    const current = snapshot.players.find((item) => item.id === playerId);
    if (!current || !current.alive) {
      return null;
    }
    const level = this.resolveLevel(snapshot, agent.playerId);
    await this.think(level);
    const promptPackage = buildInteractionPrompt({
      rulesText: this.rulesText,
      snapshot,
      agent: {
        playerId: agent.playerId,
        name: agent.name,
        role: agent.role,
        general: agent.general,
      },
      request,
      previousRoundContexts: this.previousRoundContexts,
      reasoningLevel: level,
      ...(agent.strategyNote ? { strategyNote: agent.strategyNote } : {}),
    });
    const messages: AgentMessage[] = [
      { role: "system", content: promptPackage.systemPrompt },
      { role: "user", content: promptPackage.userPrompt },
    ];
    const callResult = await this.requestDecisionWithRetry(messages, level);
    if (!callResult) {
      return null;
    }
    this.writeDecisionLog({
      callResult,
      stage: "interaction",
      playerId: current.id,
      playerName: current.name,
      prompt: messages,
      responseText: callResult.content,
    });
    let decision = this.parseInteractionDecision(callResult.content, request);
    if (!decision) {
      try {
        const repairMessages: AgentMessage[] = [
          ...messages,
          { role: "assistant", content: callResult.content },
          { role: "user", content: this.buildRepairPrompt("交互决策") },
        ];
        const repairResult = await this.requestDecision(repairMessages, level);
        this.writeDecisionLog({
          callResult: repairResult,
          stage: "interaction-repair",
          playerId: current.id,
          playerName: current.name,
          prompt: repairMessages,
          responseText: repairResult.content,
        });
        decision = this.parseInteractionDecision(repairResult.content, request);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.lastFailureReason = `${this.getPreferredDriverLabel()} 交互决策修正请求失败：${reason}`;
        return null;
      }
    }
    if (!decision) {
      this.lastFailureReason = "交互决策解析失败";
      return null;
    }
    return decision;
  }

  /**
   * 回合末策略博弈：输出一段真人式自由文字策略笔记并存储。
   * 可在后台并行执行（传入调用时捕获的快照，避免与后续回合状态漂移）。
   */
  async reviewStrategy(game: SanGuoGame, playerId: string, snapshot?: GameSnapshot): Promise<boolean> {
    if (!this.started) {
      return false;
    }
    const agent = this.subAgents.get(playerId);
    if (!agent) {
      return false;
    }
    const state = snapshot ?? game.getSnapshot();
    const current = state.players.find((item) => item.id === playerId);
    if (!current || !current.alive) {
      return false;
    }
    const level: ReasoningLevel = "deep";
    await this.think(level);
    const promptPackage = buildStrategyPrompt({
      rulesText: this.rulesText,
      snapshot: state,
      agent: {
        playerId: agent.playerId,
        name: agent.name,
        role: agent.role,
        general: agent.general,
      },
      previousRoundContexts: this.previousRoundContexts,
    });
    const messages: AgentMessage[] = [
      { role: "system", content: promptPackage.systemPrompt },
      { role: "user", content: promptPackage.userPrompt },
    ];
    const callResult = await this.requestDecisionWithRetry(messages, level);
    if (!callResult) {
      return false;
    }
    this.writeDecisionLog({
      callResult,
      stage: "strategy",
      playerId: current.id,
      playerName: current.name,
      prompt: messages,
      responseText: callResult.content,
    });
    const note = callResult.content.trim();
    if (!note) {
      return false;
    }
    agent.strategyNote = note.slice(0, STRATEGY_NOTE_MAX_LENGTH);
    return true;
  }
}
