// 雷击（张角）—— 事件触发点 `card_used` 的示例：使用/打出【闪】后判定 + 属性伤害。
//
// 触发点：`card_used`（`resolveUsedCard` reason="使用" / `consumeResponseCard` reason="打出"）。
// payload：`actor` = 使用/打出这张牌的玩家（即技能持有者），`card` = 那张牌，`reason` = "使用" | "打出"。
// 造成伤害必须走 `ctx.applyDamage`，随后自行 `resolveDeaths` → `resolveWinner` → `advanceIfCurrentPlayerDead`。
import type { SkillModule, SkillModuleCtx } from "../../../types/generals-pack.js";

export default {
  id: "雷击",
  displayName: "雷击",
  kind: "triggered",
  optional: true,
  triggers: ["card_used"],
  description:
    "当你使用或打出【闪】时，你可以令一名其他角色（引擎自动选择体力最低者）进行判定，若结果为黑桃，你对其造成 2 点雷电伤害。",
  onTrigger: {
    card_used: async (ctx: SkillModuleCtx, payload, logs) => {
      const actor = payload.actor;
      if (!actor || !actor.alive || !ctx.hasSkill(actor, "张角/雷击")) {
        return;
      }
      // 只有【闪】触发；reason 为"使用"或"打出"都算。
      if (payload.card?.type !== "闪") {
        return;
      }
      if (payload.reason !== "使用" && payload.reason !== "打出") {
        return;
      }
      // 引擎限制：InteractionRequest 没有"选一名玩家"的类型，触发性技能无法交互式选目标
      // （见 types/generals-pack.d.ts 的说明）。照内置「英魂」的做法自动挑选：
      // 其他存活角色中体力最低者，体力相同时取手牌少者。
      const others = ctx.players.filter((player) => player.alive && player.id !== actor.id);
      if (others.length === 0) {
        return; // 没有其他存活角色 → 无合法目标
      }
      const target = [...others].sort((a, b) => a.hp - b.hp || a.hand.length - b.hand.length)[0];
      if (!target) {
        return;
      }
      if (!await ctx.shouldActivateOptionalEffect(actor, "张角/雷击")) {
        return;
      }
      // 日志如实反映引擎行为：判定归属是张角本人（下一行 drawJudgmentCard 会打出"甲的雷击判定牌"）。
      logs.push(`${actor.name} 发动雷击，指定 ${target.name}，开始判定`);
      // 判定归属传张角本人：引擎的 judgment 钩子只分发给"判定牌归属者"的技能，
      // 只有如此「鬼道」才能改判这次判定（官方经典连招）；详见 general.md。
      // 注意：判定牌本身的 suit 可以在鬼道介入后被改写，所以要在返回后判断。
      const judgment = await ctx.drawJudgmentCard(`${actor.name} 的雷击`, logs, actor);
      if (!judgment) {
        return; // 牌堆为空，判定失败
      }
      if (judgment.suit !== "spade") {
        logs.push(`${actor.name} 的雷击判定失败（非黑桃），${target.name} 未受到伤害`);
        return;
      }
      logs.push(`${actor.name} 的雷击判定成功，对 ${target.name} 造成 2 点雷电伤害`);
      // damageKind="thunder" 让铁索连环按雷电属性传导；damageCard 用那张黑桃判定牌。
      await ctx.applyDamage(actor, target, 2, "雷击", logs, judgment, "thunder");
      // 造成伤害后必须自己结算死亡/胜负/回合推进，否则濒死与胜负会静默不结算。
      await ctx.resolveDeaths();
      ctx.resolveWinner();
      await ctx.advanceIfCurrentPlayerDead(logs);
    },
  },
} satisfies SkillModule;
