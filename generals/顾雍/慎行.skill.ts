import type {
Player,
SkillModule,
SkillModuleCtx,
} from "../../../types/generals-pack.js";

// 慎行（顾雍）— 主动技能，出牌阶段。
//
// 规则：出牌阶段，你可以弃置两张牌，然后摸一张牌。（身份局与 2V2 文本相同，无版本差异。）
//
// 实现要点：
// - 无次数限制：文本无“限一次”，出牌阶段可重复发动（每次净 -1 手牌，自然收敛），故不记 skillUsedThisTurn。
// - 代价：弃置两张手牌（origin=hand，与雪恨的弃牌代价同一约定），用 `buildUsableSources` + `requestDiscardSelection(2)`，返回的牌已移出手牌，手动进弃牌堆。
// - 收益：`drawCards(player.id, 1)` 摸一张牌。

export default {
id: "慎行",
displayName: "慎行",
kind: "active",
description: "出牌阶段，你可以弃置两张牌，然后摸一张牌。",
canUse: (ctx: SkillModuleCtx, player: Player) => {
if (!player.alive || ctx.phase!== "出牌阶段") return false;
return player.hand.length >= 2;
},
play: async (ctx: SkillModuleCtx, player: Player) => {
const logs: string[] = [];
const sources = ctx
.buildUsableSources(player, "all")
.filter((s) => s.origin === "hand");
const discarded = await ctx.requestDiscardSelection(player, sources, 2, logs);
if (discarded.length < 2) {
logs.push(`${player.name} 发动失败：未弃足两张牌`);
return logs;
}
for (const card of discarded) {
ctx.discardPile.push(card);
}
ctx.drawCards(player.id, 1);
logs.push(
`${player.name} 发动，弃置 ${discarded.map((c) => `${c.type}${c.rank}`).join("、")}，摸一张牌`,
);
return logs;
},
} satisfies SkillModule;
