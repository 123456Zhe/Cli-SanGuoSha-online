import assert from "node:assert/strict";
import { test } from "node:test";
import { HybridPlanCache } from "./hybrid-plan.js";

const delay = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

void test("响应决策取规划绝不等待 LLM：fetch 悬挂时立即返回兜底", () => {
  // LLM 规划永远不返回（模拟 provider 挂起/超时重试中）
  const cache = new HybridPlanCache<number>(() => new Promise<string | undefined>(() => {}));
  const startedAt = Date.now();
  const plan = cache.peek("ai-1", 3, "策略记忆", 1);
  const elapsed = Date.now() - startedAt;
  assert.equal(plan, "策略记忆", "应立刻返回策略记忆兜底");
  assert.ok(elapsed < 100, `响应决策的规划查询必须是同步不阻塞的（实测 ${elapsed}ms）`);
});

void test("后台预热会写入缓存，供同一回合之后的响应决策使用", async () => {
  let calls = 0;
  const cache = new HybridPlanCache<number>(async () => {
    calls += 1;
    await delay(5);
    return "LLM 规划";
  });
  assert.equal(cache.peek("ai-1", 1, "策略记忆", 0), "策略记忆");
  await delay(40);
  assert.equal(calls, 1, "预热只飞一次");
  assert.equal(cache.peek("ai-1", 1, "策略记忆", 0), "LLM 规划", "预热完成后响应决策应拿到本回合规划");
});

void test("同一玩家同一回合只飞一次 LLM 规划（预热与回合开始共用同一请求）", async () => {
  let calls = 0;
  const cache = new HybridPlanCache<number>(async () => {
    calls += 1;
    await delay(10);
    return "LLM 规划";
  });
  void cache.peek("ai-1", 1, undefined, 0);
  const ensured = await cache.ensure("ai-1", 1, "策略记忆", 0);
  assert.equal(ensured, "LLM 规划");
  assert.equal(calls, 1);
});

void test("规划失败时先回退策略记忆，再回退上一回合旧规划", async () => {
  let failing = false;
  const cache = new HybridPlanCache<number>(async () => (failing ? undefined : "第2回合规划"));
  assert.equal(await cache.ensure("ai-1", 2, undefined, 0), "第2回合规划");
  assert.equal(await cache.ensure("ai-1", 2, "策略记忆", 0), "第2回合规划", "命中本回合缓存不再调用 LLM");
  failing = true;
  assert.equal(await cache.ensure("ai-1", 3, "策略记忆", 0), "策略记忆", "失败时回退策略记忆");
  assert.equal(await cache.ensure("ai-1", 4, undefined, 0), "第2回合规划", "无策略记忆时回退旧规划");
});

void test("规划调用抛错不产生未处理拒绝，只回退兜底", async () => {
  const cache = new HybridPlanCache<number>(async () => {
    throw new Error("LLM 挂了");
  });
  assert.equal(await cache.ensure("ai-1", 1, "策略记忆", 0), "策略记忆");
  assert.equal(cache.cached("ai-1", 1), undefined);
});
