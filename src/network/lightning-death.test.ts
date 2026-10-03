import assert from "node:assert/strict";
import { test } from "node:test";
import { CardType } from "../engine/cards.js";
import { SanGuoGame } from "../engine/game.js";
import { SkillName } from "../engine/types.js";
import { TurnPhase } from "../engine/game.js";
import { GameServer } from "./server.js";
import { TestClient } from "./test-helper.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const originalConsoleLog = console.log;

void test("advanceIfCurrentPlayerDead：当前玩家阵亡且无挂起下一回合时不无限递归", async () => {
  console.log = () => {};
  const game = new SanGuoGame(() => 0.5);
  await game.initNetworkGame(
    [
      { id: "p1", name: "甲" },
      { id: "p2", name: "乙" },
      { id: "p3", name: "丙" },
    ],
    4,
    false,
  );
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 3, openingHandCount: 4, aiDriver: "simple" },
    game,
  );
  try {
    const inner = server as unknown as {
      game: SanGuoGame;
      advanceIfCurrentPlayerDead(): Promise<void>;
    };
    const runtime = game as unknown as {
      players: Array<{ id: string; role: string; alive: boolean; hp: number; hand: unknown[] }>;
      pendingNextTurn: boolean;
      currentPlayerIndex: number;
    };
    // 模拟延迟结算的死亡刚刚生效：当前玩家已阵亡，但没有挂起的下一回合。
    // 选一名非主公玩家作为受害者，避免主公死亡直接结束对局。
    const victimIdx = runtime.players.findIndex((p) => p.role !== "主公" && p.role !== "Lord");
    runtime.currentPlayerIndex = victimIdx;
    runtime.players[victimIdx]!.alive = false;
    runtime.players[victimIdx]!.hp = -2;
    runtime.pendingNextTurn = false;
    for (const p of runtime.players) p.hand = [];

    await Promise.race([
      inner.advanceIfCurrentPlayerDead(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT：advanceIfCurrentPlayerDead 未在 5 秒内返回")), 5000),
      ),
    ]);
    const current = game.getCurrentPlayer();
    assert.ok(current.alive, "应推进到下一存活玩家");
    assert.notEqual(current.id, runtime.players[victimIdx]!.id, "当前玩家不应是阵亡者");
  } finally {
    console.log = originalConsoleLog;
  }
});

void test("闪电在判定阶段劈死玩家：服务器不崩溃，对局继续", async () => {
  console.log = () => {};
  const server = new GameServer({
    host: "127.0.0.1",
    port: 0,
    playerCount: 3,
    openingHandCount: 4,
    aiCount: 2,
    aiDriver: "simple",
    reconnectTimeoutMs: 60_000,
  });
  const port = await server.listen();
  const client = await TestClient.connect(port);
  try {
    // 确定性 rig：首个非主公的回合开始前，将其设为 1 血 + 判定区闪电 + 牌堆顶黑桃判定牌。
    // （主公被劈死会直接终局，无法验证“对局继续”；人类若是主公则由客户端自动结束其回合。）
    const inner = server as unknown as { beginTurn(): void; game: SanGuoGame };
    const origBeginTurn = inner.beginTurn.bind(inner);
    let victimId = "";
    let rigged = false;
    inner.beginTurn = () => {
      const g = inner.game as unknown as {
        players: Array<{
          id: string;
          role: string;
          hp: number;
          hand: unknown[];
          delayedTricks: Array<{ cardType: CardType; sourcePlayerId: string }>;
        }>;
        deck: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
        currentPlayerIndex: number;
      };
      const current = g.players[g.currentPlayerIndex];
      if (!rigged && current && current.role !== "主公") {
        rigged = true;
        victimId = current.id;
        current.hp = 1;
        current.hand = [];
        current.delayedTricks = [{ cardType: CardType.Lightning, sourcePlayerId: "ai-1" }];
        g.deck.unshift({ id: "judge-spade", type: CardType.Slash, suit: "spade", rank: 5, color: "black" });
        // 禁止任何人出桃救援，保证受害者必死（否则 AI 队友可能救活，导致测试超时）
        for (const p of g.players) {
          inner.game.setPlayerResponsePolicy(p.id, { peach: false });
        }
      }
      origBeginTurn();
    };

    client.send({ type: "join", name: "甲", version: 4 });

    // 自动处理所有交互（一律 pass：濒死不救、技能不发动）；
    // 人类回合自动弃牌/点结束，避免测试卡在人类出牌阶段（被拒绝时 1.5s 后重试）
    let handled = 0;
    let lastDriveAt = 0;
    let lastDriveKey = "";
    const deadline = Date.now() + 90000;
    let victimDead = false;
    let gameContinued = false;
    while (Date.now() < deadline) {
      const interactions = client.messages.filter((m) => m.type === "interaction").length;
      while (handled < interactions) {
        handled += 1;
        client.send({ type: "interaction", decision: { choice: "pass" } });
      }
      const lastState = [...client.messages].reverse().find((m) => m.type === "state");
      if (lastState && lastState.type === "state") {
        const snap = lastState.snapshot;
        const st = lastState as unknown as {
          actions: Array<{ type: string }>;
          pendingDiscardCount: number;
        };
        if (victimId) {
          const victim = snap.players.find((p) => p.id === victimId);
          if (victim && !victim.alive) victimDead = true;
          // 受害者阵亡后，回合推进到了下一玩家且服务器仍在广播状态
          if (victimDead && snap.currentPlayerId !== victimId && !snap.winner) {
            gameContinued = true;
            break;
          }
        }
        // 人类回合：先弃牌再点结束
        if (!victimDead && snap.currentPlayerId === "online-1" && !snap.winner && handled === interactions) {
          const driveKey = `${snap.turn}:${snap.currentPlayerId}:${st.pendingDiscardCount}:${st.actions.length}`;
          if (driveKey !== lastDriveKey || Date.now() - lastDriveAt > 1500) {
            lastDriveKey = driveKey;
            lastDriveAt = Date.now();
            if (st.pendingDiscardCount > 0) {
              client.send({ type: "discard", handIndex: 0 });
            } else {
              const endIdx = st.actions.findIndex((a) => a.type === "end");
              if (endIdx >= 0) client.send({ type: "action", actionIndex: endIdx });
            }
          }
        }
      }
      await wait(200);
    }
    assert.ok(rigged && victimId, "应已对非主公玩家设 rig");
    assert.ok(victimDead, "受害者应被闪电劈死");
    assert.ok(gameContinued, "对局应继续推进到下一玩家，服务器不应卡死");
  } finally {
    console.log = originalConsoleLog;
    client.destroy();
    await (server as unknown as { close(): Promise<void> }).close();
  }
});

