import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ENGINE_SOURCES } from "./hot-reload.js";

/**
 * `game.ts` 拆分后的防漂移守卫。
 *
 * 1. 每个 `src/engine/*.ts`（测试文件除外）都必须在热重载指纹清单里：
 *    否则只改那个模块时热重载会报告"哈希未变"，`reload` 到底有没有生效无从判断。
 * 2. 拆出的模块之间不互相 import（仓库约定：跨模块调用走 context），
 *    只有 `game.ts` 可以 import 它们。
 * 3. `game.ts` 只保留薄封装：不再直接 import 被拆模块用到的底层能力
 *    （一旦重新长出大段实现，这条不会失败，但模块体积上限会）。
 */

const engineDir = dirname(fileURLToPath(import.meta.url));
const SPLIT_MODULES = [
  "game-setup",
  "turn-flow",
  "card-zones",
  "card-sources",
  "response-pipeline",
  "play-enumerate",
  "play-execute",
  "ai-driver",
] as const;

void test("热重载指纹覆盖 src/engine 下全部非测试模块", () => {
  const runtimeModules = readdirSync(engineDir)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => name);
  const missing = runtimeModules.filter((name) => !ENGINE_SOURCES.includes(name as never));
  assert.deepEqual(missing, [], `这些引擎模块未加入 hot-reload 指纹清单：${missing.join(", ")}`);
});

void test("拆出模块之间不互相 import（跨模块调用走 context）", () => {
  for (const moduleName of SPLIT_MODULES) {
    const source = readFile(moduleName);
    for (const other of SPLIT_MODULES) {
      if (other === moduleName) {
        continue;
      }
      assert.ok(
        !source.includes(`from "./${other}.js"`),
        `${moduleName}.ts 不应 import ${other}.js（拆出模块之间只通过 context 交互）`,
      );
    }
    assert.ok(!source.includes('from "./game.js"'), `${moduleName}.ts 不应 import game.ts`);
  }
});

void test("game.ts 只是薄封装：每个拆出模块的成员都转发给同名的 Impl 函数", () => {
  const source = readFile("game");
  for (const moduleName of SPLIT_MODULES) {
    const exports = readFile(moduleName).match(/^export (?:async )?function (\w+)/gm) ?? [];
    for (const line of exports) {
      const name = line.replace(/^export (?:async )?function /, "");
      assert.match(
        source,
        new RegExp(`\\b${name} as ${name}Impl\\b`),
        `game.ts 应 import ${name} as ${name}Impl（来自 ${moduleName}.ts）`,
      );
    }
  }
});

function readFile(moduleName: string): string {
  return readFileSync(join(engineDir, `${moduleName}.ts`), "utf8");
}
