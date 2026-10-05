import { resolveSkillDescriptor, TargetImmunityCard } from "./skill-registry.js";
import type { Player, SkillId } from "./types.js";

/**
 * 声明式技能规则的谓词查询层（Phase 3）。
 *
 * 只依赖 `skill-registry.ts` 的 `resolveSkillDescriptor`（外部武将包 → 内置 → 兜底）与 `types.ts`，
 * 因此内置技能与外部 `.skill.json` 的 `rules` 走同一条合并路径。
 * 严禁 import `resolve.ts` / `skills.ts`，避免形成模块环。
 */

export type ResolvedSkillRules = {
  /** 距离 -N（求和）。 */
  distanceDelta: number;
  /** 使用受距离限制的锦囊无距离限制（OR）。 */
  trickDistanceExempt: boolean;
  /** 出牌阶段杀无次数限制（OR）。 */
  slashLimitExempt: boolean;
  /** 需 N 张闪/杀响应（取最大，默认 1）。 */
  responseMultiplier: number;
  /** 不能成为的目标牌类（并集）。 */
  targetImmunity: { cards: Set<TargetImmunityCard>; requireEmptyHand: boolean }[];
  /** 被桃救时额外回复（求和）。 */
  peachSaveBonus: number;
  /** 本回合未使用/打出过杀时可跳过弃牌阶段（OR）。 */
  skipDiscardPhaseIfNoSlash: boolean;
};

/** 可查询归属技能的布尔类规则（需要"为哪个技能询问是否发动"的场景）。 */
export type BooleanSkillRuleKey = "trickDistanceExempt" | "slashLimitExempt" | "skipDiscardPhaseIfNoSlash";

const rulesOf = (id: SkillId) => resolveSkillDescriptor(id).rules;

/** 合并玩家拥有的全部技能的 rules：数值求和、布尔 OR、responseMultiplier 取最大、targetImmunity 取并集。 */
export function getSkillRules(player: Player): ResolvedSkillRules {
  const resolved: ResolvedSkillRules = {
    distanceDelta: 0,
    trickDistanceExempt: false,
    slashLimitExempt: false,
    responseMultiplier: 1,
    targetImmunity: [],
    peachSaveBonus: 0,
    skipDiscardPhaseIfNoSlash: false,
  };
  for (const skillId of new Set(player.skills)) {
    const rules = rulesOf(skillId);
    if (!rules) {
      continue;
    }
    if (typeof rules.distanceDelta === "number") {
      resolved.distanceDelta += rules.distanceDelta;
    }
    if (rules.trickDistanceExempt) {
      resolved.trickDistanceExempt = true;
    }
    if (rules.slashLimitExempt) {
      resolved.slashLimitExempt = true;
    }
    if (rules.skipDiscardPhaseIfNoSlash) {
      resolved.skipDiscardPhaseIfNoSlash = true;
    }
    if (typeof rules.responseMultiplier === "number") {
      resolved.responseMultiplier = Math.max(resolved.responseMultiplier, rules.responseMultiplier);
    }
    if (typeof rules.peachSaveBonus === "number") {
      resolved.peachSaveBonus += rules.peachSaveBonus;
    }
    if (rules.targetImmunity && rules.targetImmunity.cards.length > 0) {
      resolved.targetImmunity.push({
        cards: new Set(rules.targetImmunity.cards),
        requireEmptyHand: rules.targetImmunity.requireEmptyHand ?? false,
      });
    }
  }
  return resolved;
}

/**
 * 「本回合已发动技能」的数值规则求和：用于裸衣 `damageDelta`、英姿/裸衣 `drawPhaseDelta` 这类
 * 发动后才生效的效果。`isUsed` 通常传 `(id) => ctx.isSkillUsed(player.id, id)`。
 */
export function sumActivatedRules(
  player: Player,
  key: "damageDelta" | "drawPhaseDelta",
  isUsed: (skillId: SkillId) => boolean,
): number {
  let total = 0;
  for (const skillId of new Set(player.skills)) {
    if (!isUsed(skillId)) {
      continue;
    }
    const value = rulesOf(skillId)?.[key];
    if (typeof value === "number") {
      total += value;
    }
  }
  return total;
}

/** 目标免疫：命中任一技能的 targetImmunity.cards，且满足 requireEmptyHand 条件（空城需空手）。 */
export function isImmuneTo(player: Player, card: TargetImmunityCard): boolean {
  for (const entry of getSkillRules(player).targetImmunity) {
    if (!entry.cards.has(card)) {
      continue;
    }
    if (entry.requireEmptyHand && player.hand.length > 0) {
      continue;
    }
    return true;
  }
  return false;
}

/**
 * 找出玩家拥有的、声明了该布尔规则的第一个技能 id。
 * 用于"需要为哪个技能询问是否发动"的场景（如克己跳弃牌），调用方据此拿展示名做提示。
 * 只返回第一个声明者：同一玩家带多个同类技能时不做合并询问（与 rules 的 OR 合并语义一致）。
 */
export function findSkillWithBooleanRule(player: Player, key: BooleanSkillRuleKey): SkillId | null {
  for (const skillId of new Set(player.skills)) {
    if (rulesOf(skillId)?.[key]) {
      return skillId;
    }
  }
  return null;
}
