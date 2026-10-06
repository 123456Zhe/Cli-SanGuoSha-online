import assert from "node:assert/strict";
import { test } from "node:test";
import { SanGuoGame } from "../engine/game.js";
import { resolveSkillDescriptor } from "../engine/skill-registry.js";
import { GameServer } from "./server.js";
import { TestClient } from "./test-helper.js";

const originalConsoleLog = console.log;

void test("state 消息携带本局技能说明 skillDescriptions", async () => {
  console.log = () => {};
  const game = new SanGuoGame(() => 0.5);
  await game.initNetworkGame(
    [
      { id: "p1", name: "甲" },
      { id: "p2", name: "乙" },
    ],
    1,
    false,
  );
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
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const states = c1.messages.filter((m) => m.type === "state");
    assert.ok(states.length > 0, "c1 should receive state");
    const last = states[states.length - 1]!;
    assert.ok(last.type === "state" && last.skillDescriptions, "state should carry skillDescriptions");
    const descriptions = last.skillDescriptions as Record<string, string>;
    assert.ok(last.snapshot, "state should carry snapshot");
    for (const player of last.snapshot.players) {
      for (const skillId of player.skills) {
        assert.equal(
          descriptions[skillId],
          resolveSkillDescriptor(skillId).description,
          `skill ${skillId} should have registry description`,
        );
      }
    }
  } finally {
    c1.destroy();
    c2.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});
