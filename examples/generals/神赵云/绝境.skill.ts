import type { SkillModule } from "../../../src/engine/skill-module.js";

/**
 * 绝境（神赵云）— 锁定技，摸牌阶段，你额外摸 X 张牌（X 为你已损失的体力值）。
 *
 * 为什么是代码技能而不是 `.skill.json`：
 * `rules.drawPhaseDelta` 只能声明**固定数值**（如英姿 1、裸衣 -1），
 * 而绝境的数值是"已损失体力值"这个运行时变量。`before_draw` 钩子的 payload 里
 * `drawCount` 可写，内置的英姿/裸衣/突袭都走这条路（`skill-hooks.ts` 的 `before_draw`），
 * 外部包的钩子在内置钩子**之后**执行，所以这里的加法与裸衣等技能可以叠加。
 *
 * 未实现的一半：「你的手牌上限 +X」。引擎里手牌上限是硬编码的
 * `player.hand.length > player.hp`（`game.ts endPlayPhase` / `discardForCurrentPlayer`），
 * 没有任何声明式字段或钩子能改它（`SkillRules` 里没有 `handLimitDelta`，全仓 grep `手牌上限` 零命中）。
 * 要补的话属于引擎改动（见 `docs/generals-pack-plan.md` §17）。
 */
export default {
  id: "绝境",
  displayName: "绝境",
  kind: "triggered",
  description: "锁定技，摸牌阶段：你额外摸 X 张牌（X 为你已损失的体力值）。",
  triggers: ["before_draw"],
  onTrigger: {
    before_draw: (ctx, payload, logs) => {
      const actor = payload.actor;
      if (!actor || payload.drawCount === undefined) {
        return;
      }
      const lost = Math.max(0, actor.maxHp - actor.hp);
      if (lost <= 0) {
        return;
      }
      payload.drawCount += lost;
      logs.push(`${actor.name} 的绝境生效，额外摸 ${lost} 张牌`);
    },
  },
} satisfies SkillModule;
