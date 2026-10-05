// 节命（荀彧）— 触发性代码技能，挂 `after_damage` 事件钩子。
//
// 规则：当你受到 1 点伤害后，你可以令一名角色将手牌补至其体力上限
// （最多摸至 5 张，超出则弃至上限）。
//
// 引擎限制（重要）：触发性技能**没有交互式"选角色"的请求类型**（`InteractionRequest` 只有
// respond / collateral / choose-discard / choose-suit / optional-effect 五种），
// 所以"令一名角色"由技能自动挑选，写法与内置「英魂」一致（见 src/engine/skill-hooks.ts）。
// 排序口径：存活角色（含自己）里手牌最少者优先，手牌相同按 id 升序，保证 `--seed` 复现。
//
// 简化说明：本技能把"手牌上限"按引擎口径取**体力上限**（`target.maxHp`），
// 不叠加 `getHandLimit`（当前体力值 + 手牌上限修正）——即不做"已受伤角色上限更低"的修正。
//
// 注意：只 `import type`，类型信息运行时被完全擦除，故这个相对路径不影响实际加载。
import type { SkillModule, SkillModuleCtx, SkillEventPayload } from "../../../types/generals-pack.js";
import type { Player } from "../../../types/generals-pack.js";

/** 节命补牌的封顶：最多摸至 5 张。 */
const MAX_HAND_TARGET = 5;

/** 手牌数最少者优先（含自己），手牌相同按 id 升序 → seed 可复现；自动挑一名存活角色。 */
const pickBeneficiary = (ctx: SkillModuleCtx): Player | undefined =>
  ctx.players
    .filter((player) => player.alive)
    .sort((a, b) => a.hand.length - b.hand.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];

export default {
  id: "节命",
  displayName: "节命",
  kind: "triggered",
  optional: true,
  triggers: ["after_damage"],
  description: "当你受到 1 点伤害后，你可以令一名角色将手牌补至其体力上限（最多摸至 5 张，超出则弃至上限）。",
  onTrigger: {
    after_damage: async (ctx: SkillModuleCtx, payload: SkillEventPayload, logs: string[]) => {
      // payload.target = 受伤者；只有受伤者本人是「荀彧/节命」的持有者才发动。
      const target = payload.target;
      if (!target) {
        return;
      }
      if (!ctx.hasSkill(target, "荀彧/节命")) {
        return;
      }
      // 可选技能：询问"是否发动"。
      if (!await ctx.shouldActivateOptionalEffect(target, "荀彧/节命")) {
        return;
      }
      const beneficiary = pickBeneficiary(ctx);
      if (!beneficiary) {
        return;
      }
      // 补牌数 = max(0, min(5, 体力上限) - 当前手牌数)：上限取体力上限，封顶 5。
      const ceiling = Math.max(0, Math.min(MAX_HAND_TARGET, beneficiary.maxHp));
      if (beneficiary.hand.length > ceiling) {
        // "超出则弃至上限"：手牌多于上限时弃到上限为止（走 ctx.discardFromPlayerHand，
        // 内部用 removeHandCardAt 移除，hand_card_lost 等钩子照常触发）。
        // 正常对局里几乎走不到：手牌超过体力上限的角色在弃牌阶段就被迫弃到当前体力值了。
        const excess = beneficiary.hand.length - ceiling;
        const discarded = await ctx.discardFromPlayerHand(beneficiary, excess, logs);
        logs.push(`${target.name} 的节命生效，令 ${beneficiary.name} 将手牌弃至 ${ceiling}（弃 ${discarded} 张）`);
        return;
      }
      const drawn = Math.max(0, ceiling - beneficiary.hand.length);
      if (drawn === 0) {
        // 手牌正好在上限：不必补牌，也不弃牌。
        logs.push(`${target.name} 的节命未能为 ${beneficiary.name} 补牌：其手牌已达上限 ${ceiling}`);
        return;
      }
      const actual = ctx.drawCards(beneficiary.id, drawn);
      logs.push(`${target.name} 的节命生效，令 ${beneficiary.name} 将手牌补至 ${ceiling}（摸 ${actual} 张）`);
    },
  },
} satisfies SkillModule;