void test("铁骑杀触发刚烈反杀当前玩家：服务器不崩溃，回合正确推进", async () => {
  console.log = () => {};
  const game = new SanGuoGame(() => 0.5);
  await game.initNetworkGame(
    [
      { id: "p1", name: "甲" },
      { id: "p2", name: "乙" },
      { id: "p3", name: "丙" },
    ],
    4,
    false,
  );
  // 模拟联机模式：死亡延迟结算
  game.setDeferDyingResolution(true);
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 3, openingHandCount: 4, aiDriver: "simple" },
    game,
  );
  try {
    const g = game as unknown as {
      players: Array<{
        id: string;
        role: string;
        alive: boolean;
        hp: number;
        hand: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
        skills: string[];
      }>;
      deck: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
      phase: TurnPhase;
      currentPlayerIndex: number;
    };
    // 受害者必须是非主公（主公阵亡=对局直接结束），且必须是当前玩家
    const victimIdx = g.players.findIndex((p) => p.role !== "主公");
    assert.ok(victimIdx >= 0, "应有非主公玩家");
    g.currentPlayerIndex = victimIdx;
    const targetIdx = (victimIdx + 1) % g.players.length;
    const attacker = g.players[victimIdx]!;
    const target = g.players[targetIdx]!;
    for (const p of g.players) {
      game.setPlayerResponsePolicy(p.id, { peach: false });
    }

    attacker.skills.push(SkillName.TieQi);
    attacker.hp = 1;
    attacker.hand = [{ id: "slash-1", type: CardType.Slash, suit: "heart", rank: 5, color: "red" }];
    game.setOptionalEffectDecision(attacker.id, SkillName.TieQi, true);

    target.skills.push(SkillName.GangLie);
    target.hp = 4;
    game.setOptionalEffectDecision(target.id, SkillName.GangLie, true);

    // 牌堆顶：铁骑判定红牌（此杀不可闪避）→ 刚烈判定非红桃（反杀 1 点）
    g.deck.unshift(
      { id: "j-tieqi", type: CardType.Slash, suit: "heart", rank: 9, color: "red" },
      { id: "j-ganglie", type: CardType.Slash, suit: "spade", rank: 7, color: "black" },
    );
    g.phase = TurnPhase.Play;

    const slashAction = game
      .getPlayableActions(attacker.id)
      .find((a) => a.type === "play" && a.cardIndex === 0);
    assert.ok(slashAction, "应有可出的杀");
    const logs = await game.playAction(attacker.id, slashAction, target.id);
    assert.ok(attacker.hp <= 0, `铁骑杀应被刚烈反杀至濒死，实际 hp=${attacker.hp}\n${logs.join("\n")}`);
    assert.ok(logs.join("\n").includes("铁骑"), "日志应包含铁骑判定");

    // 复刻服务器出牌后的收尾流程：ensureTurnState → resolvePendingDeaths → advanceIfCurrentPlayerDead
    logs.push(...(await game.ensureTurnState()));
    logs.push(...(await game.resolvePendingDeaths()));
    assert.ok(!attacker.alive, "延迟结算后攻击者应阵亡");
    await Promise.race([
      (server as unknown as { advanceIfCurrentPlayerDead(): Promise<void> }).advanceIfCurrentPlayerDead(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT：advanceIfCurrentPlayerDead 未在 5 秒内返回")), 5000),
      ),
    ]);
    const current = game.getCurrentPlayer();
    assert.ok(current.alive, "应推进到下一存活玩家");
    assert.notEqual(current.id, attacker.id, "当前玩家不应是阵亡的攻击者");
  } finally {
    console.log = originalConsoleLog;
  }
});
