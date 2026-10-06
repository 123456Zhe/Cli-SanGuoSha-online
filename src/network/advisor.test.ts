import assert from "node:assert/strict";
import { test } from "node:test";
import { SanGuoGame } from "../engine/game.js";
import { PlayerRole } from "../engine/types.js";
import { GameServer } from "./server.js";
import { TestClient } from "./test-helper.js";

const originalConsoleLog = console.log;

const createGame = async () => {
  const game = new SanGuoGame(() => 0.5);
  await game.initNetworkGame(
    [
      { id: "p1", name: "甲" },
      { id: "p2", name: "乙" },
    ],
    1,
    false,
  );
  return game;
};

const waitFor = async <T>(get: () => T | undefined, label: string): Promise<T> => {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = get();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`timeout waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

void test("规则助手：返回局势+身份推断，且隐藏身份不以公开口径泄露", async () => {
  console.log = () => {};
  const game = await createGame();
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 2, openingHandCount: 1, reconnectTimeoutMs: 500, aiDriver: "simple", autoRestartAfterGameOver: false },
    game,
  );
  const port = await server.listen();
  const c1 = await TestClient.connect(port);
  const c2 = await TestClient.connect(port);
  try {
    c1.send({ type: "join", name: "甲", version: 4 });
    c2.send({ type: "join", name: "乙", version: 4 });
    await waitFor(() => c1.messages.find((m) => m.type === "state"), "state");
    c1.send({ type: "advisor", kind: "rule" });
    const report = await waitFor(
      () => c1.messages.find((m) => m.type === "advisor_report" && m.kind === "rule"),
      "advisor_report",
    );
    assert.ok(report.type === "advisor_report" && report.lines.length > 0, "rule report should have lines");
    const text = report.lines.join("\n");
    assert.ok(text.includes("局势"), "report should summarize the situation");
    assert.ok(text.includes("身份判断"), "report should guess identities");
    // 信息面：只有自己/主公/已阵亡能标（公开），其余必须是推断。
    const truth = game.getSnapshot();
    const viewerTruth = truth.players.find((p) => p.id === "p1")!;
    for (const player of truth.players) {
      // 身份区行（含（公开）或推断），避开同名的战场行（`名(id)|身份:…`）。
      const line = report.lines.find(
        (l) => l.includes(player.name) && (l.includes("（公开）") || l.includes("推断")),
      );
      assert.ok(line, `report should cover ${player.name}`);
      const isPublic = player.id === "p1" || player.role === PlayerRole.Lord || !player.alive;
      if (isPublic) {
        assert.ok(line.includes("（公开）"), `${player.name} is public info, viewer is ${viewerTruth.role}`);
      } else {
        assert.ok(!line.includes("（公开）"), `${player.name} is hidden and must not be marked public`);
        assert.ok(line.includes("推断"), `${player.name} must be a guess, got: ${line}`);
      }
    }
  } finally {
    c1.destroy();
    c2.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});

void test("LLM 助手未配置时回退规则结论并明示", async () => {
  console.log = () => {};
  const game = await createGame();
  // aiDriver=simple 时 aiLoop 为 null：LLM 路径确定性回退，不依赖测试环境有无 key。
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 2, openingHandCount: 1, reconnectTimeoutMs: 500, aiDriver: "simple", autoRestartAfterGameOver: false },
    game,
  );
  const port = await server.listen();
  const c1 = await TestClient.connect(port);
  const c2 = await TestClient.connect(port);
  try {
    c1.send({ type: "join", name: "甲", version: 4 });
    c2.send({ type: "join", name: "乙", version: 4 });
    await waitFor(() => c1.messages.find((m) => m.type === "state"), "state");
    c1.send({ type: "advisor", kind: "llm" });
    const report = await waitFor(
      () => c1.messages.find((m) => m.type === "advisor_report" && m.kind === "llm"),
      "advisor_report",
    );
    assert.ok(report.type === "advisor_report");
    assert.ok(report.notice?.includes("LLM 暂不可用"), `should explain fallback, got: ${report.notice}`);
    assert.ok(report.lines.length > 0, "fallback should still carry rule conclusions");
  } finally {
    c1.destroy();
    c2.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});
