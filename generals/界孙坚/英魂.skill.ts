// 英魂（孙坚）— 触发性代码技能，挂 `turn_start` 事件钩子。
//
// 规则：回合开始阶段，若你已受伤，你可以令一名其他角色执行下列两项中的一项：
// 1. 摸 X 张牌，然后弃置一张牌；2. 摸一张牌。X 为你已损失的体力值且至少为 1。
//
// 引擎限制（重要）：触发性技能**没有交互式"选角色/二选一"的请求类型**，所以：
// - "一名其他角色"由技能自动挑选（排序口径：其他存活角色里手牌最少者优先，
//   手牌相同按 id 升序，保证 `--seed` 复现）；
// - 两项二选一按固定策略自动执行：X >= 2 时执行第 1 项（摸 X 弃 1，净赚 X-1 张），
//   X == 1 时执行第 2 项（摸 1 张；此时第 1 项净赚 0 张，纯亏）。
//
// 注意：只 `import type`，类型信息运行时被完全擦除，故这个相对路径不影响实际加载。
import type { SkillModule, SkillModuleCtx, SkillEventPayload } from "../../../types/generals-pack.js";
import type { Player } from "../../../types/generals-pack.js";

/** 其他存活角色里手牌最少者优先，手牌相同按 id 升序 → seed 可复现；自动挑一名。 */
const pickBeneficiary = (ctx: SkillModuleCtx, actor: Player): Player | undefined =>
  ctx.players
    .filter((player) => player.alive && player.id !== actor.id)
    .sort((a, b) => a.hand.length - b.hand.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];

export default {
  id: "英魂",
  displayName: "英魂",
  kind: "triggered",
  optional: true,
  triggers: ["turn_start"],
  description:
    "回合开始阶段，若你已受伤，你可以令一名其他角色摸 X 张牌然后弃置一张牌（X 为你已损失的体力值且至少为 1；X 为 1 时改为摸一张牌）。目标由引擎自动选择手牌最少者。",
  onTrigger: {
    turn_start: async (ctx: SkillModuleCtx, payload: SkillEventPayload, logs: string[]) => {
      const actor = payload.actor;
      if (!actor || !actor.alive) {
        return;
      }
      if (!ctx.hasSkill(actor, "界孙坚/英魂")) {
        return;
      }
      // 未受伤不发动。
      const lost = actor.maxHp - actor.hp;
      if (lost <= 0) {
        return;
      }
      if (!(await ctx.shouldActivateOptionalEffect(actor, "界孙坚/英魂"))) {
        return;
      }
      const beneficiary = pickBeneficiary(ctx, actor);
      if (!beneficiary) {
        logs.push(`${actor.name} 发动英魂，但没有其他存活角色`);
        return;
      }
      const x = Math.max(1, lost);
      if (x >= 2) {
        // 第 1 项：摸 X 张，然后弃置一张牌。
        const actual = ctx.drawCards(beneficiary.id, x);
        logs.push(`${actor.name} 发动英魂，令 ${beneficiary.name} 摸 ${actual} 张牌`);
        if (beneficiary.hand.length > 0) {
          const discarded = await ctx.requestDiscardSelection(beneficiary, 1, "英魂：弃置一张牌");
          for (const card of discarded) {
            ctx.discardPile.push(card);
          }
          logs.push(`${beneficiary.name} 弃置 ${discarded.length} 张牌`);
        }
      } else {
        // 第 2 项：摸一张牌。
        const actual = ctx.drawCards(beneficiary.id, 1);
        logs.push(`${actor.name} 发动英魂，令 ${beneficiary.name} 摸 ${actual} 张牌`);
      }
    },
  },
} satisfies SkillModule;
