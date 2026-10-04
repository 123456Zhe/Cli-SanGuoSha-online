import { GameInitOptions, SanGuoGame } from "./engine/game.js";
import { GeneralPackLoadOptions, loadGeneralPacks } from "./engine/general-pack.js";
import { CliSanGuoApp } from "./ui/app.js";

type RuntimeOptions = {
  seed: number | null;
  initOptions: Partial<GameInitOptions>;
  generals: GeneralPackLoadOptions;
};

const toNumber = (raw: string | undefined): number | null => {
  if (!raw) {
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return null;
  }
  return value;
};

const parseRuntimeOptions = (args: string[], env: NodeJS.ProcessEnv): RuntimeOptions => {
  const aiFromEnv = toNumber(env.SG_AI_COUNT);
  const handFromEnv = toNumber(env.SG_OPENING_HAND);
  const seedFromEnv = toNumber(env.SG_SEED);
  const initOptions: Partial<GameInitOptions> = {};
  if (aiFromEnv !== null) {
    initOptions.aiCount = aiFromEnv;
  }
  if (handFromEnv !== null) {
    initOptions.openingHandCount = handFromEnv;
  }
  const parsed: RuntimeOptions = {
    seed: seedFromEnv,
    initOptions,
    // dev（npm run dev）默认加载项目根的 generals/ 外部武将包。
    generals: { dir: "generals", pool: "all" },
  };
  for (const arg of args) {
    if (arg.startsWith("--ai=")) {
      const aiValue = toNumber(arg.slice("--ai=".length));
      if (aiValue !== null) {
        parsed.initOptions.aiCount = aiValue;
      }
    } else if (arg.startsWith("--opening-hand=")) {
      const handValue = toNumber(arg.slice("--opening-hand=".length));
      if (handValue !== null) {
        parsed.initOptions.openingHandCount = handValue;
      }
    } else if (arg.startsWith("--seed=")) {
      parsed.seed = toNumber(arg.slice("--seed=".length));
    } else if (arg.startsWith("--generals-dir=")) {
      parsed.generals.dir = arg.slice("--generals-dir=".length);
    } else if (arg.startsWith("--generals-pool=")) {
      const pool = arg.slice("--generals-pool=".length);
      if (pool !== "all" && pool !== "builtin") {
        throw new Error("--generals-pool 必须为 all/builtin");
      }
      parsed.generals.pool = pool;
    } else if (arg === "--generals-json-only" || arg === "--generals-json-only=true") {
      parsed.generals.jsonOnly = true;
    } else if (arg === "--strict-generals" || arg === "--strict-generals=true") {
      parsed.generals.strict = true;
    }
  }
  return parsed;
};

const createSeededRng = (seed: number): (() => number) => {
  let state = Math.floor(Math.abs(seed)) % 2147483647;
  if (state === 0) {
    state = 1;
  }
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
};

const main = async (): Promise<void> => {
  const options = parseRuntimeOptions(process.argv.slice(2), process.env);
  // 外部武将包必须在构造 SanGuoGame（进而读取武将池）之前预载完成。
  const report = await loadGeneralPacks({ ...options.generals, log: (line) => console.log(line) });
  for (const error of report.errors) {
    console.warn(`[generals] ${error.pack}：${error.message}`);
  }
  const game = options.seed === null ? new SanGuoGame() : new SanGuoGame(createSeededRng(options.seed));
  const app = new CliSanGuoApp(game, { initOptions: options.initOptions });
  await app.start();
};

void main();
