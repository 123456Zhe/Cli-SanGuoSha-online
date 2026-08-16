import { GameServer, GameServerOptions } from "./server.js";

const valueOf = (name: string, fallback: string): string => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const playerCount = Number.parseInt(valueOf("players", "2"), 10);
const port = Number.parseInt(valueOf("port", "9527"), 10);
const openingHandCount = Number.parseInt(valueOf("opening-hand", "4"), 10);
const aiCount = Number.parseInt(valueOf("ai", "0"), 10);
const aiThinkingMs = Number.parseInt(valueOf("ai-thinking-ms", "1200"), 10);
const aiContextRounds = Number.parseInt(valueOf("ai-context-rounds", "30"), 10);
const aiDriverValue = valueOf("ai-driver", "qwen");
const aiReasoningValue = valueOf("ai-reasoning", "auto");
const aiStrategyValue = valueOf("ai-strategy", "own");
const logLevelValue = valueOf("log-level", "info");
const allowMultiSource = valueOf("allow-multi-source", "false") === "true";
if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 6) throw new Error("--players 必须为 2 到 6");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port 无效");
if (!Number.isInteger(aiCount) || aiCount < 0 || aiCount >= playerCount) throw new Error("--ai 必须为 0 到 players-1（至少保留 1 个人类玩家）");
if (aiDriverValue !== "qwen" && aiDriverValue !== "ollama" && aiDriverValue !== "simple") throw new Error("--ai-driver 必须为 qwen/ollama/simple");
if (aiReasoningValue !== "auto" && aiReasoningValue !== "fast" && aiReasoningValue !== "normal" && aiReasoningValue !== "deep") throw new Error("--ai-reasoning 必须为 auto/fast/normal/deep");
if (aiStrategyValue !== "own" && aiStrategyValue !== "always") throw new Error("--ai-strategy 必须为 own/always");
if (logLevelValue !== "info" && logLevelValue !== "debug") throw new Error("--log-level 必须为 info/debug");
const options: GameServerOptions = {
  host: valueOf("host", "0.0.0.0"),
  port,
  playerCount,
  openingHandCount,
  autoRestartAfterGameOver: true,
  allowMultiConnectionsPerSource: allowMultiSource,
  aiCount,
  aiDriver: aiDriverValue,
  aiThinkingMs,
  aiContextRounds,
  aiReasoning: aiReasoningValue,
  aiStrategy: aiStrategyValue,
  logLevel: logLevelValue,
};
await new GameServer(options).listen();
