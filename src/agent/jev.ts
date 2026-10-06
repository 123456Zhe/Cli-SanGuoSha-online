import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Jev 判断模型 API 适配器 —— TypeSafe「System One」结构化决策接口。
 *
 * 注意：Jev 不是 chat 模型，不会生成文本，也不走 OpenAI /chat/completions。
 * 它接收一段 state 与一组带类型的 questions，并行返回结构化的 answers（选择题/概率/评分）。
 *   端点：POST {JEV_BASE_URL}/systemone
 *   请求：{ state, model, questions: { <id>: Question } }
 *   响应：{ model, answers: { <id>: Answer }, usage }
 *
 * 配置（.env 或进程环境）：
 *   JEV_BASE_URL        API 基址，默认 https://api.typesafe.ai/v1（端点自动拼 /systemone）
 *   JEV_MODEL           模型名，默认 jev-latest
 *   JEV_API_KEY         密钥；未设置时回退读取 TYPESAFE_API_KEY（官方 SDK 惯例）
 *   JEV_TIMEOUT_MS      单次请求超时，默认 15000
 *   JEV_ACCEPT_THRESHOLD noul 判断的接受阈值，默认 0.5（见 jev-advisor.ts）
 *   JEV_FAILURE_THRESHOLD 连续失败多少次后熔断跳过后台判断，默认 3（见 jev-advisor.ts）
 *   JEV_COOLDOWN_MS     熔断冷却时间，默认 60000（冷却后自动再试一次）
 * 只要 JEV_BASE_URL 或 JEV_MODEL 任一被显式设置，即视为已配置并启用 Jev 判断层。
 */

export type JevQuestion =
  | {
      type: "noul";
      instructions: string | Record<string, unknown> | Array<unknown>;
      criteria?: { true?: string | Record<string, unknown> | Array<unknown>; false?: string | Record<string, unknown> | Array<unknown> };
    }
  | {
      type: "choice";
      instructions: string | Record<string, unknown> | Array<unknown>;
      criteria: Record<string, string | Record<string, unknown> | Array<unknown> | null>;
    }
  | {
      type: "score";
      instructions: string | Record<string, unknown> | Array<unknown>;
      criteria: Array<string | Record<string, unknown> | Array<unknown>>;
    };

export type JevNoulAnswer = { type: "noul"; noul: number };
export type JevChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};
export type JevScoreAnswer = {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
};
export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

export type JevSystemOneResult = {
  model: string;
  answers: Record<string, JevAnswer>;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type JevOptions = {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
};

export type JevConfig = {
  configured: boolean;
  baseUrl: string;
  model: string;
  apiKey: string | null;
  timeoutMs: number;
};

type JevRawResponse = {
  model?: string;
  answers?: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

const DEFAULT_JEV_BASE_URL = "https://api.typesafe.ai/v1";
const DEFAULT_JEV_MODEL = "jev-latest";
const DEFAULT_JEV_TIMEOUT_MS = 15_000;

/** 单次 Jev 调用的总尝试次数（含首次）。 */
const MAX_JEV_ATTEMPTS = 3;

/** 带 HTTP 状态码的 Jev 调用错误，用于区分「可重试」与「确定性失败」。 */
export class JevHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "JevHttpError";
  }
}

/**
 * 是否值得重试：429/529（限流/过载）、5xx、以及网络层错误（超时/连接被重置/`fetch failed`）可重试；
 * 其余 4xx（401/403/400/404/422）是确定性失败——例如密钥错误或路由不存在，
 * 重试只会让**每一次**决策都白等 3 轮超时（联机实测：Jev 端点返回 401 时，每个决策都空转约 45 秒，
 * 表现为「Jev 卡住了」）。这类错误必须立刻上报，交给熔断器与上层回退。
 */
export const isRetryableJevError = (error: unknown): boolean => {
  if (error instanceof JevHttpError) {
    return error.status === 429 || error.status === 529 || error.status >= 500;
  }
  return true;
};

const loadDotEnv = (): void => {
  let content = "";
  try {
    content = readFileSync(resolve(process.cwd(), ".env"), "utf-8");
  } catch {
    return;
  }
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const sep = line.indexOf("=");
    if (sep <= 0) {
      continue;
    }
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim().replace(/^"(.*)"$/, "$1");
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = value;
  }
};

const normalizeBaseUrl = (input?: string): string => {
  const raw = (input ?? process.env.JEV_BASE_URL ?? DEFAULT_JEV_BASE_URL).trim().replace(/^"(.*)"$/, "$1");
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, "");
};

