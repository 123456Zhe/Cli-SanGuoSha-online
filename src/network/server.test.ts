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
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 3, openingHandCount: 1, reconnectTimeoutMs: 500, aiDriver: "simple" },
    game,
  );
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
    const seatToken = welcome.seatToken;
    assert.ok(seatToken, "welcome 应包含座位令牌（重连凭据）");

    client1.send({ type: "leave" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(client1.messages.some((m) => m.type === "closed"), "client1 should receive closed");
    assert.ok(client2.messages.some((m) => m.type === "player_disconnected"), "client2 should receive player_disconnected");

    const reconnectClient = await TestClient.connect(port);
    try {
      reconnectClient.send({ type: "reconnect", playerId: welcome.playerId, version: 4, seatToken });
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
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 3, openingHandCount: 1, reconnectTimeoutMs: 500, aiDriver: "simple" },
    game,
  );
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
    const seatToken = welcome.seatToken;
    assert.ok(seatToken, "welcome 应包含座位令牌（重连凭据）");

    client1.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(client2.messages.some((m) => m.type === "player_disconnected"), "client2 should receive player_disconnected");
    assert.ok(!client2.messages.some((m) => m.type === "closed"), "client2 should not receive closed immediately");

    const reconnectClient = await TestClient.connect(port);
    try {
      reconnectClient.send({ type: "reconnect", playerId: welcome.playerId, version: 4, seatToken });
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

void test("AI 玩家：1 人类 + 1 AI 开局，AI 自动完成出牌回合", async () => {
  console.log = () => {};
  const game = new SanGuoGame(() => 0.5);
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 2, openingHandCount: 4, aiCount: 1, aiDriver: "simple", reconnectTimeoutMs: 60_000 },
    game,
  );
  const port = await server.listen();
  const client = await TestClient.connect(port);
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    client.send({ type: "join", name: "甲", version: 4 });
    await wait(300);

    const lobby = client.messages.find((m) => m.type === "lobby");
    assert.ok(lobby && lobby.type === "lobby" && lobby.players.some((p) => p.name.includes("[AI]")), "lobby 应展示 AI 座位");

    const startedState = client.messages.find((m) => m.type === "state");
    assert.ok(startedState && startedState.type === "state", "开局后应收到 state");
    const ai = startedState.snapshot.players.find((p) => p.isAI);
    assert.ok(ai, "开局应包含 AI 玩家");
    const aiId = ai.id;
    const humanId = startedState.snapshot.players.find((p) => !p.isAI)?.id;
    assert.ok(humanId, "应包含人类玩家");

    // 自动驱动人类（轮到就结束回合/弃牌/交互一律 pass），观察 AI 回合是否自主推进
    const deadline = Date.now() + 20_000;
    let observedAiTurn = false;
    let observedAiTurnEnd = false;
    let sawGameOver = false;
    let handledInteractions = 0;
    while (Date.now() < deadline) {
      if (client.messages.some((m) => m.type === "game_over" || m.type === "closed")) {
        sawGameOver = true;
        break;
      }
      const interactions = client.messages.filter((m) => m.type === "interaction").length;
      while (handledInteractions < interactions) {
        handledInteractions += 1;
        client.send({ type: "interaction", decision: { choice: "pass" } });
      }
      const lastState = [...client.messages].reverse().find((m) => m.type === "state");
      if (lastState && lastState.type === "state") {
        const current = lastState.snapshot.players.find((p) => p.id === lastState.snapshot.currentPlayerId);
        if (current?.id === aiId) {
          observedAiTurn = true;
        }
        if (observedAiTurn && current?.id !== aiId) {
          observedAiTurnEnd = true;
          break;
        }
        if (current?.id === humanId) {
          if (lastState.pendingDiscardCount > 0) {
            client.send({ type: "discard", handIndex: 0 });
          } else if (lastState.actions.length > 0) {
            const endIdx = lastState.actions.findIndex((a) => a.type === "end");
            if (endIdx >= 0) {
              client.send({ type: "action", actionIndex: endIdx });
            }
          }
        }
      }
      await wait(100);
    }
    assert.equal(observedAiTurn, true, "应观察到 AI 的回合");
    assert.ok(observedAiTurnEnd || sawGameOver, "AI 回合应自主结束并推进到下一玩家");
  } finally {
    client.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});

