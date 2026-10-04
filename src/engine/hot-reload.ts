import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { SanGuoGame } from "./game.js";
import type { SkillHook, SkillTrigger } from "./types.js";

export type HotReloadReport = {
  ok: boolean;
  message: string;
  /** 引擎源码指纹（game.ts 等 10 个文件的 sha256 前 12 位），用于确认加载的确实是新代码 */
  sourceHash: string;
};

export type GameConstructor = new (rng?: () => number) => SanGuoGame;

const engineDir = dirname(fileURLToPath(import.meta.url));

/** 参与热重载指纹校验的引擎源码文件 */
const ENGINE_SOURCES = [
  "game.ts",
  "skill-hooks.ts",
  "cards.ts",
  "skills.ts",
  "card-utils.ts",
  "generals.ts",
  "interaction.ts",
  "types.ts",
  "resolve.ts",
  "ai-heuristics.ts",
] as const;

const hashEngineSources = (): string => {
  const hash = createHash("sha256");
  for (const file of ENGINE_SOURCES) {
    hash.update(readFileSync(join(engineDir, file)));
  }
  return hash.digest("hex").slice(0, 12);
};

/**
 * 热重载进行中的对局引擎（对局不中断，玩家无感知）：
 *
 * 1. 把 `src/engine` 整体复制到临时目录后重新 import——副本内的相对 import
 *    全部指向副本，天然得到一张全新的模块图（不需要 ESM loader hack，
 *    tsx / 原生 node 都能用）；
 * 2. 把存活 `SanGuoGame` 实例的原型指向新类：实例字段（牌堆、手牌、血量、
 *    回合状态……）原样保留，所有方法立即换成新实现；
 * 3. 用新模块的 `createSkillHooks` 重建技能钩子闭包（技能逻辑的修复也生效）。
 *
 * 适用场景：`git pull` 拿到逻辑修复后，在主机控制台输入 `reload`，
 * 进行中的对局直接用上新代码，不用重启服务器、不用重开对局。
 *
 * 限制：
 * - 只覆盖 `src/engine`（对局规则逻辑）；`src/agent`（AI 层）的修改仍需重启服务器；
 * - 数据类修复（如牌堆构成）只对新发的牌生效，已经在场上的牌保持原样；
 * - 正在执行中的异步调用（如等待 LLM 返回）会按旧逻辑收尾，之后的调用走新逻辑。
 */
export const hotReloadEngine = async (
  game: SanGuoGame,
): Promise<{ gameClass: GameConstructor; report: HotReloadReport }> => {
  const tempDir = mkdtempSync(join(tmpdir(), "sanguo-engine-hot-"));
  try {
    cpSync(engineDir, tempDir, {
      recursive: true,
      filter: (src) => !src.endsWith(".test.ts"),
    });
    const gameModule = (await import(pathToFileURL(join(tempDir, "game.js")).href)) as unknown as {
      SanGuoGame: GameConstructor;
    };
    const hooksModule = (await import(pathToFileURL(join(tempDir, "skill-hooks.js")).href)) as unknown as {
      createSkillHooks: (ctx: never) => Record<SkillTrigger, SkillHook[]>;
    };
    const NewGame = gameModule.SanGuoGame;
    if (typeof NewGame !== "function") {
      throw new Error("新引擎模块未导出 SanGuoGame");
    }
    Object.setPrototypeOf(game, NewGame.prototype as object);
    (game as unknown as { skillHooks: Record<SkillTrigger, SkillHook[]> }).skillHooks =
      hooksModule.createSkillHooks(game as never);
    return {
      gameClass: NewGame,
      report: {
        ok: true,
        message: "引擎热重载成功",
        sourceHash: hashEngineSources(),
      },
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
};
