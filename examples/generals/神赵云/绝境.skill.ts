import type { SkillModule } from "../../../src/engine/skill-module.js";

/**
 * 绝境（神赵云）— 锁定技，摸牌阶段，你额外摸 X 张牌（X 为你已损失的体力值）；你的手牌上限 +X。
 *
 * 为什么是代码技能而不是 `.skill.json`：
 * `rules.drawPhaseDelta` / `rules.handLimitDelta` 只能声明**固定数值**（如英姿 1、裸衣 -1），
 * 而绝境的两个数值都是"已损失体力值"这个运行时变量。两条运行时通道：
 * - 摸牌数：`before_draw` 钩子的 payload 里 `drawCount` 可写（内置英姿/裸衣/突袭同路）；
 * - 手牌上限：模块级纯函数 `handLimit(player)`，被 `skill-rules.ts` 的 `getHandLimit` 求和消费
 *   （纯函数是硬要求：UI 与引擎拿同一份快照必须算出同一个上限）。
 *
 * 外部包的钩子在内置钩子**之后**执行，所以这里的加法与裸衣等技能可叠加。
 */
export default {
  id: "绝境",
  displayName: "绝境",
  kind: "triggered",
  description: "锁定技，摸牌阶段：你额外摸 X 张牌（X 为你已损失的体力值）；你的手牌上限 +X。",
  triggers: ["before_draw"],
  handLimit: (player) => Math.max(0, player.maxHp - player.hp),
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
