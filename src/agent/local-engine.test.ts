import assert from "node:assert/strict";
import { test } from "node:test";
import { CardType } from "../engine/cards.js";
import { SanGuoGame, TurnPhase } from "../engine/game.js";
import { LocalAiEngine } from "./local-engine.js";

const fixedRng = (): number => 0;

void test("本地AI记忆仅保留近三轮", () => {
  const engine = new LocalAiEngine("rules");
  engine.syncPreviousRounds([
    { round: 1, displayLines: ["第 1 回合：玩家A 的回合"], battlefieldLines: ["r1"] },
    { round: 2, displayLines: ["第 2 回合：玩家B 的回合"], battlefieldLines: ["r2"] },
    { round: 3, displayLines: ["第 3 回合：玩家C 的回合"], battlefieldLines: ["r3"] },
    { round: 4, displayLines: ["第 4 回合：玩家D 的回合"], battlefieldLines: ["r4"] },
  ]);
  assert.equal(engine.getMemorySummary().includes("memoryRounds=2,3,4"), true);
});

void test("本地AI会根据近三轮预判闪概率并优先攻击更易命中的敌方", () => {
  const game = new SanGuoGame(fixedRng);
  void game.initDefaultGame();
  const runtime = game as unknown as {
    currentPlayerIndex: number;
    phase: TurnPhase;
    players: Array<{
      id: string;
      hp: number;
      hand: Array<{ id: string; type: CardType }>;
    }>;
  };
  const ai1Index = runtime.players.findIndex((player) => player.id === "ai-1");
  const human = runtime.players.find((player) => player.id === "human");
  const ai1 = runtime.players.find((player) => player.id === "ai-1");
  const ai2 = runtime.players.find((player) => player.id === "ai-2");
  assert.ok(ai1Index >= 0);
  assert.ok(human);
  assert.ok(ai1);
  assert.ok(ai2);
  runtime.currentPlayerIndex = ai1Index;
  runtime.phase = TurnPhase.Play;
  human.hp = 2;
  ai2.hp = 2;
  ai1.hand = [{ id: "test-slash", type: CardType.Slash }];
  const engine = new LocalAiEngine("rules");
  engine.syncPreviousRounds([
    {
      round: 2,
      displayLines: ["玩家B 打出闪", "玩家B 打出闪", "玩家B 打出闪"],
      battlefieldLines: [],
    },
    {
      round: 3,
      displayLines: ["玩家B 打出闪"],
      battlefieldLines: [],
    },
    {
      round: 4,
      displayLines: ["玩家A 对 主公 使用杀"],
      battlefieldLines: [],
    },
  ]);
  const decision = engine.decide(game, "ai-1");
  assert.ok(decision);
  assert.equal(decision.action.type, "play");
  assert.equal(decision.targetId, "human");
});
