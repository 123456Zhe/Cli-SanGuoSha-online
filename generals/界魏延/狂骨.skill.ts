// 狂骨（魏延，界限突破版）— 触发性代码技能，挂 `after_damage` 事件钩子。
//
// 规则：每当你对一名角色造成 1 点伤害后，你可以回复 1 点体力或摸一张牌。
//
// 二选一按固定策略自动执行：已受伤则回复 1 点体力，满血则摸一张牌。
// 简化说明：官方是"每造成 1 点伤害"触发一次；本实现按**每次伤害事件**触发一次
// （多点伤害的一次事件只触发一次），避免高额伤害时连续多次询问拖慢对局。
//
// 回血实现：直接 `player.hp = min(maxHp, hp + 1)`。这是增益型触发（非拦截型钩子），
// 不涉及濒死/胜负结算路径；自对弈不变量（体力/生死自洽）已覆盖验证。
//
// 注意：只 `import type`，类型信息运行时被完全擦除，故这个相对路径不影响实际加载。
import type { SkillModule, SkillModuleCtx, SkillEventPayload } from "../../../types/generals-pack.js";

export default {
  id: "狂骨",
  displayName: "狂骨",
  kind: "triggered",
  optional: true,
  triggers: ["after_damage"],
  description:
    "每当你对一名角色造成伤害后，你可以回复 1 点体力（已受伤时）或摸一张牌（满血时）。",
  onTrigger: {
    after_damage: async (ctx: SkillModuleCtx, payload: SkillEventPayload, logs: string[]) => {
      const source = payload.source;
      const target = payload.target;
      if (!source || !target || !source.alive) {
        return;
      }
      // 只有伤害来源是"界魏延/狂骨"持有者才发动；对自己造成伤害也算（官方口径）。
      if (!ctx.hasSkill(source, "界魏延/狂骨")) {
        return;
      }
      if (!(await ctx.shouldActivateOptionalEffect(source, "界魏延/狂骨"))) {
        return;
      }
      if (source.hp < source.maxHp) {
        source.hp = Math.min(source.maxHp, source.hp + 1);
        logs.push(`${source.name} 发动狂骨，回复 1 点体力（对 ${target.name} 造成伤害）`);
      } else {
        const actual = ctx.drawCards(source.id, 1);
        logs.push(`${source.name} 发动狂骨，摸 ${actual} 张牌（对 ${target.name} 造成伤害）`);
      }
    },
  },
} satisfies SkillModule;
