import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { CardType } from "../engine/cards.js";
import { SanGuoGame } from "../engine/game.js";
import { GameServer } from "./server.js";
import { TestClient } from "./test-helper.js";

const HANDS = [
  [{ id: "p1-slash", type: CardType.Slash, color: "red" as const, suit: "heart" as const, rank: 7 }],
  [
    { id: "p2-slash", type: CardType.Slash, color: "red" as const, suit: "heart" as const, rank: 7 },
    { id: "p2-dodge", type: CardType.Dodge, color: "black" as const, suit: "club" as const, rank: 3 },
  ],
  [{ id: "p3-slash", type: CardType.Slash, color: "red" as const, suit: "heart" as const, rank: 7 }],
];

const originalConsoleLog = console.log;

const createConfiguredGame = async () => {
  const game = new SanGuoGame(() => 0.5);
  await game.initNetworkGame(
    [
      { id: "p1", name: "甲" },
      { id: "p2", name: "乙" },
      { id: "p3", name: "丙" },
    ],
    1,
    false,
  );
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hand: Array<{ id: string; type: CardType; color: "red" | "black"; suit?: string; rank?: number }>;
      armor: CardType | null;
      weapon: CardType | null;
      delayedTricks: Array<{ cardType: CardType; sourcePlayerId: string }>;
    }>;
    deck: Array<{ id: string; type: CardType; color: "red" | "black"; suit?: string; rank?: number }>;
    currentPlayerIndex: number;
  };
  for (let index = 0; index < runtime.players.length; index += 1) {
    const player = runtime.players[index]!;
    player.hand = HANDS[index] ?? [];
    player.armor = null;
    player.weapon = null;
    player.delayedTricks = [];
  }
  runtime.deck = [
    { id: "judge-heart", type: CardType.Peach, color: "red", suit: "heart", rank: 7 },
    { id: "judge-club", type: CardType.Slash, color: "black", suit: "club", rank: 3 },
  ];
  runtime.currentPlayerIndex = runtime.players.findIndex((player) => player.id === "p1");
  return { game, runtime };
};

const create2PlayerGame = async () => {
  const game = new SanGuoGame(() => 0.5);
  await game.initNetworkGame(
    [
      { id: "p1", name: "甲" },
      { id: "p2", name: "乙" },
    ],
    1,
    false,
  );
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hand: Array<{ id: string; type: CardType; color: "red" | "black"; suit?: string; rank?: number }>;
      armor: CardType | null;
      weapon: CardType | null;
      delayedTricks: Array<{ cardType: CardType; sourcePlayerId: string }>;
    }>;
    deck: Array<{ id: string; type: CardType; color: "red" | "black"; suit?: string; rank?: number }>;
    currentPlayerIndex: number;
    winner: string | null;
  };
  for (let index = 0; index < runtime.players.length; index += 1) {
    const player = runtime.players[index]!;
    player.hand = HANDS[index] ?? [];
    player.armor = null;
    player.weapon = null;
    player.delayedTricks = [];
  }
  runtime.deck = [
    { id: "judge-heart", type: CardType.Peach, color: "red", suit: "heart", rank: 7 },
    { id: "judge-club", type: CardType.Slash, color: "black", suit: "club", rank: 3 },
  ];
  runtime.currentPlayerIndex = runtime.players.findIndex((player) => player.id === "p1");
  return { game, runtime };
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 模拟在线玩家：对收到的交互一律应答 pass，避免牌局等待人类输入。 */
const autoPassInteractions = (client: TestClient): (() => void) => {
  let handled = 0;
  const timer = setInterval(() => {
    const total = client.messages.filter((m) => m.type === "interaction").length;
    while (handled < total) {
      handled += 1;
      client.send({ type: "interaction", decision: { choice: "pass" } });
    }
  }, 20);
  return () => clearInterval(timer);
};

