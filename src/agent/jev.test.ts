import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { callJevSystemOne } from "./jev.js";
import { JevAdvisor } from "./jev-advisor.js";
import { CardType } from "../engine/cards.js";
import { SanGuoGame, TurnPhase } from "../engine/game.js";

/**
 * Jev 失效时的行为回归：
 * - 确定性 4xx（401/400）必须立刻失败，绝不重试——否则 Jev 端点配错时，每一次决策都白等 3 轮超时，
 *   联机表现就是「Jev 卡住了」；
 * - 连续失败达到阈值后熔断，冷却期内不再发起请求（决策改用上层本地策略）；
 * - 冷却结束自动恢复。
 */

type Stub = {
  baseUrl: string;
  requests: number;
  close: () => Promise<void>;
};

const startStub = async (status: number, body = "{}"): Promise<Stub> => {
  const stub: Stub = { baseUrl: "", requests: 0, close: async () => {} };
  const server = createServer((_request, response) => {
    stub.requests += 1;
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(body);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  stub.baseUrl = `http://127.0.0.1:${address.port}/v1`;
  stub.close = async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  };
  return stub;
};

const question = {
  q: { type: "noul" as const, instructions: "Is it?", criteria: { true: "yes", false: "no" } },
};

const setupPlayTurn = (): { game: SanGuoGame; aiId: string } => {
  const game = new SanGuoGame(() => 0);
  void game.initDefaultGame();
  const runtime = game as unknown as {
    currentPlayerIndex: number;
    phase: TurnPhase;
    players: Array<{ id: string; hand: Array<{ id: string; type: CardType }> }>;
  };
  const aiIndex = runtime.players.findIndex((player) => player.id === "ai-1");
  assert.ok(aiIndex >= 0);
  runtime.currentPlayerIndex = aiIndex;
  runtime.phase = TurnPhase.Play;
  const ai = runtime.players[aiIndex];
  assert.ok(ai);
  ai.hand = [
    { id: "s1", type: CardType.Slash },
    { id: "p1", type: CardType.Peach },
  ];
  return { game, aiId: "ai-1" };
};

void test("Jev 返回 401（确定性失败）时只发一次请求，不重试空转", async () => {
  const stub = await startStub(401, '{"error":"unauthorized"}');
  try {
    const startedAt = Date.now();
    await assert.rejects(
      callJevSystemOne("state", question, { baseUrl: stub.baseUrl, model: "jev-test", apiKey: "bad", timeoutMs: 2_000 }),
      /401/,
    );
    assert.equal(stub.requests, 1, "401 是确定性失败，不该重试");
    assert.ok(Date.now() - startedAt < 1_500, "不该为确定性失败叠加退避等待");
  } finally {
    await stub.close();
  }
});

void test("Jev 返回 503（临时失败）时按退避重试到上限", async () => {
  const stub = await startStub(503, '{"error":"overloaded"}');
  try {
    await assert.rejects(
      callJevSystemOne("state", question, { baseUrl: stub.baseUrl, model: "jev-test", apiKey: "k", timeoutMs: 2_000 }),
      /503/,
    );
    assert.equal(stub.requests, 3, "5xx 应重试满 3 次");
  } finally {
    await stub.close();
  }
});

void test("连接被重置时不等退避、立刻换新连接重试一次", async () => {
  // 首个请求直接断连接（模拟复用池里的旧连接被对端 RST），之后正常响应
  const stub: Stub = { baseUrl: "", requests: 0, close: async () => {} };
  const server = createServer((request, response) => {
    stub.requests += 1;
    if (stub.requests === 1) {
      request.socket.destroy();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"answers":{"q":{"type":"noul","noul":0.9}}}');
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  stub.baseUrl = `http://127.0.0.1:${address.port}/v1`;
  stub.close = async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  };
  try {
    const startedAt = Date.now();
    const result = await callJevSystemOne("state", question, { baseUrl: stub.baseUrl, model: "jev-test", apiKey: "k", timeoutMs: 5_000 });
    assert.equal(stub.requests, 2, "网络层失败应立刻重试一次，不等退避");
    assert.ok(Date.now() - startedAt < 1_500, "即时重试不应叠加退避等待");
    assert.equal((result.answers.q as { noul: number }).noul, 0.9);
  } finally {
    await stub.close();
  }
});

void test("持续网络失败时错误信息截断、不带整页 HTML", async () => {
  const stub: Stub = { baseUrl: "", requests: 0, close: async () => {} };
  const server = createServer((request, response) => {
    stub.requests += 1;
    request.socket.destroy();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  stub.baseUrl = `http://127.0.0.1:${address.port}/v1`;
  stub.close = async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  };
  try {
    await assert.rejects(
      callJevSystemOne("state", question, { baseUrl: stub.baseUrl, model: "jev-test", apiKey: "k", timeoutMs: 2_000 }),
      (error: unknown) => {
        assert.ok(error instanceof Error && error.message.startsWith("Jev 连接失败:"));
        assert.ok(error.message.length <= 320, `错误信息应截断，实际 ${error.message.length}`);
        return true;
      },
    );
    assert.equal(stub.requests, 3, "1 次即时重试 + 退避重试到上限");
  } finally {
    await stub.close();
  }
});

void test("Jev 连续失败后熔断：冷却期内不再发起请求，冷却结束自动恢复", async () => {
  const stub = await startStub(401, '{"error":"unauthorized"}');
  const logs: Array<{ skipped: boolean; ok: boolean; elapsedMs: number; error?: string }> = [];
  let nowMs = 1_000_000;
  const previousThreshold = process.env.JEV_FAILURE_THRESHOLD;
  const previousCooldown = process.env.JEV_COOLDOWN_MS;
  process.env.JEV_FAILURE_THRESHOLD = "3";
  process.env.JEV_COOLDOWN_MS = "60000";
  try {
    const advisor = new JevAdvisor(
      "rules",
      { baseUrl: stub.baseUrl, model: "jev-test", apiKey: "bad", timeoutMs: 2_000 },
      {
        now: () => nowMs,
        log: (entry) => {
          logs.push({ skipped: entry.skipped, ok: entry.ok, elapsedMs: entry.elapsedMs, ...(entry.error ? { error: entry.error } : {}) });
        },
      },
    );
    const { game, aiId } = setupPlayTurn();
    const snapshot = game.getSnapshot();
    const actions = game.getPlayableActions(aiId);

    // 3 次真实失败 → 打开熔断
    for (let i = 0; i < 3; i += 1) {
      assert.equal(await advisor.decideTurn(snapshot, aiId, actions), null);
    }
    assert.equal(stub.requests, 3);
    assert.equal(advisor.getStats().circuitOpen, true, "连续 3 次失败后应熔断");

    // 熔断期内：不再打网络，耗时 0，仍然返回 null 交给上层本地策略
    assert.equal(await advisor.decideTurn(snapshot, aiId, actions), null);
    assert.equal(await advisor.decideTurn(snapshot, aiId, actions), null);
    assert.equal(stub.requests, 3, "熔断期不得再发起请求（这正是「不再卡住」的关键）");
    assert.equal(advisor.getStats().skippedCalls, 2);
    assert.ok(advisor.getLastFailureReason()?.includes("401"), "跳过期间仍保留真实失败原因，不假装正常");

    // 冷却结束：放行一次探测调用
    nowMs += 60_001;
    assert.equal(await advisor.decideTurn(snapshot, aiId, actions), null);
    assert.equal(stub.requests, 4, "冷却结束后应自动恢复尝试");

    const skipped = logs.filter((entry) => entry.skipped);
    assert.equal(skipped.length, 2);
    assert.equal(skipped.every((entry) => entry.elapsedMs === 0), true);
    assert.equal(logs.filter((entry) => !entry.ok && !entry.skipped).length, 4, "每次真实失败都要留下日志");
  } finally {
    if (previousThreshold === undefined) {
      delete process.env.JEV_FAILURE_THRESHOLD;
    } else {
      process.env.JEV_FAILURE_THRESHOLD = previousThreshold;
    }
    if (previousCooldown === undefined) {
      delete process.env.JEV_COOLDOWN_MS;
    } else {
      process.env.JEV_COOLDOWN_MS = previousCooldown;
    }
    await stub.close();
  }
});
