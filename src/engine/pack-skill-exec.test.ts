import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { Player, SanGuoGame, TurnPhase } from "./game.js";
import { loadGeneralPacks, resetGeneralPacks } from "./general-pack.js";
import { createSkillHooks, SkillHooksContext } from "./skill-hooks.js";
import { registerPackSkill, resetPackSkills } from "./skill-module.js";

type Runtime = {
  currentPlayerIndex: number;
  players: Player[];
  phase: TurnPhase;
};

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sgs-exec-"));
  resetGeneralPacks();
});

afterEach(() => {
  resetGeneralPacks();
  resetPackSkills();
  rmSync(root, { recursive: true, force: true });
});

const SHE_LIE = [
  "export default {",
  "  id: '涉猎',",
  "  displayName: '涉猎',",
  "  kind: 'active',",
  "  requiresTarget: false,",
  "  label: '发动涉猎',",
  "  description: '测试用主动技能：摸 1 张牌。',",
  "  canUse: (ctx, player) => player.hand.length >= 0,",
  "  play: async (ctx, player) => {",
  "    const drawn = ctx.drawCards(player.id, 1);",
  "    ctx.markSkillUsed(player.id, '涉猎');",
  "    return [player.name + ' 发动涉猎，摸了 ' + drawn + ' 张牌'];",
  "  },",
  "};",
].join("\n");

const TU_JI = [
  "export default {",
  "  id: '突击',",
  "  displayName: '突击',",
  "  kind: 'active',",
  "  requiresTarget: true,",
  "  label: '发动突击',",
  "  description: '测试用主动技能：需要选择目标。',",
  "  canUse: (ctx, player) => ctx.players.some((p) => p.alive && p.id !== player.id),",
  "  getTargets: (ctx, player) => ctx.players.filter((p) => p.alive && p.id !== player.id).map((p) => p.id),",
  "  play: async (ctx, player, targetId) => [player.name + ' 突击 ' + targetId],",
  "};",
].join("\n");

const BOOM = [
  "export default {",
  "  id: '爆炸',",
  "  displayName: '爆炸',",
  "  kind: 'active',",
  "  description: '测试用主动技能：执行时抛错。',",
  "  canUse: () => true,",
  "  play: async () => { throw new Error('boom'); },",
  "};",
].join("\n");

const writePack = (): void => {
  const dir = join(root, "吕蒙");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "general.json"),
    JSON.stringify({ apiVersion: 1, name: "吕蒙", kingdom: "吴", gender: "男", maxHp: 4, skills: ["涉猎", "突击", "爆炸"] }),
  );
  writeFileSync(join(dir, "涉猎.skill.ts"), SHE_LIE);
  writeFileSync(join(dir, "突击.skill.ts"), TU_JI);
  writeFileSync(join(dir, "爆炸.skill.ts"), BOOM);
};

const setupGame = async (): Promise<{ game: SanGuoGame; me: Player; other: Player }> => {
  const game = new SanGuoGame(() => 0);
  await game.initNetworkGame(
    [
      { id: "p0", name: "甲" },
      { id: "p1", name: "乙" },
    ],
    4,
    false,
  );
  const runtime = game as unknown as Runtime;
  for (const player of runtime.players) {
    player.skills = [];
  }
  runtime.currentPlayerIndex = 0;
  runtime.phase = TurnPhase.Play;
  return { game, me: runtime.players[0]!, other: runtime.players[1]! };
};

void test("外部主动技能出现在可玩动作并可执行", async () => {
  writePack();
  const report = await loadGeneralPacks({ dir: root, pool: "all" });
  assert.deepEqual(report.loaded, ["吕蒙"]);

  const { game, me } = await setupGame();
  me.skills = ["吕蒙/涉猎"];
  const actions = game.getPlayableActions(me.id);
  const skillAction = actions.find((action) => action.type === "skill" && action.skill === "吕蒙/涉猎");
  assert.ok(skillAction, "应枚举出外部主动技能");

  const handBefore = me.hand.length;
  const logs = await game.playAction(me.id, skillAction);
  assert.ok(logs.some((line) => line.includes("涉猎")), logs.join(" / "));
  assert.equal(me.hand.length, handBefore + 1, "技能应通过 ctx.drawCards 摸到 1 张牌");
});

void test("外部主动技能：requiresTarget 时枚举目标", async () => {
  writePack();
  await loadGeneralPacks({ dir: root, pool: "all" });

  const { game, me, other } = await setupGame();
  me.skills = ["吕蒙/突击"];
  const skillAction = game
    .getPlayableActions(me.id)
    .find((action) => action.type === "skill" && action.skill === "吕蒙/突击");
  assert.ok(skillAction && skillAction.type === "skill");
  assert.equal(skillAction.requiresTarget, true);
  assert.deepEqual(skillAction.targets, [other.id]);

  const logs = await game.playAction(me.id, skillAction, other.id);
  assert.ok(logs.some((line) => line.includes("突击 " + other.id)), logs.join(" / "));
});

void test("外部技能 play 抛错不炸对局", async () => {
  writePack();
  await loadGeneralPacks({ dir: root, pool: "all" });

  const { game, me } = await setupGame();
  me.skills = ["吕蒙/爆炸"];
  const skillAction = game
    .getPlayableActions(me.id)
    .find((action) => action.type === "skill" && action.skill === "吕蒙/爆炸");
  assert.ok(skillAction);

  const logs = await game.playAction(me.id, skillAction);
  assert.ok(logs.some((line) => line.includes("失败") && line.includes("boom")), logs.join(" / "));
});

void test("外部触发钩子挂到对应触发点并执行", async () => {
  registerPackSkill({
    id: "测试/钩子",
    displayName: "钩子",
    kind: "triggered",
    description: "测试钩子",
    generalName: "测试",
    onTrigger: {
      after_damage: (_ctx, _payload, logs) => {
        logs.push("PACK_HOOK_RAN");
      },
    },
  });

  const stub = {
    players: [],
    discardPile: [],
    rng: () => 0,
    hasSkill: () => false,
    shouldActivateOptionalEffect: () => Promise.resolve(false),
  } as unknown as SkillHooksContext;
  const hooks = createSkillHooks(stub);
  const logs: string[] = [];
  const hook = hooks.after_damage[hooks.after_damage.length - 1];
  assert.ok(hook, "after_damage 应追加包钩子");
  await hook({}, logs);
  assert.ok(logs.includes("PACK_HOOK_RAN"));
});
