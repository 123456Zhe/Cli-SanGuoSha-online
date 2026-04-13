import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

type Role = "system" | "user" | "assistant";

export type AiPromptMessage = {
  role: Role;
  content: string;
};

export type AiLogEntry = {
  provider: "qwen" | "ollama";
  model: string;
  stage: string;
  playerId: string;
  playerName: string;
  prompt: AiPromptMessage[];
  responseText: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  error?: string;
};

const logDir = resolve(process.cwd(), "devlog");
const logFile = resolve(logDir, "ai-log.md");

const ensureLogFile = (): void => {
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  if (!existsSync(logFile)) {
    appendFileSync(logFile, "# AI 决策日志\n\n", "utf-8");
  }
};

const estimateTokens = (text: string): number => {
  const normalized = text.trim();
  if (!normalized) {
    return 0;
  }
  return Math.max(1, Math.ceil(Array.from(normalized).length / 4));
};

const formatPrompt = (prompt: AiPromptMessage[]): string =>
  prompt
    .map((item, index) => {
      const tokens = estimateTokens(item.content);
      return `- ${index + 1}. role=${item.role} | tokens≈${tokens}\n\n\`\`\`text\n${item.content}\n\`\`\``;
    })
    .join("\n");

export const writeAiLog = (entry: AiLogEntry): void => {
  ensureLogFile();
  const timestamp = new Date().toISOString();
  const promptText = entry.prompt.map((item) => item.content).join("\n");
  const estimatedPromptTokens = estimateTokens(promptText);
  const estimatedResponseTokens = estimateTokens(entry.responseText);
  const promptTokens = entry.promptTokens ?? estimatedPromptTokens;
  const completionTokens = entry.completionTokens ?? estimatedResponseTokens;
  const totalTokens = entry.totalTokens ?? promptTokens + completionTokens;
  const lines = [
    `## ${timestamp} | ${entry.provider.toUpperCase()} | ${entry.stage}`,
    `- player: ${entry.playerName} (${entry.playerId})`,
    `- model: ${entry.model}`,
    `- prompt_tokens: ${promptTokens} (estimated=${estimatedPromptTokens})`,
    `- completion_tokens: ${completionTokens} (estimated=${estimatedResponseTokens})`,
    `- total_tokens: ${totalTokens}`,
    entry.error ? `- error: ${entry.error}` : "- error: none",
    "",
    "### Prompt",
    formatPrompt(entry.prompt),
    "",
    "### Response",
    "```text",
    entry.responseText || "(empty)",
    "```",
    "",
  ];
  appendFileSync(logFile, `${lines.join("\n")}\n`, "utf-8");
};

