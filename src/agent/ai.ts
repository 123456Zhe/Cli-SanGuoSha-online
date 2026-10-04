import { callOllamaChatDetailed, listOllamaModels, OllamaCallResult, probeOllamaConnectivity } from "./ollama.js";
import {
  buildAgentPrompt,
  buildInteractionPrompt,
  buildPlanPrompt,
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
import { parseStrategyReview, StrategyMemory } from "./strategy-memory.js";
import { FastAdvisor } from "./system-one.js";
import { JevAdvisor } from "./jev-advisor.js";

export type AiModelProvider = "ollama" | "qwen";

export type AiDriverLabel = "Ollama" | "Qwen";

export type ReasoningMode = ReasoningLevel | "auto";

type AgentMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiDecision = {
  action: GameAction;
  targetId?: string;
  driverLabel: AiDriverLabel;
};

type SubAgent = {
  playerId: string;
  name: string;
  role: string;
  general: string;
  /** 分层策略记忆：战术笔记(L1) + 战略方针(L2) + 经验教训(L3) + 执行回看。 */
  memory: StrategyMemory;
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

/** 复盘时只回看最近 8 个轮次，避免把整段共享历史重复塞入复盘 prompt。 */
const STRATEGY_REVIEW_MAX_ROUNDS = 8;

const delay = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(() => resolve(), ms);
  });
};

