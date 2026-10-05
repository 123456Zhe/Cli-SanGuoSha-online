import assert from "node:assert/strict";
import { test } from "node:test";
import { CardType } from "../engine/cards.js";
import { Player, PlayerRole, SanGuoGame, SkillName, TurnPhase } from "../engine/game.js";
import { LocalAiEngine } from "./local-engine.js";

const fixedRng = (): number => 0;

void test("本地AI记忆默认保留最近多轮，且可通过 setMaxContextRounds 配置", () => {
  const engine = new LocalAiEngine("rules");
  engine.syncPreviousRounds([
    { round: 1, displayLines: ["第 1 回合：玩家A 的回合"], battlefieldLines: ["r1"] },
    { round: 2, displayLines: ["第 2 回合：玩家B 的回合"], battlefieldLines: ["r2"] },
    { round: 3, displayLines: ["第 3 回合：玩家C 的回合"], battlefieldLines: ["r3"] },
    { round: 4, displayLines: ["第 4 回合：玩家D 的回合"], battlefieldLines: ["r4"] },
  ]);
  assert.equal(engine.getMemorySummary().includes("memoryRounds=1,2,3,4"), true);

  engine.setMaxContextRounds(2);
  engine.syncPreviousRounds([
    { round: 1, displayLines: ["第 1 回合：玩家A 的回合"], battlefieldLines: ["r1"] },
    { round: 2, displayLines: ["第 2 回合：玩家B 的回合"], battlefieldLines: ["r2"] },
    { round: 3, displayLines: ["第 3 回合：玩家C 的回合"], battlefieldLines: ["r3"] },
    { round: 4, displayLines: ["第 4 回合：玩家D 的回合"], battlefieldLines: ["r4"] },
  ]);
  assert.equal(engine.getMemorySummary().includes("memoryRounds=3,4"), true);
});

void test("本地AI会根据近三轮预判闪概率并优先攻击更易命中的敌方", () => {  const game = new SanGuoGame(fixedRng);
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

type ThreeRuntime = {
  currentPlayerIndex: number;
  phase: TurnPhase;
  players: Player[];
};

/** 三人局：p0=主公（被测 AI）、p1=忠臣、p2=反贼，全部确定性指定，避免角色猜测引入噪声。 */
const setupThree = async (): Promise<{
  game: SanGuoGame;
  lord: Player;
  ally: Player;
  rebel: Player;
}> => {
  const game = new SanGuoGame(() => 0);
  await game.initNetworkGame(
    [
      { id: "p0", name: "甲" },
      { id: "p1", name: "乙" },
      { id: "p2", name: "丙" },
    ],
    4,
    false,
  );
  const runtime = game as unknown as ThreeRuntime;
  runtime.currentPlayerIndex = 0;
  runtime.phase = TurnPhase.Play;
  const [lord, ally, rebel] = runtime.players as [Player, Player, Player];
  for (const player of runtime.players) {
    player.skills = [];
    player.hand = [];
  }
  lord.role = PlayerRole.Lord;
  lord.isAI = true;
  ally.role = PlayerRole.Loyalist;
  rebel.role = PlayerRole.Rebel;
  return { game, lord, ally, rebel };
};

void test("本地AI按技能目标取向选目标：支援技打自己人、攻击技打敌人", async () => {
  const { game, lord, ally, rebel } = await setupThree();
  lord.hand = [{ id: "dodge", type: CardType.Dodge, color: "red", suit: "heart", rank: 2 }];
  ally.hp = 2;
  rebel.hp = 2;
  const engine = new LocalAiEngine("rules");
  // 让"丙"留下攻击主公的记录，角色猜测才会把它判成反贼（否则零分并列会默认判忠臣）。
  engine.syncPreviousRounds([
    { round: 1, displayLines: ["丙 对 主公 使用杀"], battlefieldLines: [] },
  ]);

  lord.skills = [SkillName.QingNang];
  const support = engine.decide(game, lord.id);
  assert.ok(support, "应能对青囊做出决策");
  assert.equal(support.action.type, "skill");
  assert.equal(support.targetId, ally.id, `青囊（targetIntent=ally）应选受伤的己方：${support.insight}`);

  lord.skills = [SkillName.FanJian];
  const attack = engine.decide(game, lord.id);
  assert.ok(attack, "应能对反间做出决策");
  assert.equal(attack.action.type, "skill");
  assert.equal(attack.targetId, rebel.id, `反间（targetIntent=enemy）应选敌方：${attack.insight}`);
});

void test("本地AI持有本局武将技能文本（与 LLM/Jev 同源）", async () => {
  const { game, lord, ally } = await setupThree();
  lord.hand = [{ id: "dodge", type: CardType.Dodge, color: "red", suit: "heart", rank: 2 }];
  lord.skills = [SkillName.QingNang];
  ally.skills = [SkillName.ZhiHeng];
  const engine = new LocalAiEngine("rules");

  const decision = engine.decide(game, lord.id);
  assert.ok(decision, "应能做出决策");

  const text = engine.getMatchGeneralsText();
  assert.ok(text.includes(SkillName.QingNang), `在场技能应出现：${text}`);
  assert.ok(text.includes(SkillName.ZhiHeng), `在场技能应出现：${text}`);
  assert.ok(!text.includes(SkillName.Roar), `未出场武将的技能不应出现：${text}`);
  assert.ok(engine.getMemorySummary().includes("matchSkills=2"), engine.getMemorySummary());
});