void test("同机校验：同一机器第二个连接（不同名双开）被拒绝", async () => {
  console.log = () => {};
  const { game } = await createConfiguredGame();
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 3, openingHandCount: 1, aiDriver: "simple" },
    game,
  );
  const port = await server.listen();
  const c1 = await TestClient.connect(port, "machine-A");
  const c2 = await TestClient.connect(port, "machine-B");
  const c3 = await TestClient.connect(port, "machine-C");
  const c4 = await TestClient.connect(port, "machine-A"); // 与 c1 同一台“机器”
  try {
    c1.send({ type: "join", name: "甲", version: 4 });
    c2.send({ type: "join", name: "乙", version: 4 });
    c3.send({ type: "join", name: "丙", version: 4 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(c1.messages.some((m) => m.type === "welcome"), "c1 应加入成功");

    c4.send({ type: "join", name: "丁", version: 4 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(c4.messages.some((m) => m.type === "closed"), "同机第二个连接应被拒绝");
    assert.ok(!c4.messages.some((m) => m.type === "welcome"), "不应获得座位");
  } finally {
    c1.destroy();
    c2.destroy();
    c3.destroy();
    c4.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});

void test("跨机同名：未带座位令牌不能顶掉在线座位，原连接不受影响", async () => {
  console.log = () => {};
  const { game } = await createConfiguredGame();
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 3, openingHandCount: 1, aiDriver: "simple" },
    game,
  );
  const port = await server.listen();
  const c1 = await TestClient.connect(port, "machine-A");
  const c2 = await TestClient.connect(port, "machine-B");
  const c3 = await TestClient.connect(port, "machine-C");
  try {
    c1.send({ type: "join", name: "甲", version: 4 });
    c2.send({ type: "join", name: "乙", version: 4 });
    c3.send({ type: "join", name: "丙", version: 4 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(c1.messages.some((m) => m.type === "welcome"), "c1 应加入成功");

    // 另一台机器（不同机器标识、无座位令牌）用同一名字加入：玩家名是对局公开信息，
    // 不能仅凭名字顶座，否则任何人都能踢掉真人并看到其手牌。
    const c4 = await TestClient.connect(port, "machine-D");
    c4.send({ type: "join", name: "甲", version: 4 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(
      c4.messages.some((m) => m.type === "error" && m.message.includes("座位令牌")),
      "无令牌的跨机顶座应被明确拒绝并给出可操作提示",
    );
    assert.ok(!c1.messages.some((m) => m.type === "closed"), "原连接不应被踢掉");
    c4.destroy();
  } finally {
    c1.destroy();
    c2.destroy();
    c3.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});

void test("座位令牌：带正确令牌可跨机接管座位，旧连接收到关闭提示", async () => {
  console.log = () => {};
  const { game } = await createConfiguredGame();
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 3, openingHandCount: 1, aiDriver: "simple" },
    game,
  );
  const port = await server.listen();
  const c1 = await TestClient.connect(port, "machine-A");
  const c2 = await TestClient.connect(port, "machine-B");
  const c3 = await TestClient.connect(port, "machine-C");
  try {
    c1.send({ type: "join", name: "甲", version: 4 });
    c2.send({ type: "join", name: "乙", version: 4 });
    c3.send({ type: "join", name: "丙", version: 4 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const welcome = c1.messages.find((m) => m.type === "welcome");
    assert.ok(welcome);
    const seatToken = welcome.seatToken;
    assert.ok(seatToken, "welcome 应包含座位令牌");

    // 伪造令牌 → 拒绝
    const forged = await TestClient.connect(port, "machine-E");
    try {
      forged.send({ type: "reconnect", playerId: welcome.playerId, version: 4, seatToken: "forged-token" });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.ok(
        forged.messages.some((m) => m.type === "error" && m.message.includes("令牌不匹配")),
        "伪造令牌应被拒绝",
      );
      assert.ok(!c1.messages.some((m) => m.type === "closed"), "校验失败不应影响原连接");
    } finally {
      forged.destroy();
    }

    // 正确令牌（换设备登录）→ 接管座位
    const reconnected = await TestClient.connect(port, "machine-F");
    try {
      reconnected.send({ type: "reconnect", playerId: welcome.playerId, version: 4, seatToken });
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.ok(reconnected.messages.some((m) => m.type === "reconnect_ok"), "带正确令牌应接管成功");
      assert.ok(c1.messages.some((m) => m.type === "closed"), "旧连接应收到关闭提示");
    } finally {
      reconnected.destroy();
    }
  } finally {
    c1.destroy();
    c2.destroy();
    c3.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});

void test("无机器标识（旧客户端）不受同机校验限制，同 IP 可多人加入", async () => {
  console.log = () => {};
  const { game } = await createConfiguredGame();
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 3, openingHandCount: 1, aiDriver: "simple" },
    game,
  );
  const port = await server.listen();
  const c1 = await TestClient.connect(port, null); // 不发送机器标识（模拟 Go 轻客户端）
  const c2 = await TestClient.connect(port, null);
  const c3 = await TestClient.connect(port, null);
  try {
    c1.send({ type: "join", name: "甲", version: 4 });
    c2.send({ type: "join", name: "乙", version: 4 });
    c3.send({ type: "join", name: "丙", version: 4 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (const c of [c1, c2, c3]) {
      assert.ok(c.messages.some((m) => m.type === "welcome"), "无机器标识的多个同 IP 客户端应都能加入");
    }
  } finally {
    c1.destroy();
    c2.destroy();
    c3.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});

void test("乐不思蜀跳过出牌阶段后回合自动推进，不卡死在弃牌阶段", async () => {
  console.log = () => {};
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
      delayedTricks: Array<{ cardType: CardType; sourcePlayerId: string }>;
    }>;
    deck: Array<{ id: string; type: CardType; color: "red" | "black"; suit?: string; rank?: number }>;
    currentPlayerIndex: number;
  };
  for (const player of runtime.players) {
    player.hand = [{ id: `${player.id}-card`, type: CardType.Slash, color: "red", suit: "heart", rank: 7 }];
    player.delayedTricks = [];
  }
  // 判定牌为非红桃（梅花）：p1 的乐不思蜀判定失败 → 跳过出牌阶段 → 引擎把回合收尾挂起到
  // pendingTurnEndPlayer，服务器必须自动消费推进，否则卡死在弃牌阶段（回归 #乐不思蜀卡死）。
  runtime.deck = [
    { id: "judge-club", type: CardType.Slash, color: "black", suit: "club", rank: 3 },
    { id: "d1", type: CardType.Peach, color: "red", suit: "heart", rank: 7 },
    { id: "d2", type: CardType.Peach, color: "red", suit: "heart", rank: 8 },
    { id: "d3", type: CardType.Slash, color: "red", suit: "heart", rank: 9 },
    { id: "d4", type: CardType.Slash, color: "red", suit: "heart", rank: 10 },
  ];
  runtime.players[0]!.delayedTricks = [{ cardType: CardType.Indulgence, sourcePlayerId: "p2" }];
  runtime.currentPlayerIndex = runtime.players.findIndex((player) => player.id === "p1");

  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 3, openingHandCount: 1, aiDriver: "simple" },
    game,
  );
  const port = await server.listen();
  const c1 = await TestClient.connect(port);
  const c2 = await TestClient.connect(port);
  const c3 = await TestClient.connect(port);
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    c1.send({ type: "join", name: "甲", version: 4 });
    c2.send({ type: "join", name: "乙", version: 4 });
    c3.send({ type: "join", name: "丙", version: 4 });
    // p1（人类）被乐不思蜀跳过出牌阶段：没有出牌/弃牌消息可发，
    // 服务器必须自动收尾并推进到下一玩家，而不是卡在"弃牌阶段 + 无动作"。
    const deadline = Date.now() + 5_000;
    let advanced = false;
    let stuckAtDiscard = false;
    while (Date.now() < deadline) {
      const states = c2.messages.filter((m) => m.type === "state");
      const last = states.at(-1);
      if (last && last.type === "state") {
        if (last.snapshot.currentPlayerId !== "p1") {
          advanced = true;
          break;
        }
        if (last.snapshot.phase === "弃牌阶段" && last.actions.length === 0 && last.pendingDiscardCount === 0) {
          stuckAtDiscard = true;
        }
      }
      await wait(100);
    }
    assert.equal(advanced, true, "乐不思蜀跳过出牌阶段后回合应自动推进到下一玩家");
    if (stuckAtDiscard) {
      assert.fail("回合曾卡死在弃牌阶段（无动作且无需弃牌）");
    }
  } finally {
    c1.destroy();
    c2.destroy();
    c3.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});

void test("交互超时：长时间不响应按未响应处理，牌局继续而不是挂死", async () => {
  console.log = () => {};
  const { game } = await createConfiguredGame();
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 3, openingHandCount: 1, aiDriver: "simple", interactionTimeoutMs: 200 },
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
    await wait(200);
    const state = [...c1.messages].reverse().find((m) => m.type === "state");
    assert.ok(state && state.type === "state", "开局后应收到 state");
    const slashIndex = state.actions.findIndex((action) => action.type === "play" && action.label.includes("杀"));
    assert.ok(slashIndex >= 0, "甲应有可用的杀");
    const p2 = state.snapshot.players.find((player) => player.name === "乙");
    assert.ok(p2, "应找到乙的座位");
    const hpBefore = p2.hp;

    c1.send({ type: "action", actionIndex: slashIndex, targetId: p2.id });
    // 出杀的武将会先被询问是否发动技能（如铁骑）；正常应答"不发动"再推进到乙的闪响应。
    await wait(100);
    const attackerPrompt = [...c1.messages].reverse().find((m) => m.type === "interaction");
    if (attackerPrompt && attackerPrompt.type === "interaction") {
      c1.send({
        type: "interaction",
        decision: attackerPrompt.request.kind === "optional-effect" ? { choice: "effect", enabled: false } : { choice: "pass" },
      });
    }
    await wait(150);
    assert.ok(c2.messages.some((m) => m.type === "interaction"), "乙应收到打闪的交互请求");

    // 乙故意不响应：超时后应按“未响应”继续结算，而不是让整局永久等待。
    await wait(500);
    const after = [...c1.messages].reverse().find((m) => m.type === "state");
    assert.ok(after && after.type === "state", "超时后应继续广播 state");
    assert.equal(
      after.snapshot.players.find((player) => player.id === p2.id)?.hp,
      hpBefore - 1,
      "未响应视为不出闪，杀应正常造成伤害",
    );
    assert.ok(after.logs.some((line) => line.includes("未响应")), "服务端日志应记录按未响应处理");
  } finally {
    c1.destroy();
    c2.destroy();
    c3.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});

void test("消息长度上限：超长单条消息被拒绝并断开连接", async () => {
  console.log = () => {};
  const { game } = await createConfiguredGame();
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 3, openingHandCount: 1, aiDriver: "simple", maxLineChars: 1024 },
    game,
  );
  const port = await server.listen();
  const client = await TestClient.connect(port);
  try {
    client.send({ type: "join", name: "甲", version: 4 });
    await wait(100);
    // 一条永不换行、远超上限的垃圾数据（模拟恶意客户端占满内存）
    client.socket.write("x".repeat(8192));
    await wait(300);
    assert.ok(
      client.messages.some((m) => m.type === "error" && m.message.includes("长度上限")),
      "应回一条长度超限错误",
    );
    assert.equal(client.socket.destroyed, true, "超长消息后服务端应断开该连接");
  } finally {
    client.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});

void test("连接数上限：超过上限的连接被明确拒绝", async () => {
  console.log = () => {};
  const { game } = await createConfiguredGame();
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 3, openingHandCount: 1, aiDriver: "simple", maxConnections: 2 },
    game,
  );
  const port = await server.listen();
  const c1 = await TestClient.connect(port);
  const c2 = await TestClient.connect(port);
  const c3 = await TestClient.connect(port);
  try {
    await wait(200);
    assert.ok(
      c3.messages.some((m) => m.type === "error" && m.message.includes("上限")),
      "第 3 个连接应收到连接数上限错误",
    );
    assert.equal(c3.socket.destroyed, true, "被拒绝的连接应被断开");
    assert.ok(!c1.messages.some((m) => m.type === "error"), "已建立的连接不受影响");
  } finally {
    c1.destroy();
    c2.destroy();
    c3.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});

void test("调试参数 --general：房主未开启 --allow-general-pick 时不可用（默认关闭）", async () => {
  console.log = () => {};
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const game = new SanGuoGame(() => 0.5);
  // 不给 allowGeneralPick：等价于房主按默认参数启动
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 3, openingHandCount: 1, aiDriver: "simple", reconnectTimeoutMs: 60_000 },
    game,
  );
  const port = await server.listen();
  const withGeneral = await TestClient.connect(port);
  const plain = await TestClient.connect(port);
  try {
    withGeneral.send({ type: "join", name: "甲", version: 4, general: "赵云" });
    await wait(50);
    assert.ok(
      withGeneral.messages.some((m) => m.type === "error" && m.message.includes("未开启武将自选")),
      "默认关闭时必须明确拒绝，而不是静默改成随机分配",
    );
    assert.equal(withGeneral.socket.destroyed, true, "被拒绝的连接应断开");
    assert.ok(
      !withGeneral.messages.some((m) => m.type === "welcome"),
      "未开启时调试参数不得生效（连座位都不该给）",
    );

    // 去掉参数后同一武将名可以正常加入 → 说明拒绝的是调试参数本身，不是武将名
    plain.send({ type: "join", name: "乙", version: 4 });
    await wait(50);
    assert.ok(plain.messages.some((m) => m.type === "welcome"), "不带 --general 的 join 不受开关影响");
  } finally {
    withGeneral.destroy();
    plain.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});

