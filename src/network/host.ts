import { createInterface } from "node:readline/promises";
import { loadGeneralPacks } from "../engine/general-pack.js";
import { GameServer, GameServerOptions } from "./server.js";

const valueOf = (name: string, fallback: string): string => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const hasFlag = (name: string): boolean => process.argv.some((arg) => arg === `--${name}` || arg === `--${name}=true`);
const playerCount = Number.parseInt(valueOf("players", "2"), 10);
const port = Number.parseInt(valueOf("port", "9527"), 10);
const openingHandCount = Number.parseInt(valueOf("opening-hand", "4"), 10);
const aiCount = Number.parseInt(valueOf("ai", "0"), 10);
const aiThinkingMs = Number.parseInt(valueOf("ai-thinking-ms", "1200"), 10);
const aiContextRounds = Number.parseInt(valueOf("ai-context-rounds", "30"), 10);
const aiDriverRaw = valueOf("ai-driver", "qwen");
const aiReasoningValue = valueOf("ai-reasoning", "auto") as NonNullable<GameServerOptions["aiReasoning"]>;
const aiStrategyValue = valueOf("ai-strategy", "own") as NonNullable<GameServerOptions["aiStrategy"]>;
const logLevelValue = valueOf("log-level", "info") as NonNullable<GameServerOptions["logLevel"]>;
const hybridValue = valueOf("hybrid", process.env.SG_AI_HYBRID ?? "true");
const allowMultiSource = valueOf("allow-multi-source", "false") === "true";
const interactionTimeoutSeconds = Number.parseInt(valueOf("interaction-timeout", "120"), 10);
const maxConnections = Number.parseInt(valueOf("max-connections", "32"), 10);
// 武将包：host 默认只内置（外部包是任意代码执行，联机主机需显式 --generals-pool=all 才加载他人包）。
const generalsDir = valueOf("generals-dir", "generals");
const generalsPool = valueOf("generals-pool", "builtin");
const generalsJsonOnly = hasFlag("generals-json-only");
const strictGenerals = hasFlag("strict-generals");
if (hybridValue !== "true" && hybridValue !== "false") throw new Error("--hybrid 必须为 true/false");
if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 6) throw new Error("--players 必须为 2 到 6");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port 无效");
if (!Number.isInteger(interactionTimeoutSeconds) || interactionTimeoutSeconds < 5) throw new Error("--interaction-timeout 必须是不小于 5 的秒数");
if (!Number.isInteger(maxConnections) || maxConnections < playerCount) throw new Error("--max-connections 不得小于玩家人数");
if (!Number.isInteger(aiCount) || aiCount < 0 || aiCount >= playerCount) throw new Error("--ai 必须为 0 到 players-1（至少保留 1 个人类玩家）");
if (aiDriverRaw !== "qwen" && aiDriverRaw !== "ollama" && aiDriverRaw !== "simple" && aiDriverRaw !== "system-one" && aiDriverRaw !== "hybrid") throw new Error("--ai-driver 必须为 qwen/ollama/simple/system-one/hybrid");
if (aiReasoningValue !== "auto" && aiReasoningValue !== "fast" && aiReasoningValue !== "normal" && aiReasoningValue !== "deep") throw new Error("--ai-reasoning 必须为 auto/fast/normal/deep");
if (aiStrategyValue !== "own" && aiStrategyValue !== "always") throw new Error("--ai-strategy 必须为 own/always");
if (logLevelValue !== "info" && logLevelValue !== "debug") throw new Error("--log-level 必须为 info/debug");
if (generalsPool !== "all" && generalsPool !== "builtin") throw new Error("--generals-pool 必须为 all/builtin");
const options: GameServerOptions = {
  host: valueOf("host", "0.0.0.0"),
  port,
  playerCount,
  openingHandCount,
  autoRestartAfterGameOver: true,
  allowMultiConnectionsPerSource: allowMultiSource,
  aiCount,
  aiDriver: aiDriverRaw === "hybrid" ? "qwen" : aiDriverRaw,
  /** hybrid 开关：--ai-driver=hybrid 或 --hybrid=true 开启 LLM+Judge 快慢结合，回到纯 LLM 用 --hybrid=false。 */
  hybrid: aiDriverRaw === "hybrid" ? true : hybridValue === "true",
  aiThinkingMs,
  aiContextRounds,
  aiReasoning: aiReasoningValue,
  aiStrategy: aiStrategyValue,
  logLevel: logLevelValue,
  /** 交互超时：超时视为"未响应"，按默认不响应（pass）继续结算，避免整局被一个不应答的连接挂死。 */
  interactionTimeoutMs: interactionTimeoutSeconds * 1000,
  maxConnections,
};
// 外部武将包必须在构造 GameServer（进而读取武将池）之前预载完成。
const generalsReport = await loadGeneralPacks({
  dir: generalsDir,
  pool: generalsPool,
  jsonOnly: generalsJsonOnly,
  strict: strictGenerals,
  log: (line) => console.log(line),
});
for (const error of generalsReport.errors) {
  console.warn(`[generals] ${error.pack}：${error.message}`);
}
const server = new GameServer(options);
await server.listen();

// 主机控制台：git pull 拿到修复后，输入 reload 即可热重载引擎逻辑，
// 进行中的对局不中断、玩家无感知。
console.log("主机控制台命令：reload（热重载引擎逻辑）、help");
const rl = createInterface({ input: process.stdin, output: process.stdout });
for await (const line of rl) {
  const command = line.trim().toLowerCase();
  if (command === "reload") {
    const result = await server.hotReloadEngine();
    console.log(result.message);
  } else if (command === "help") {
    console.log("reload - 热重载 src/engine 对局逻辑（进行中的对局不中断；AI 层修改需重启服务器）");
  } else if (command !== "") {
    console.log(`未知命令：${command}（输入 help 查看可用命令）`);
  }
}
