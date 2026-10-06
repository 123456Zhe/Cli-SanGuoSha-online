import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { callQwen35PlusDetailed } from "./qwen.js";

/**
 * LLM 侧的同类回归：确定性 4xx 立即失败，不重试。
 * 之前 `callQwen35PlusDetailed` 对任何错误都重试 3 次，配合每次 45 秒超时，
 * 单次决策最多白等两分多钟（联机日志里出现过 138~192 秒的空档）。
 */

type Stub = {
  baseUrl: string;
  requests: number;
  close: () => Promise<void>;
};

const startStub = async (status: number): Promise<Stub> => {
  const stub: Stub = { baseUrl: "", requests: 0, close: async () => {} };
  const server = createServer((_request, response) => {
    stub.requests += 1;
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end('{"error":{"message":"nope"}}');
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

void test("LLM 返回 401 时只发一次请求（确定性失败不重试）", async () => {
  const stub = await startStub(401);
  try {
    await assert.rejects(
      callQwen35PlusDetailed([{ role: "user", content: "hi" }], {
        baseUrl: stub.baseUrl,
        apiKey: "bad-key",
        model: "test-model",
        timeoutMs: 2_000,
      }),
      /401/,
    );
    assert.equal(stub.requests, 1);
  } finally {
    await stub.close();
  }
});

void test("LLM 返回 503 时仍然重试满 3 次（临时失败不能放弃）", async () => {
  const stub = await startStub(503);
  try {
    await assert.rejects(
      callQwen35PlusDetailed([{ role: "user", content: "hi" }], {
        baseUrl: stub.baseUrl,
        apiKey: "k",
        model: "test-model",
        timeoutMs: 2_000,
      }),
      /503/,
    );
    assert.equal(stub.requests, 3);
  } finally {
    await stub.close();
  }
});
