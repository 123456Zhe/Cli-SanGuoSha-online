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

void test("主动退出后可在超时内重连", async () => {
  console.log = () => {};
  const { game } = await createConfiguredGame();
  const server = new GameServer({ host: "127.0.0.1", port: 0, playerCount: 3, openingHandCount: 1, reconnectTimeoutMs: 500 }, game);
  const port = await server.listen();
  const client1 = await TestClient.connect(port);
  const client2 = await TestClient.connect(port);
  const client3 = await TestClient.connect(port);
  try {
    client1.send({ type: "join", name: "甲", version: 4 });
    client2.send({ type: "join", name: "乙", version: 4 });
    client3.send({ type: "join", name: "丙", version: 4 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const welcome = client1.messages.find((m) => m.type === "welcome");
    assert.ok(welcome);

    client1.send({ type: "leave" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(client1.messages.some((m) => m.type === "closed"), "client1 should receive closed");
    assert.ok(client2.messages.some((m) => m.type === "player_disconnected"), "client2 should receive player_disconnected");

    const reconnectClient = await TestClient.connect(port);
    try {
      reconnectClient.send({ type: "reconnect", playerId: welcome.playerId, version: 4 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.ok(reconnectClient.messages.some((m) => m.type === "reconnect_ok"), "reconnectClient should receive reconnect_ok");
    } finally {
      reconnectClient.destroy();
    }
  } finally {
    client1.destroy();
    client2.destroy();
    client3.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});

void test("网络掉线后提示重连且房间不立即关闭", async () => {
  console.log = () => {};
  const { game } = await createConfiguredGame();
  const server = new GameServer({ host: "127.0.0.1", port: 0, playerCount: 3, openingHandCount: 1, reconnectTimeoutMs: 500 }, game);
  const port = await server.listen();
  const client1 = await TestClient.connect(port);
  const client2 = await TestClient.connect(port);
  const client3 = await TestClient.connect(port);
  try {
    client1.send({ type: "join", name: "甲", version: 4 });
    client2.send({ type: "join", name: "乙", version: 4 });
    client3.send({ type: "join", name: "丙", version: 4 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const welcome = client1.messages.find((m) => m.type === "welcome");
    assert.ok(welcome);

    client1.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(client2.messages.some((m) => m.type === "player_disconnected"), "client2 should receive player_disconnected");
    assert.ok(!client2.messages.some((m) => m.type === "closed"), "client2 should not receive closed immediately");

    const reconnectClient = await TestClient.connect(port);
    try {
      reconnectClient.send({ type: "reconnect", playerId: welcome.playerId, version: 4 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.ok(reconnectClient.messages.some((m) => m.type === "reconnect_ok"), "reconnectClient should receive reconnect_ok");
    } finally {
      reconnectClient.destroy();
    }
  } finally {
    client1.destroy();
    client2.destroy();
    client3.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});
