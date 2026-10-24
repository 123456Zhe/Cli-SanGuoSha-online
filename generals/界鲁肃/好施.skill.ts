// 好施（界鲁肃）— 触发性代码技能，挂 `before_draw` 事件钩子。
//
// 规则（界限突破）：摸牌阶段，你可以额外摸两张牌，然后将两张手牌交给一名
// 手牌最少的其他角色。
//
// 实现要点：
// - "额外摸两张"：在 before_draw 钩子里直接 `ctx.drawCards(actor.id, 2)`（走
// 绝境同路），不改 payload.drawCount，随后引擎仍正常执行摸牌阶段摸牌。
// - "将两张手牌交给"：用 `requestDiscardSelection`（手牌来源限定）选两张牌；
// 该函数内部已 `removeUsableCardBySourceId` 移出手牌（触发连营等"失去手牌"
// 钩子），调用方不进弃牌堆、改为 `target.hand.push` 交给目标。
// - 目标自动挑选：手牌最少者（并列取 id 升序首位），与荀彧「节命」同口径。
//
// 引擎限制（general.md 如实记录）：
// - 界版好施的后续绑定效果（成为/单体锦囊目标时对方可给你牌）暂不支持——
// 锦囊指定目标没有对应钩子（只有 `slash_targeted`），部分实现反而误导，
// 故整段略去。
//
// 注意：只 `import type`，类型信息运行时被完全擦除，故这个相对路径不影响实际加载。
import type { SkillModule, SkillModuleCtx} from "../../../types/generals-pack.js";
import type { Player} from "../../../types/generals-pack.js";

/** 手牌最少者（并列取 id 升序首位，保证 seed 可复现）。 */
const pickFewestHand = (ctx: SkillModuleCtx, actor: Player): Player | undefined => {
const others = ctx.players.filter((p) => p.alive && p.id!== actor.id);
if (others.length === 0) {
return undefined;
}
const minCount = Math.min(...others.map((p) => p.hand.length));
return others
.filter((p) => p.hand.length === minCount)
.sort((a, b) => (a.id < b.id? -1: a.id > b.id? 1: 0))[0];
};

export default {
id: "好施",
displayName: "好施",
kind: "triggered",
description:
"摸牌阶段，你可以额外摸两张牌，然后将两张手牌交给一名手牌最少的其他角色（界版绑定效果暂不支持）。",
triggers: ["before_draw"],
onTrigger: {
before_draw: async (ctx, payload, logs) => {
const actor = payload.actor;
if (!actor ||!actor.alive) {
return;
}
if (!ctx.hasSkill(actor, "界鲁肃/好施")) {
return;
}
if (!(await ctx.shouldActivateOptionalEffect(actor, "界鲁肃/好施"))) {
return;
}
const drawn = ctx.drawCards(actor.id, 2);
logs.push(`${actor.name} 发动好施，额外摸 ${drawn} 张牌`);
const target = pickFewestHand(ctx, actor);
if (!target) {
logs.push(`${actor.name} 发动好施，但没有其他存活角色可给牌`);
return;
}
const handSources = ctx.buildUsableSources(actor).filter((s) => s.origin === "hand");
const given = await ctx.requestDiscardSelection(
actor,
2,
`好施：选择两张手牌交给${target.name}`,
handSources,
);
for (const card of given) {
target.hand.push(card);
}
logs.push(`${actor.name} 将 ${given.length} 张手牌交给${target.name}（${target.name}手牌 ${target.hand.length} 张）`);
},
},
} satisfies SkillModule;
