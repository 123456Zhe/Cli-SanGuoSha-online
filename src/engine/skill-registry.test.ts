import assert from "node:assert/strict";
import { test } from "node:test";
import { getBuiltinGenerals } from "./generals.js";
import { SKILL_REGISTRY, UNOWNED_BUILTIN_SKILLS } from "./skill-registry.js";
import { BuiltinSkillId, SkillName } from "./types.js";

void test("武将声明的每个技能在注册表都有登记", () => {
  const missing: string[] = [];
  for (const general of getBuiltinGenerals()) {
    for (const skill of general.skills) {
      if (!SKILL_REGISTRY[skill as BuiltinSkillId]) {
        missing.push(`${general.name}/${skill}`);
      }
    }
  }
  assert.deepEqual(missing, [], `未登记的技能: ${missing.join(", ")}`);
});

void test("无归属技能必须在白名单", () => {
  const owned = new Set<SkillName>();
  for (const general of getBuiltinGenerals()) {
    for (const skill of general.skills) {
      owned.add(skill);
    }
  }
  // 已实现但不归属任何内置武将的技能（§8 问题 1 的受控状态，见 UNOWNED_BUILTIN_SKILLS）。
  const orphaned = Object.keys(SKILL_REGISTRY).filter(
    (skill) => !owned.has(skill) && !UNOWNED_BUILTIN_SKILLS.has(skill),
  );
  assert.deepEqual(orphaned, [], `无归属且不在白名单的技能: ${orphaned.join(", ")}`);
});
