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

void test("autoRestartAfterGameOver triggers restart", async () => {
  console.log = () => {};
  const { game } = await create2PlayerGame();
  (game as any).winner = "human";
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 2, openingHandCount: 1, reconnectTimeoutMs: 500, autoRestartAfterGameOver: true, autoRestartAfterClose: false },
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
    // Log what happened for debugging
    assert.ok(go.length > 0, "c1 should receive game_over");
    assert.ok(gr.length > 0, "c1 should receive game_restarting");
  } finally {
    c1.destroy();
    c2.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});void test("autoRestartAfterClose resets room on timeout", async () => {
  console.log = () => {};
  const { game } = await createConfiguredGame();
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 3, openingHandCount: 1, reconnectTimeoutMs: 200, autoRestartAfterGameOver: false, autoRestartAfterClose: true },
    game,
  );
  const port = await server.listen();
  const c1 = await TestClient.connect(port);
  const c2 = await TestClient.connect(port);
  const c3 = await TestClient.connect(port);
  try {
    c1.send({ type: "join", name: "甲", version: 4 });
    c2.send({ type: "join", name: "乙", version: 4 });
    c3.send({ type: "join", name: "丙", version: 4 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    c1.destroy();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const c2Closed = c2.messages.filter((m) => m.type === "closed");
    assert.ok(c2Closed.length > 0, "c2 should receive closed");
    const nc = await TestClient.connect(port);
    try {
      nc.send({ type: "join", name: "丁", version: 4 });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const welcome = nc.messages.find((m) => m.type === "welcome");
      assert.ok(welcome, "new player should be welcomed");
      assert.equal(welcome.roomSize, 3, "room should still expect 3 players");
    } finally {
      nc.destroy();
    }
  } finally {
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
    { host: "127.0.0.1", port: 0, playerCount: 2, openingHandCount: 1, reconnectTimeoutMs: 500, autoRestartAfterGameOver: false, autoRestartAfterClose: false },
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
