import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

type QwenRole = "system" | "user" | "assistant";

export type QwenMessage = {
  role: QwenRole;
  content: string;
};

type QwenResponse = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type QwenChatOptions = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  temperature?: number;
};

export type QwenCallResult = {
  content: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

const DEFAULT_QWEN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const execFileAsync = promisify(execFile);
const isBunRuntime = Boolean(process.versions.bun);

const loadDotEnv = (): void => {
  const envFile = resolve(process.cwd(), ".env");
  let content = "";
  try {
    content = readFileSync(envFile, "utf-8");
  } catch {
    return;
  }
  const lines = content.split(/\r?\n/);
  for (const raw of lines) {
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

const getApiKey = (provided?: string): string => {
  if (provided) {
    return provided;
  }
  loadDotEnv();
  const envKey = process.env.QWEN_API_KEY;
  if (!envKey) {
    throw new Error("未配置 QWEN_API_KEY，请在 .env 中设置");
  }
  return envKey;
};

const normalizeBaseUrl = (input?: string): string => {
  const raw = (input ?? process.env.QWEN_BASE_URL ?? DEFAULT_QWEN_BASE_URL).trim().replace(/^"(.*)"$/, "$1");
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, "");
};

const delay = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(() => resolve(), ms);
  });
};

const runNodeFetch = async <T>(script: string, payload: T, timeoutMs: number): Promise<string> => {
  const { stdout } = await execFileAsync(
    "node",
    ["-e", script],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        QWEN_NODE_PAYLOAD: JSON.stringify(payload),
      },
      timeout: timeoutMs + 1_000,
      maxBuffer: 1024 * 1024,
    },
  );
  return stdout.trim();
};

const callQwenThroughNode = async (
  url: string,
  apiKey: string,
  model: string,
  messages: QwenMessage[],
  temperature: number | undefined,
  timeoutMs: number,
): Promise<QwenCallResult> => {
  const script = `
const payload = JSON.parse(process.env.QWEN_NODE_PAYLOAD || "{}");
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), payload.timeoutMs);
fetch(payload.url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer " + payload.apiKey,
  },
  body: JSON.stringify({
    model: payload.model,
    messages: payload.messages,
    temperature: payload.temperature,
  }),
  signal: controller.signal,
}).then(async (response) => {
  const body = await response.text();
  process.stdout.write(JSON.stringify({ ok: response.ok, status: response.status, body }));
}).catch((error) => {
  process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
}).finally(() => clearTimeout(timer));
`.trim();
  const raw = await runNodeFetch(
    script,
    {
      url,
      apiKey,
      model,
      messages,
      temperature,
      timeoutMs,
    },
    timeoutMs,
  );
  const parsed = JSON.parse(raw) as { ok: boolean; status?: number; body?: string; error?: string };
  if (!parsed.ok) {
    throw new Error(parsed.error || `Qwen 调用失败: ${parsed.status ?? "unknown"}`);
  }
  const payload = JSON.parse(parsed.body || "{}") as QwenResponse;
  const text = payload.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("Qwen 返回内容为空");
  }
  return {
    content: text,
    model: payload.model ?? model,
    promptTokens: payload.usage?.prompt_tokens ?? null,
    completionTokens: payload.usage?.completion_tokens ?? null,
    totalTokens: payload.usage?.total_tokens ?? null,
  };
};

const probeConnectivityThroughNode = async (url: string, timeoutMs: number): Promise<{ available: boolean; detail: string }> => {
  const script = `
const payload = JSON.parse(process.env.QWEN_NODE_PAYLOAD || "{}");
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), payload.timeoutMs);
fetch(payload.url, {
  method: "GET",
  signal: controller.signal,
}).then((response) => {
  process.stdout.write(JSON.stringify({ ok: true, status: response.status }));
}).catch((error) => {
  process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
}).finally(() => clearTimeout(timer));
`.trim();
  const raw = await runNodeFetch(script, { url, timeoutMs }, timeoutMs);
  const parsed = JSON.parse(raw) as { ok: boolean; status?: number; error?: string };
  if (!parsed.ok) {
    return { available: false, detail: parsed.error || "node 探测失败" };
  }
  if (parsed.status === 200 || parsed.status === 401 || parsed.status === 403) {
    return { available: true, detail: `连通性正常(${parsed.status})` };
  }
  return { available: false, detail: `连通性异常(${parsed.status ?? "unknown"})` };
};

export const probeQwenConnectivity = async (baseUrl?: string): Promise<{ available: boolean; detail: string }> => {
  const url = `${normalizeBaseUrl(baseUrl)}/models`;
  if (isBunRuntime) {
    return probeConnectivityThroughNode(url, 8_000);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    if (response.status === 200 || response.status === 401 || response.status === 403) {
      return { available: true, detail: `连通性正常(${response.status})` };
    }
    return { available: false, detail: `连通性异常(${response.status})` };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { available: false, detail: reason };
  } finally {
    clearTimeout(timer);
  }
};

export const callQwen35PlusDetailed = async (
  messages: QwenMessage[],
  options: QwenChatOptions = {},
): Promise<QwenCallResult> => {
  if (messages.length === 0) {
    throw new Error("messages 不能为空");
  }
  const apiKey = getApiKey(options.apiKey);
  const model = options.model ?? process.env.QWEN_MODEL ?? "qwen-plus";
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const url = `${baseUrl}/chat/completions`;
  if (isBunRuntime) {
    return callQwenThroughNode(url, apiKey, model, messages, options.temperature, timeoutMs);
  }
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text();
        if (response.status >= 500 && attempt < 2) {
          await delay(250 * (attempt + 1));
          continue;
        }
        throw new Error(`Qwen 调用失败: ${response.status} ${detail}`);
      }
      const payload = (await response.json()) as QwenResponse;
      const text = payload.choices?.[0]?.message?.content;
      if (!text) {
        throw new Error("Qwen 返回内容为空");
      }
      return {
        content: text,
        model: payload.model ?? model,
        promptTokens: payload.usage?.prompt_tokens ?? null,
        completionTokens: payload.usage?.completion_tokens ?? null,
        totalTokens: payload.usage?.total_tokens ?? null,
      };
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await delay(250 * (attempt + 1));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  const reason = (lastError instanceof Error ? lastError.message : String(lastError)).replace(/\s+/g, " ").trim();
  throw new Error(`Qwen 连接失败: ${reason}`);
};

export const callQwen35Plus = async (messages: QwenMessage[], options: QwenChatOptions = {}): Promise<string> => {
  const result = await callQwen35PlusDetailed(messages, options);
  return result.content;
};