/** 将子代理的分层策略记忆组装为 prompt 的 strategyNote 字段（空记忆不传）。 */
const strategyNoteFor = (agent: SubAgent): { strategyNote: string } | Record<string, never> => {
  const block = agent.memory.composePromptBlock();
  return block ? { strategyNote: block } : {};
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

  /**
   * Hybrid 快慢结合：出牌前先用快思考层（本地 System-One 或远端 Jev 判断模型）预打分。
   * 作用有二：1) prompt 里带上候选排名，LLM 只做"选择/否决"，输出更快更稳；
   * 2) LLM 返回后用 Judge 门控校验，分差过大说明 LLM 在乱来，直接否决用快的。
   *
   * 新版 hybrid（JevAdvisor）：LLM 只做总规划，局内出牌与响应全部由 Jev 快速决策，
   * 规划文本随每次 Jev 请求下发，Jev 在规划指导下做战术选择。
   */
  private fastAdvisor: FastAdvisor | null = null;

  /** 上一次 LLM 决策被 Judge 否决的原因（供 turn-decision 日志展示）。 */
  private lastJudgeVetoReason: string | null = null;

  /** Hybrid 总规划缓存：playerId -> { turn, plan }，每回合刷新一次。 */
  private planCache = new Map<string, { turn: number; plan: string }>();

  /** 是否为新版 hybrid（LLM 总规划 + Jev 局内快决策）。 */
  private isHybridJev(): boolean {
    return this.fastAdvisor instanceof JevAdvisor;
  }

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
    this.subAgents.set(playerId, { playerId, name, role, general, memory: new StrategyMemory() });
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
        memory: new StrategyMemory(),
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

  /** Hybrid 开关：传入实例即开启（LLM+快思考/Jev 判断层），传 null 关闭回到纯 LLM。 */
  setFastAdvisor(advisor: FastAdvisor | null): void {
    this.fastAdvisor = advisor;
  }

  getFastAdvisor(): FastAdvisor | null {
    return this.fastAdvisor;
  }

  /** 上一次 LLM 决策是否被 Judge 否决（turn-decision 用来打日志/选 driverLabel）。 */
  consumeJudgeVeto(): string | null {
    const reason = this.lastJudgeVetoReason;
    this.lastJudgeVetoReason = null;
    return reason;
  }

  setPreviousRoundContexts(contexts: RoundPromptContext[]): void {
    this.previousRoundContexts = contexts.slice(-this.maxContextRounds);
    this.fastAdvisor?.syncRounds(contexts);
  }

  getLastFailureReason(): string | null {
    return this.lastFailureReason;
  }

  /** 记录一次 LLM 决策失败（供 pickAiTurnDecision 捕获意外异常时回填原因，避免静默丢失）。 */
  noteFailure(error: unknown): void {
    this.lastFailureReason = error instanceof Error ? error.message : String(error);
  }

  getStrategyNote(playerId: string): string | undefined {
    const block = this.subAgents.get(playerId)?.memory.composePromptBlock();
    return block || undefined;
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

  /**
   * Hybrid 总规划：LLM 为玩家制定本回合战略规划（缓存到本回合结束）。
   * 规划失败时返回 null，上层用 Jev 无规划决策兜底。
   */
  private async getHybridPlan(snapshot: GameSnapshot, agent: SubAgent): Promise<string | null> {
    const cached = this.planCache.get(agent.playerId);
    if (cached && cached.turn === snapshot.turn) {
      return cached.plan;
    }
    const promptPackage = buildPlanPrompt({
      rulesText: this.rulesText,
      snapshot,
      agent: {
        playerId: agent.playerId,
        name: agent.name,
        role: agent.role,
        general: agent.general,
      },
      previousRoundContexts: this.previousRoundContexts,
      reasoningLevel: "fast",
      ...strategyNoteFor(agent),
    });
    const messages: AgentMessage[] = [
      { role: "system", content: promptPackage.systemPrompt },
      { role: "user", content: promptPackage.userPrompt },
    ];
    const callResult = await this.requestDecisionWithRetry(messages, "fast");
    if (!callResult) {
      return cached?.plan ?? null;
    }
    this.writeDecisionLog({
      callResult,
      stage: "hybrid-plan",
      playerId: agent.playerId,
      playerName: agent.name,
      prompt: messages,
      responseText: callResult.content,
    });
    const plan = callResult.content.trim().slice(0, 500);
    if (plan) {
      this.planCache.set(agent.playerId, { turn: snapshot.turn, plan });
      return plan;
    }
    return cached?.plan ?? null;
  }

  /**
   * 新版 hybrid 出牌：LLM 总规划 + Jev 局内快决策。
   * Jev 不可用时返回 null，由上层 pickAiTurnDecision 走本地回退。
   */
  private async decideHybridTurn(
    snapshot: GameSnapshot,
    playerId: string,
    agent: SubAgent,
    actions: GameAction[],
  ): Promise<AiDecision | null> {
    const advisor = this.fastAdvisor;
    if (!(advisor instanceof JevAdvisor)) {
      return null;
    }
    const plan = await this.getHybridPlan(snapshot, agent);
    const picked = await advisor.decideTurn(snapshot, playerId, actions, plan ?? undefined);
    if (!picked) {
      return null;
    }
    const decision: AiDecision = picked.targetId
      ? { action: picked.action, targetId: picked.targetId, driverLabel: this.getPreferredDriverLabel() }
      : { action: picked.action, driverLabel: this.getPreferredDriverLabel() };
    return decision;
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
    // 新版 hybrid：LLM 只做总规划，Jev 直接做局内出牌决策。
    if (this.isHybridJev()) {
      return await this.decideHybridTurn(snapshot, playerId, agent, actions);
    }
    const level = this.fastAdvisor ? "fast" : this.resolveLevel(snapshot, agent.playerId);
    await this.think(level);
    const fastRanked = (await this.fastAdvisor?.rankTurnActions(snapshot, playerId, actions)) ?? [];
    const fastBest = fastRanked[0];
    const hybridShortlist =
      fastRanked.length > 0
        ? {
            fastShortlist: fastRanked
              .slice(0, 5)
              .map((item, index) => `${index + 1}.${item.action.label}${item.targetId ? `->${item.targetId}` : ""} (${item.score.toFixed(1)})`)
              .join(" | "),
            ...(fastBest ? { fastBestScore: fastBest.score } : {}),
          }
        : {};
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
      ...strategyNoteFor(agent),
      ...hybridShortlist,
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
    // Hybrid Judge 门控：由快思考层（本地启发式或远端 Jev 判断模型）审核 LLM 决策，不通过则回退快的。
    if (this.fastAdvisor) {
      const judged = await this.fastAdvisor.judgeTurnDecision(snapshot, playerId, actions, {
        action: decisionResult.action,
        ...(decisionResult.targetId ? { targetId: decisionResult.targetId } : {}),
      });
      if (!judged.accepted) {
        const ranked0 = fastRanked[0];
        const fallback =
          judged.fallback ?? (ranked0 ? (ranked0.targetId ? { action: ranked0.action, targetId: ranked0.targetId } : { action: ranked0.action }) : null);
        this.lastJudgeVetoReason = `Judge否决(LLM ${judged.score.toFixed(2)} vs 最优 ${judged.bestScore.toFixed(2)})`;
        if (!fallback) {
          return null;
        }
        return { ...fallback, driverLabel: this.getPreferredDriverLabel() };
      }
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
    // 新版 hybrid：局内响应由 Jev 快速决策（带 LLM 总规划），不再走 LLM。
    if (this.isHybridJev()) {
      const advisor = this.fastAdvisor;
      if (!(advisor instanceof JevAdvisor)) {
        return null;
      }
      const plan = await this.getHybridPlan(snapshot, agent);
      const fast = await advisor.decideInteraction(snapshot, playerId, request, plan ?? undefined);
      return fast?.decision ?? null;
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
      ...strategyNoteFor(agent),
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
    // Hybrid Judge 门控：保命响应（桃/残血杀）必须出牌，LLM 选 pass 时由快思考层（本地或 Jev）否决。
    if (this.fastAdvisor && !(await this.fastAdvisor.judgeInteractionDecision(snapshot, playerId, request, decision))) {
      this.lastJudgeVetoReason = "Judge否决(交互与快思考不一致)";
      const fastFallback = await this.fastAdvisor.decideInteraction(snapshot, playerId, request);
      return fastFallback?.decision ?? decision;
    }
    return decision;
  }

  /**
   * 回合末策略复盘：单次 deep 调用输出结构化复盘（执行回看 + 教训 + 新战术 + 方针更新），
   * 解析后写入分层策略记忆（战术笔记/战略方针/经验教训）。
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
    // 只回看「自上次复盘以来」的轮次（首次复盘退化为最近 4 轮历史）
    const roundsSinceLast = this.previousRoundContexts.filter((item) => item.round > agent.memory.lastReviewRound);
    const reviewContexts =
      roundsSinceLast.length > 0 ? roundsSinceLast.slice(-STRATEGY_REVIEW_MAX_ROUNDS) : this.previousRoundContexts.slice(-4);
    const previousBlock = agent.memory.composePromptBlock();
    const promptPackage = buildStrategyPrompt({
      rulesText: this.rulesText,
      snapshot: state,
      agent: {
        playerId: agent.playerId,
        name: agent.name,
        role: agent.role,
        general: agent.general,
      },
      previousRoundContexts: reviewContexts,
      ...(previousBlock ? { previousStrategyBlock: previousBlock } : {}),
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
    const review = parseStrategyReview(callResult.content);
    if (!review) {
      this.lastFailureReason = `${this.getPreferredDriverLabel()} 策略复盘输出解析失败`;
      return false;
    }
    agent.memory.applyReviewResult(review, state.turn);
    return true;
  }
}
