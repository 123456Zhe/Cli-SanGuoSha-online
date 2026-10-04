import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Card, CardType } from "./cards.js";
import { loadGeneralPacks, resetGeneralPacks } from "./general-pack.js";
import { getSkillRules, isImmuneTo, sumActivatedRules } from "./skill-rules.js";
import { Player, PlayerRole, SkillName } from "./types.js";

const makeCard = (id: string): Card => ({
  id,
  type: CardType.Dodge,
  color: "red",
  suit: "heart",
  rank: 7,
});

const makePlayer = (skills: string[], overrides: Partial<Player> = {}): Player => ({
  id: "p1",
  name: "测试",
  role: PlayerRole.Lord,
  gender: "男",
  general: "测试",
  skills,
  isAI: false,
  hp: 4,
  maxHp: 4,
  hand: [],
  weapon: null,
  armor: null,
  defenseHorse: null,
  attackHorse: null,
  treasure: null,
  treasureCards: [],
  delayedTricks: [],
  alive: true,
  faceDown: false,
  chained: false,
  ...overrides,
});

void test("getSkillRules：锁定技修正合并（求和/OR/取最大）", () => {
  assert.equal(getSkillRules(makePlayer([SkillName.MaShu])).distanceDelta, 1);
  assert.equal(getSkillRules(makePlayer([SkillName.Roar])).slashLimitExempt, true);
  assert.equal(getSkillRules(makePlayer([SkillName.QiCai])).trickDistanceExempt, true);
  assert.equal(getSkillRules(makePlayer([SkillName.WuShuang])).responseMultiplier, 2);
  assert.equal(getSkillRules(makePlayer([SkillName.JiuYuan])).peachSaveBonus, 1);

  const empty = getSkillRules(makePlayer([]));
  assert.equal(empty.distanceDelta, 0);
  assert.equal(empty.slashLimitExempt, false);
  assert.equal(empty.trickDistanceExempt, false);
  assert.equal(empty.responseMultiplier, 1, "无修正时需求数默认为 1");
  assert.equal(empty.peachSaveBonus, 0);

  // 同一技能重复出现去重（同一技能不会叠加）
  assert.equal(getSkillRules(makePlayer([SkillName.MaShu, SkillName.MaShu])).distanceDelta, 1);
});

void test("isImmuneTo：空城需空手，谦逊对特定牌恒定免疫", () => {
  const kongCheng = makePlayer([SkillName.KongCheng]);
  assert.equal(isImmuneTo(kongCheng, "slash"), true);
  assert.equal(isImmuneTo(kongCheng, "duel"), true);
  assert.equal(isImmuneTo(kongCheng, "snatch"), false, "空城不免疫顺手牵羊");

  kongCheng.hand = [makeCard("c1")];
  assert.equal(isImmuneTo(kongCheng, "slash"), false, "有手牌时空城不生效");
  assert.equal(isImmuneTo(kongCheng, "duel"), false);

  const qianXun = makePlayer([SkillName.QianXun]);
  assert.equal(isImmuneTo(qianXun, "snatch"), true);
  assert.equal(isImmuneTo(qianXun, "indulgence"), true);
  assert.equal(isImmuneTo(qianXun, "slash"), false);
});

void test("sumActivatedRules：裸衣发动后才计入伤害加成", () => {
  const luoYi = makePlayer([SkillName.LuoYi]);
  assert.equal(sumActivatedRules(luoYi, "damageDelta", () => false), 0);
  assert.equal(sumActivatedRules(luoYi, "damageDelta", (id) => id === SkillName.LuoYi), 1);
  assert.equal(sumActivatedRules(luoYi, "drawPhaseDelta", (id) => id === SkillName.LuoYi), -1);
});

void test("外部声明式技能：rules 走同一谓词层生效", async () => {
  const root = mkdtempSync(join(tmpdir(), "sgs-rules-"));
  try {
    const dir = join(root, "测试将");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "general.json"),
      JSON.stringify({ apiVersion: 1, name: "测试将", kingdom: "魏", gender: "男", maxHp: 4, skills: ["疾行"] }),
    );
    writeFileSync(
      join(dir, "疾行.skill.json"),
      JSON.stringify({
        id: "疾行",
        kind: "passive",
        description: "测试：出牌阶段杀无次数限制。",
        rules: { slashLimitExempt: true },
      }),
    );
    const report = await loadGeneralPacks({ dir: root, pool: "all" });
    assert.deepEqual(report.loaded, ["测试将"]);

    const player = makePlayer(["测试将/疾行"]);
    assert.equal(getSkillRules(player).slashLimitExempt, true);
  } finally {
    resetGeneralPacks();
    rmSync(root, { recursive: true, force: true });
  }
});