void test("调试参数 --general：未开局就离开的座位立刻释放武将名", async () => {
  console.log = () => {};
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const game = new SanGuoGame(() => 0.5);
  const server = new GameServer(
    {
      host: "127.0.0.1",
      port: 0,
      playerCount: 2,
      openingHandCount: 1,
      aiDriver: "simple",
      reconnectTimeoutMs: 60_000,
      allowGeneralPick: true,
    },
    game,
  );
  const port = await server.listen();
  const first = await TestClient.connect(port);
  const second = await TestClient.connect(port);
  try {
    first.send({ type: "join", name: "甲", version: 4, general: "赵云" });
    await wait(50);
    assert.ok(first.messages.some((m) => m.type === "welcome"), "第一名玩家应正常加入");
    first.destroy();
    await wait(50);

    second.send({ type: "join", name: "乙", version: 4, general: "赵云" });
    await wait(50);
    assert.ok(second.messages.some((m) => m.type === "welcome"), "离开的座位不该继续占着武将名");
    assert.ok(!second.messages.some((m) => m.type === "error"), "同一武将名在座位释放后应可再次指定");
  } finally {
    first.destroy();
    second.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});


void test("调试参数 --general：可指定自己武将，未知/重复指定被明确拒绝", async () => {
  console.log = () => {};
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  // 必须用全新的空对局：join 指定的武将只在 initNetworkGame 建局时生效。
  const game = new SanGuoGame(() => 0.5);
  const server = new GameServer(
    {
      host: "127.0.0.1",
      port: 0,
      playerCount: 3,
      openingHandCount: 1,
      aiDriver: "simple",
      reconnectTimeoutMs: 60_000,
      allowGeneralPick: true,
    },
    game,
  );
  const port = await server.listen();
  const c1 = await TestClient.connect(port);
  const bad = await TestClient.connect(port);
  const dup = await TestClient.connect(port);
  const c2 = await TestClient.connect(port);
  const c3 = await TestClient.connect(port);
  try {
    c1.send({ type: "join", name: "甲", version: 4, general: "赵云" });
    await wait(50);
    assert.ok(c1.messages.some((m) => m.type === "welcome"), "合法武将名应正常加入");

    bad.send({ type: "join", name: "乙", version: 4, general: "不存在的武将" });
    await wait(50);
    assert.ok(
      bad.messages.some((m) => m.type === "error" && m.message.includes("不在已加载的武将池中")),
      "未知武将应被拒绝并说明原因",
    );
    assert.equal(bad.socket.destroyed, true, "参数无法修正的 join 应断开连接而不是让客户端挂住");

    dup.send({ type: "join", name: "丙", version: 4, general: "赵云" });
    await wait(50);
    assert.ok(
      dup.messages.some((m) => m.type === "error" && m.message.includes("已被玩家「甲」选走")),
      "同一武将不能被两个座位指定（先到先得）",
    );

    // 另外两名玩家不带调试参数正常加入 → 凑满 3 人开局（被拒绝的连接不占座位）
    c2.send({ type: "join", name: "乙", version: 4 });
    await wait(50);
    c3.send({ type: "join", name: "丙", version: 4 });
    await wait(300);
    const state = [...c2.messages].reverse().find((m) => m.type === "state");
    assert.ok(state && state.type === "state", "凑满人数后应收到开局 state");
    const me = state.snapshot.players.find((p) => p.name === "甲");
    assert.equal(me?.general, "赵云", "调试参数指定的武将应真正生效");
    const generals = state.snapshot.players.map((p) => p.general);
    assert.equal(new Set(generals).size, generals.length, "同一局武将不能重复");
  } finally {
    c1.destroy();
    bad.destroy();
    dup.destroy();
    c2.destroy();
    c3.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});


