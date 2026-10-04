import assert from "node:assert/strict";
import { test } from "node:test";
import { SanGuoGame } from "../engine/game.js";
import { SkillName } from "../engine/types.js";
import { buildMatchGeneralsText, stripGeneralsSections } from "./match-context.js";

void test("buildMatchGeneralsText：只包含在场技能、未出场不出现", async () => {
  const game = new SanGuoGame(() => 0.5);
  await game.initDefaultGame({ aiCount: 1 });
  const snapshot = game.getSnapshot();
  const text = buildMatchGeneralsText(snapshot);
  const present = new Set(snapshot.players.flatMap((player) => player.skills));
  assert.ok(present.size > 0);
  const listed = text
    .split("\n")
    .map((line) => line.split("：")[1]?.split("——")[0])
    .filter((skill): skill is string => Boolean(skill));
  assert.ok(listed.length > 0, "应至少列出一个技能");
  for (const skill of listed) {
    assert.ok(present.has(skill), `未出场技能不应出现: ${skill}`);
  }
});

void test("buildMatchGeneralsText：魂姿觉醒后英姿·英魂出现", async () => {
  const game = new SanGuoGame(() => 0.5);
  await game.initDefaultGame({ aiCount: 1 });
  const snapshot = game.getSnapshot();
  const awakened = {
    ...snapshot,
    players: snapshot.players.map((player) =>
      player.general === "孙策" ? { ...player, skills: [...player.skills, SkillName.Heroic, SkillName.YingHun] } : player,
    ),
  };
  const text = buildMatchGeneralsText(awakened);
  assert.ok(text.includes(SkillName.Heroic));
  assert.ok(text.includes(SkillName.YingHun));
});

void test("stripGeneralsSections：剔除§14与§16.3，保留其余", () => {
  const full = [
    "## 13. 卡牌",
    "卡牌内容",
    "## 14. 全部武将与技能说明",
    "曹操：奸雄",
    "## 15. 版本边界",
    "边界内容",
    "### 16.3 武将速查",
    "速查内容",
  ].join("\n");
  const stripped = stripGeneralsSections(full);
  assert.ok(!stripped.includes("曹操：奸雄"));
  assert.ok(!stripped.includes("速查内容"));
  assert.ok(stripped.includes("卡牌内容"));
  assert.ok(stripped.includes("边界内容"));
});
