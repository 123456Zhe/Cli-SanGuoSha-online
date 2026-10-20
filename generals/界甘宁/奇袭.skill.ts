// 奇袭（界甘宁）— 主动代码技能。
//
// 规则：出牌阶段，你可以将一张黑色牌当使用。
//
// 实现：主动技能（`kind: "active"`），`requiresTarget: true` 由引擎提供交互式选目标；
// 玩家从自己的黑色手牌里选一张弃置（`choose-discard`，所选牌由调用方手动置入弃牌堆），
// 然后弃置目标角色区域里的一张牌。
//
// 引擎限制：`choose-discard` 只能选给定 `sources` 列表里的牌，装备区牌没有来源，
// 因此"被弃置的那张牌"走 `ctx.removeRandomCardFromPlayer(target, "弃置")`
// （手牌/装备区随机一张，seed 可复现）；官方是"由你选择弃置目标区域里的一张牌"，
// 本实现简化为随机，见 general.md。
//
// 注意：只 `import type`，类型信息运行时被完全擦除，故这个相对路径不影响实际加载。
import type { SkillModule, SkillModuleCtx} from "../../../types/generals-pack.js";
import type { Player} from "../../../types/generals-pack.js";

/** 玩家手牌里的黑色牌来源（奇袭只能用手牌，不含木牛流马里的牌）。 */
const blackHandSources = (ctx: SkillModuleCtx, player: Player) =>
ctx.buildUsableSources(player).filter(
(source) => source.origin === "hand" && source.card?.color === "black",
);

export default {
id: "奇袭",
displayName: "奇袭",
kind: "active",
requiresTarget: true,
targetIntent: "enemy",
label: "发动奇袭（弃一张黑色手牌，弃置一名其他角色一张牌）",
description:
"出牌阶段，你可以将一张黑色手牌当使用，弃置一名其他角色区域里的一张牌（被弃的牌由引擎随机选择）。",
canUse: (ctx: SkillModuleCtx, player: Player) =>
player.hand.some((card) => card.color === "black"),
getTargets: (ctx: SkillModuleCtx, player: Player) =>
ctx.players
.filter((candidate) => candidate.alive && candidate.id!== player.id)
.map((candidate) => candidate.id),
play: async (ctx: SkillModuleCtx, player: Player, targetId?: string) => {
const target = ctx.players.find((candidate) => candidate.id === targetId && candidate.alive);
if (!target) {
return [`${player.name} 发动奇袭失败：目标不合法`];
}
const sources = blackHandSources(ctx, player);
if (sources.length === 0) {
return [`${player.name} 发动奇袭失败：没有黑色手牌`];
}
const decision = await ctx.decide({
kind: "choose-discard",
requestId: ctx.nextInteractionId(),
playerId: player.id,
reason: "奇袭：选择一张黑色手牌当使用",
sources,
count: 1,
allowPass: false,
});
if (decision.choice!== "card") {
return [`${player.name} 发动奇袭失败：未选择黑色手牌`];
}
// requestDiscardSelection / choose-discard 返回的牌不会自动进弃牌堆，调用方手动置入。
const removed = await ctx.removeUsableCardBySourceId(player, decision.sourceId);
const logs: string[] = [];
if (!removed) {
logs.push(`${player.name} 发动奇袭失败：所选牌已不在手牌中`);
return logs;
}
ctx.discardPile.push(removed);
logs.push(`${player.name} 将一张黑色手牌当使用，指定 ${target.name}`);
logs.push(...(await ctx.removeRandomCardFromPlayer(target, "弃置", undefined)));
return logs;
},
} satisfies SkillModule;