export const resolveJevConfig = (options: JevOptions = {}): JevConfig => {
  loadDotEnv();
  const hasEnvBase = Boolean(process.env.JEV_BASE_URL?.trim());
  const hasEnvModel = Boolean(process.env.JEV_MODEL?.trim());
  const timeoutRaw = options.timeoutMs ?? Number.parseInt(process.env.JEV_TIMEOUT_MS ?? "", 10);
  const apiKey = options.apiKey ?? process.env.JEV_API_KEY?.trim() ?? process.env.TYPESAFE_API_KEY?.trim() ?? null;
  return {
    configured: Boolean(options.baseUrl || options.model || hasEnvBase || hasEnvModel),
    baseUrl: normalizeBaseUrl(options.baseUrl),
    model: options.model ?? process.env.JEV_MODEL ?? DEFAULT_JEV_MODEL,
    apiKey: apiKey || null,
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULT_JEV_TIMEOUT_MS,
  };
};

/** 是否已配置 Jev 判断模型（决定 hybrid 用 API 判断还是本地启发式判断）。 */
export const isJevConfigured = (): boolean => resolveJevConfig().configured;

/** noul（是/否概率）判断的接受阈值，可用 JEV_ACCEPT_THRESHOLD 调整。 */
export const resolveJevAcceptThreshold = (): number => {
  loadDotEnv();
  const raw = Number.parseFloat(process.env.JEV_ACCEPT_THRESHOLD ?? "");
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.5;
};

const delay = async (ms: number): Promise<void> => {
  await new Promise<void>((resolveDelay) => {
    setTimeout(() => resolveDelay(), ms);
  });
};

const buildHeaders = (config: JevConfig): Record<string, string> => ({
  "Content-Type": "application/json",
  // 每次决策都用新连接：复用池里的空闲连接可能已被对端关闭，
  // 下一次 POST 复用它会立刻 RST（"fetch failed"），而 POST 不会被 undici 透明重试。
  Connection: "close",
  ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
});

/** 网络层失败（连接重置/旧复用连接失效等）：非 HTTP 错误、非超时取消，一律立刻换新连接重试。 */
const isNetworkError = (error: unknown): boolean =>
  !(error instanceof JevHttpError) && (error as { name?: string } | null)?.name !== "AbortError";

const describeJevError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const inner = error instanceof Error ? error.cause : null;
  const causeText = inner instanceof Error ? ` cause=${inner.message}` : "";
  return `${message}${causeText}`.replace(/\s+/g, " ").trim().slice(0, 300);
};

/**
 * 调用 System One 评估端点：一次请求携带多个问题，返回逐问题的结构化答案。
 * 429 / 529 / 5xx / 网络错误按指数退避重试；确定性 4xx 立即失败（见 `isRetryableJevError`）。
 */
export const callJevSystemOne = async (
  state: string | Record<string, unknown> | Array<unknown>,
  questions: Record<string, JevQuestion>,
  options: JevOptions = {},
): Promise<JevSystemOneResult> => {
  const config = resolveJevConfig(options);
  const url = `${config.baseUrl}/systemone`;
  let lastError: unknown = null;
  let retriedNetwork = false;
  for (let attempt = 0; attempt < MAX_JEV_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: buildHeaders(config),
        body: JSON.stringify({ state, model: config.model, questions }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new JevHttpError(
          response.status,
          `Jev 调用失败: ${response.status} ${detail}`.replace(/\s+/g, " ").trim(),
        );
      }
      const payload = (await response.json()) as JevRawResponse;
      if (!payload.answers) {
        throw new Error("Jev 返回缺少 answers 字段");
      }
      return {
        model: payload.model ?? config.model,
        answers: payload.answers,
        inputTokens: payload.usage?.input_tokens ?? null,
        outputTokens: payload.usage?.output_tokens ?? null,
      };
    } catch (error) {
      lastError = error;
      // 网络层失败不等退避：立刻换新连接重试一次（connection: close 保证是新连接）。
      // 超时取消不走这里，仍按原退避处理，避免给本就慢的服务端加压。
      if (isNetworkError(error) && !retriedNetwork) {
        retriedNetwork = true;
        continue;
      }
      if (attempt < MAX_JEV_ATTEMPTS - 1 && isRetryableJevError(error)) {
        await delay(400 * 2 ** attempt);
        continue;
      }
      // 确定性失败（如 401）立即上报：绝不为了「重试」把每一次决策都拖成几十秒
      break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Jev 连接失败: ${describeJevError(lastError)}`);
};

/** 连通性探测：GET {base}/models（官方接口，需鉴权）。 */
export const probeJevConnectivity = async (options: JevOptions = {}): Promise<{ available: boolean; detail: string }> => {
  const config = resolveJevConfig(options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 8_000));
  try {
    const response = await fetch(`${config.baseUrl}/models`, {
      method: "GET",
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      signal: controller.signal,
    });
    if (response.status === 200) {
      return { available: true, detail: `Jev 服务可用，模型 ${config.model}` };
    }
    if (response.status === 401 || response.status === 403) {
      return { available: false, detail: `Jev 鉴权失败(${response.status})，请检查 JEV_API_KEY / TYPESAFE_API_KEY` };
    }
    return { available: false, detail: `Jev 服务异常(${response.status})` };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { available: false, detail: reason.replace(/\s+/g, " ").trim() };
  } finally {
    clearTimeout(timer);
  }
};
