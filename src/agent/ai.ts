import { callOllamaChatDetailed, listOllamaModels, OllamaCallResult, probeOllamaConnectivity } from "./ollama.js";
import { buildAgentPrompt, RoundPromptContext } from "./prompt.js";
import { callQwen35PlusDetailed, probeQwenConnectivity, QwenCallResult } from "./qwen.js";
import { GameAction, GameSnapshot, SanGuoGame } from "../engine/game.js";
import { writeAiLog } from "../devlog/ailog.js";

export type AiModelProvider = "ollama" | "qwen";

export type AiDriverLabel = "Ollama" | "Qwen";

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

const normalizeJson = (text: string): string => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  return text.trim();
};

const parseModelDecision = (text: string): ModelDecision | null => {
  const payload = normalizeJson(text);
  try {
    const parsed = JSON.parse(payload) as ModelDecision;
    return parsed;
  } catch {
    const objectMatch = payload.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
      return null;
    }
    try {
      return JSON.parse(objectMatch[0]) as ModelDecision;
    } catch {
      return null;
    }
  }
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
    this.previousRoundContexts = contexts.slice(-3);
  }

  getLastFailureReason(): string | null {
    return this.lastFailureReason;
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

  private mapProviderResult(result: QwenCallResult | OllamaCallResult): DecisionCallResult {
    return {
      content: result.content,
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
    };
  }

  private async requestDecision(messages: AgentMessage[]): Promise<DecisionCallResult> {
    if (this.preferredProvider === "ollama") {
      const options = this.preferredOllamaModel
        ? { model: this.preferredOllamaModel, temperature: 0, timeoutMs: 120_000 }
        : { temperature: 0, timeoutMs: 120_000 };
      const result = await callOllamaChatDetailed(messages, options);
      return this.mapProviderResult(result);
    }
    const result = await callQwen35PlusDetailed(messages, { temperature: 0, timeoutMs: 45_000 });
    return this.mapProviderResult(result);
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
    if (!current || !current.alive || !current.isAI || snapshot.currentPlayerId !== playerId) {
      return null;
    }
    const actions = game.getPlayableActions(playerId);
    if (actions.length <= 0) {
      return null;
    }
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
    });
    const messages: AgentMessage[] = [
      { role: "system", content: promptPackage.systemPrompt },
      { role: "user", content: promptPackage.userPrompt },
    ];
    let callResult: DecisionCallResult | null = null;
    let raw = "";
    const driverLabel = this.getPreferredDriverLabel();
    try {
      callResult = await this.requestDecision(messages);
      raw = callResult.content;
      this.providerStatus[this.preferredProvider] = "ready";
      this.failedAttempts = 0;
      this.lastFailureReason = null;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const connectivity =
        this.preferredProvider === "ollama"
          ? await probeOllamaConnectivity(undefined, this.preferredOllamaModel ?? undefined)
          : await probeQwenConnectivity();
      if (connectivity.available) {
        try {
          callResult = await this.requestDecision(messages);
          raw = callResult.content;
          this.providerStatus[this.preferredProvider] = "ready";
          this.failedAttempts = 0;
          this.lastFailureReason = null;
        } catch (retryError) {
          this.providerStatus[this.preferredProvider] = "failed";
          this.failedAttempts += 1;
          const retryReason = retryError instanceof Error ? retryError.message : String(retryError);
          this.lastFailureReason = `${driverLabel} 决策请求失败：${retryReason}`;
          if (this.failedAttempts >= 3) {
            return null;
          }
          return null;
        }
      } else {
        this.providerStatus[this.preferredProvider] = "failed";
        this.failedAttempts += 1;
        this.lastFailureReason = `${driverLabel} 决策请求失败：${reason}`;
        if (this.failedAttempts >= 3) {
          return null;
        }
        return null;
      }
    }
    const model = callResult?.model ?? this.getPreferredDriverLabel();
    writeAiLog({
      provider: this.preferredProvider,
      model,
      stage: "decision",
      playerId: current.id,
      playerName: current.name,
      prompt: messages,
      responseText: raw,
      promptTokens: callResult?.promptTokens ?? null,
      completionTokens: callResult?.completionTokens ?? null,
      totalTokens: callResult?.totalTokens ?? null,
    });
    let decisionResult = this.parseDecision(raw, actions);
    if (!decisionResult.ok) {
      const repairPrompt =
        `你上一条回答无法被程序解析，原因：${decisionResult.reason}。\n` +
        `请基于同一局面重新只输出 JSON，禁止解释。\n` +
        `允许格式：{"actionIndex":1} 或 {"actionIndex":2,"targetId":"human"}。`;
      try {
        const repairMessages: AgentMessage[] = [
          ...messages,
          { role: "assistant", content: raw },
          { role: "user", content: repairPrompt },
        ];
        const repairResult = await this.requestDecision(repairMessages);
        raw = repairResult.content;
        writeAiLog({
          provider: this.preferredProvider,
          model: repairResult.model,
          stage: "decision-repair",
          playerId: current.id,
          playerName: current.name,
          prompt: repairMessages,
          responseText: raw,
          promptTokens: repairResult.promptTokens ?? null,
          completionTokens: repairResult.completionTokens ?? null,
          totalTokens: repairResult.totalTokens ?? null,
        });
        decisionResult = this.parseDecision(raw, actions);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.lastFailureReason = `${driverLabel} 决策修正请求失败：${reason}`;
        return null;
      }
    }
    if (!decisionResult.ok) {
      this.lastFailureReason = decisionResult.reason;
      return null;
    }
    const decision: AiDecision = decisionResult.targetId
      ? { action: decisionResult.action, targetId: decisionResult.targetId, driverLabel }
      : { action: decisionResult.action, driverLabel };
    return decision;
  }
}
