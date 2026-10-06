import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { CardType } from "../engine/cards.js";
import { InteractionRequest, SanGuoGame, TurnPhase } from "../engine/game.js";
import { GameAiLoop } from "./ai.js";
import { JevAdvisor } from "./jev-advisor.js";

/**
 * 联机实测的「Jev 卡住」回归：hybrid 的**响应决策**（闪/桃/无懈/借刀）过去会先
 * `await` 一次完整的 LLM 战略规划，于是对手打出一张杀之后全桌要等十几秒到几分钟
 * 才等到 AI 应答。这里的守门测试让 LLM 规划端点**永不回应**，而 Jev 立即应答：
 * 响应决策仍必须在 1 秒内返回——谁把响应路径改回阻塞等 LLM，这条测试就会超时失败。
 */

type Stub = {
  baseUrl: string;
  requests: number;
  close: () => Promise<void>;
};

const startStub = async (
  handler: (url: string | undefined) => { status: number; body: string; hold?: boolean },
): Promise<Stub> => {
  const stub: Stub = { baseUrl: "", requests: 0, close: async () => {} };
  const server = createServer((request, response) => {
    stub.requests += 1;
    const result = handler(request.url);
    if (result.hold) {
      // 刻意不回应：把「等 LLM」变成永不返回（不会残留定时器拖慢测试进程）
      return;
    }
    response.writeHead(result.status, { "Content-Type": "application/json" });
    response.end(result.body);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  stub.baseUrl = `http://127.0.0.1:${address.port}/v1`;
  stub.close = async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  };
  return stub;
};

const delay = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

void test("hybrid 响应决策不等 LLM 规划：规划接口永不回应，Jev 仍应秒回", async () => {
  // LLM 规划端点：永不回应（把「等 LLM」变成可观测的失败信号：等它 = 永远回不来）
  const llmStub = await startStub(() => ({ status: 200, body: "{}", hold: true }));
  // Jev 端点：立即给出「该出牌」的判断
  const jevStub = await startStub(() => ({
    status: 200,
    body: '{"model":"jev-test","answers":{"should_respond":{"type":"noul","noul":0.9}}}',
  }));
  const previousBase = process.env.STEP_PLAN_BASE_URL;
  const previousKey = process.env.STEP_PLAN_API_KEY;
  process.env.STEP_PLAN_BASE_URL = llmStub.baseUrl;
  process.env.STEP_PLAN_API_KEY = "test-key";
  try {
    const rulesText = readFileSync("rules.md", "utf-8");
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

    const loop = new GameAiLoop(rulesText);
    loop.start(game.getSnapshot());
    loop.setFastAdvisor(
      new JevAdvisor(rulesText, { baseUrl: jevStub.baseUrl, model: "jev-test", apiKey: "k", timeoutMs: 3_000 }, { log: () => {} }),
    );

    const request: InteractionRequest = {
      kind: "respond",
      requestId: 1,
      responderId: "ai-1",
      trigger: { cardName: "杀", actorId: "human" },
      responseKind: "peach",
      sources: [{ sourceId: "hand:p1", origin: "hand", label: "桃" }],
      allowPass: true,
      reason: "求桃",
    };

    const startedAt = Date.now();
    const raced = await Promise.race([
      loop.decideInteraction(game, "ai-1", request),
      delay(1_000).then(() => "TIMEOUT" as const),
    ]);
    const elapsed = Date.now() - startedAt;
    assert.notEqual(raced, "TIMEOUT", `响应决策不得等待 LLM 规划（>${elapsed}ms 未返回）`);
    assert.ok(raced && typeof raced === "object" && raced.choice === "card", `应由 Jev 给出出牌决策：${JSON.stringify(raced)}`);
    assert.ok(elapsed < 1_000, `响应决策应秒回，实测 ${elapsed}ms`);
    assert.equal(jevStub.requests, 1, "Jev 应被调用一次");
  } finally {
    if (previousBase === undefined) {
      delete process.env.STEP_PLAN_BASE_URL;
    } else {
      process.env.STEP_PLAN_BASE_URL = previousBase;
    }
    if (previousKey === undefined) {
      delete process.env.STEP_PLAN_API_KEY;
    } else {
      process.env.STEP_PLAN_API_KEY = previousKey;
    }
    await jevStub.close();
    await llmStub.close();
  }
});