void test("autoRestartAfterGameOver triggers restart", async () => {
  console.log = () => {};
  const { game } = await create2PlayerGame();
  (game as any).winner = "human";
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 2, openingHandCount: 1, reconnectTimeoutMs: 500, autoRestartAfterGameOver: true, aiDriver: "simple" },
    game,
  );
  const port = await server.listen();
  const c1 = await TestClient.connect(port);
  const c2 = await TestClient.connect(port);
  try {
    c1.send({ type: "join", name: "甲", version: 4 });
    c2.send({ type: "join", name: "乙", version: 4 });
    // Wait for game_over + 3s restart delay + game_restarting + normal state from new game
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const go = c1.messages.filter((m) => m.type === "game_over");
    const gr = c1.messages.filter((m) => m.type === "game_restarting");
    assert.ok(go.length > 0, "c1 should receive game_over");
    assert.ok(gr.length > 0, "c1 should receive game_restarting");
  } finally {
    c1.destroy();
    c2.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});

void test("断线托管：掉线玩家的回合由 AI 推进，超时不关房，重连后交还控制权", async () => {
  console.log = () => {};
  const { game } = await createConfiguredGame();
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 3, openingHandCount: 1, reconnectTimeoutMs: 200, aiDriver: "simple", autoRestartAfterGameOver: false },
    game,
  );
  const port = await server.listen();
  const c1 = await TestClient.connect(port);
  const c2 = await TestClient.connect(port);
  const c3 = await TestClient.connect(port);
  const stopC2 = autoPassInteractions(c2);
  const stopC3 = autoPassInteractions(c3);
  try {
    c1.send({ type: "join", name: "甲", version: 4 });
    c2.send({ type: "join", name: "乙", version: 4 });
    c3.send({ type: "join", name: "丙", version: 4 });
    await wait(100);
    const welcome = c1.messages.find((m) => m.type === "welcome");
    assert.ok(welcome, "c1 should be welcomed");

    // 甲（p1）为当前行动玩家，掉线后其回合应由 AI 托管推进并结束
    c1.destroy();
    const deadline = Date.now() + 10_000;
    let currentId = "";
    let logs = "";
    while (Date.now() < deadline) {
      const lastState = [...c2.messages].reverse().find((m) => m.type === "state");
      if (lastState && lastState.type === "state") {
        currentId = lastState.snapshot.currentPlayerId;
        logs = lastState.logs.join("\n");
        if (currentId !== welcome.playerId && logs.includes("AI 已托管")) {
          break;
        }
      }
      await wait(100);
    }
    assert.notEqual(currentId, welcome.playerId, "掉线玩家的回合应由 AI 推进并结束");
    assert.ok(logs.includes("AI 已托管"), "其他玩家应看到托管提示");
    assert.ok(!c2.messages.some((m) => m.type === "closed"), "超过重连超时后房间不应关闭");

    // 重连取回控制权
    const rc = await TestClient.connect(port);
    try {
      rc.send({ type: "reconnect", playerId: welcome.playerId, version: 4 });
      await wait(200);
      assert.ok(rc.messages.some((m) => m.type === "reconnect_ok"), "重连应成功");
      const rcState = [...rc.messages].reverse().find((m) => m.type === "state");
      if (rcState && rcState.type === "state") {
        assert.ok(rcState.logs.join("\n").includes("控制权已交还"), "重连后应提示交还控制权");
      }
    } finally {
      rc.destroy();
    }
  } finally {
    stopC2();
    stopC3();
    c1.destroy();
    c2.destroy();
    c3.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});

void test("autoRestartAfterGameOver false does nothing", async () => {
  console.log = () => {};
  const { game } = await create2PlayerGame();
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 2, openingHandCount: 1, reconnectTimeoutMs: 500, aiDriver: "simple" },
    game,
  );
  const port = await server.listen();
  const c1 = await TestClient.connect(port);
  const c2 = await TestClient.connect(port);
  try {
    c1.send({ type: "join", name: "甲", version: 4 });
    c2.send({ type: "join", name: "乙", version: 4 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    (game as any).winner = "human";
    await new Promise((resolve) => setTimeout(resolve, 2000));
    assert.equal(c1.messages.filter((m) => m.type === "game_over").length, 0);
    assert.equal(c1.messages.filter((m) => m.type === "game_restarting").length, 0);
  } finally {
    c1.destroy();
    c2.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});
