import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { CardType } from "../engine/cards.js";
import { SanGuoGame } from "../engine/game.js";
import { GameServer } from "../network/server.js";
import { ServerMessage } from "../network/protocol.js";
import { startRelay, RelayServer } from "./relay.js";

const WEBUI_DIST = resolve(process.cwd(), "webui", "dist");

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

type WsPeer = { ws: WebSocket; messages: ServerMessage[] };

const connectWs = (port: number, machineId: string): Promise<WsPeer> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: ServerMessage[] = [];
    ws.onmessage = (event) => {
      try {
        messages.push(JSON.parse(String(event.data)) as ServerMessage);
      } catch {
        // 忽略无法解析的消息
      }
    };
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "source", machineId }));
      resolve({ ws, messages });
    };
    ws.onerror = () => reject(new Error("websocket 连接失败"));
  });

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

void test("WebUI 中继：浏览器经 WS 加入对局、收到状态、断线重连取回控制权", async () => {
  console.log = () => {};
  const { game } = await createConfiguredGame();
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 3, openingHandCount: 1, aiDriver: "simple" },
    game,
  );
  const gamePort = await server.listen();
  const relay: RelayServer = await startRelay({
    gameHost: "127.0.0.1",
    gamePort,
    webPort: 0,
    staticDir: WEBUI_DIST,
  });
  const peers: WsPeer[] = [];
  try {
    // 静态页面可访问
    const page = await fetch(`http://127.0.0.1:${relay.port}/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes("三国杀"), "首页应包含游戏标题");

    // 三名玩家经 WS 加入（各自独立的机器标识，模拟不同浏览器/机器），人齐开局
    for (const [index, playerName] of ["甲", "乙", "丙"].entries()) {
      const peer = await connectWs(relay.port, `web-machine-${index + 1}`);
      peers.push(peer);
      peer.ws.send(JSON.stringify({ type: "join", name: playerName, version: 4 }));
    }
    await wait(200);
    for (const peer of peers) {
      assert.ok(peer.messages.some((m) => m.type === "welcome"), "每位玩家都应收到 welcome");
    }
    assert.ok(
      peers.some((peer) => peer.messages.some((m) => m.type === "state")),
      "开局后应收到 state",
    );
    const welcome = peers[0]?.messages.find((m) => m.type === "welcome");
    assert.ok(welcome && welcome.type === "welcome", "甲应收到 welcome");
    const playerId = welcome.playerId;

    // 断线（关闭 WS）→ 重连（携带 playerId）→ 交还控制权
    peers[0]?.ws.close();
    await wait(150);
    const reconnected = await connectWs(relay.port, "web-machine-1");
    peers.push(reconnected);
    reconnected.ws.send(JSON.stringify({ type: "reconnect", playerId, version: 4 }));
    await wait(500);
    assert.ok(
      reconnected.messages.some((m) => m.type === "reconnect_ok"),
      "重连应收到 reconnect_ok",
    );
    const lastState = [...reconnected.messages].reverse().find((m) => m.type === "state");
    assert.ok(lastState && lastState.type === "state", "重连后应收到 state");
    if (lastState && lastState.type === "state") {
      assert.ok(lastState.logs.join("\n").includes("已重连"), "重连日志应提示已重连");
    }
  } finally {
    for (const peer of peers) peer.ws.close();
    await relay.close();
    await server.close();
    console.log = originalConsoleLog;
  }
});

void test("WebUI 中继：同机（相同机器标识）第二个连接被拒绝", async () => {
  console.log = () => {};
  const { game } = await createConfiguredGame();
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 3, openingHandCount: 1, aiDriver: "simple" },
    game,
  );
  const gamePort = await server.listen();
  const relay: RelayServer = await startRelay({
    gameHost: "127.0.0.1",
    gamePort,
    webPort: 0,
    staticDir: WEBUI_DIST,
  });
  const peers: WsPeer[] = [];
  try {
    const first = await connectWs(relay.port, "same-machine");
    peers.push(first);
    first.ws.send(JSON.stringify({ type: "join", name: "甲", version: 4 }));
    await wait(150);
    assert.ok(first.messages.some((m) => m.type === "welcome"), "第一个连接应加入成功");

    // 同一浏览器/机器标识的第二个连接（不同名字）→ 中继透传 IP+机器标识，服务器拒绝
    const second = await connectWs(relay.port, "same-machine");
    peers.push(second);
    second.ws.send(JSON.stringify({ type: "join", name: "乙", version: 4 }));
    await wait(150);
    assert.ok(second.messages.some((m) => m.type === "closed"), "同机第二个连接应被拒绝");
    assert.ok(!second.messages.some((m) => m.type === "welcome"), "不应获得座位");
  } finally {
    for (const peer of peers) peer.ws.close();
    await relay.close();
    await server.close();
    console.log = originalConsoleLog;
  }
});
