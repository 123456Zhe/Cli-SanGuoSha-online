import type {
Player,
SkillModule,
SkillModuleCtx,
} from "../../../types/generals-pack.js";

// 谏国（魏杜预）— 主动技能，出牌阶段每项限一次。
//
// 规则（三国杀官网 2024-01-31 更新公告「调整后」与 BWIKI 杜预页当前版）：
// 出牌阶段每项限一次，你可以令一名角色 1.摸一张牌，然后弃置一半数量的手牌；
// 2.弃一张牌，然后摸当前手牌数一半数量的牌。（向上取整）
// 原版（2023）为「出牌阶段限一次……（向下取整）」，2024-01-31 调整为每项限一次、
// 向上取整；本包用现行版。
//
// 实现要点：
// - 两项各限一次：ctx.skillUsedThisTurn 里记 "魏杜预/谏国·摸弃" / "魏杜预/谏国·弃摸" 两个 key。
// - 引擎主动技能没有"二选一"交互，分支按目标自动选择（见 general.md 已知限制）：
// 目标是自己且手牌数 ≥ 2 → 弃1摸半（补给向）；其余 → 摸1弃半（削弱向）。
// - 弃牌均由目标本人选择（requestDiscardSelection 交互式询问）；弃掉的牌走 ctx.discardCards 置入弃牌堆（发 card_discarded 触发点）。
// - 弃牌只限手牌：传手牌来源过滤（`buildUsableSources` 只取 origin === "hand"），木牛流马内牌不可被当手牌弃掉
// （官方文本"弃置一半数量的手牌"/"弃一张牌"均指手牌；2026-11-16 巡检报的 bug）。
// 手牌来源须在弃牌当时取快照：摸弃分支先摸后弃，摸前快照会把刚摸的牌排除在外（2026-11-18 巡检回归）。
// - X 向上取整（Math.ceil），在第二步结算时按目标当时手牌数算。

const KEY_DRAW_DISCARD = "魏杜预/谏国·摸弃";
const KEY_DISCARD_DRAW = "魏杜预/谏国·弃摸";

type Branch = "draw-discard" | "discard-draw";

/** 按目标自动选分支：自己且手牌 ≥ 2 时补给（弃1摸半），其余削弱（摸1弃半）。 */
function branchFor(user: Player, target: Player): Branch {
if (target.id === user.id && target.hand.length >= 2) return "discard-draw";
return "draw-discard";
}

function branchKey(branch: Branch): string {
return branch === "draw-discard"? KEY_DRAW_DISCARD: KEY_DISCARD_DRAW;
}

function branchUsed(ctx: SkillModuleCtx, user: Player, branch: Branch): boolean {
return ctx.skillUsedThisTurn.get(user.id)?.has(branchKey(branch))?? false;
}

export default {
id: "谏国",
displayName: "谏国",
kind: "active",
description:
"出牌阶段每项限一次，你可以令一名角色摸一张牌，然后弃置一半数量的手牌；或令其弃置一张牌，然后摸当前手牌数一半数量的牌。（向上取整）",
requiresTarget: true,
targetIntent: "any",
canUse: (ctx: SkillModuleCtx, player: Player): boolean => {
if (!player.alive) return false;
return ctx.players.some(
(t) => t.alive &&!branchUsed(ctx, player, branchFor(player, t)),
);
},
getTargets: (ctx: SkillModuleCtx, player: Player): string[] =>
ctx.players
.filter((t) => t.alive &&!branchUsed(ctx, player, branchFor(player, t)))
.map((t) => t.id),
play: async (ctx: SkillModuleCtx, player: Player, targetId?: string): Promise<string[]> => {
const logs: string[] = [];
const target = ctx.players.find((p) => p.id === targetId);
if (!target ||!target.alive) {
logs.push(`${player.name} 发动【谏国】失败：未选中有效角色`);
return logs;
}
const branch = branchFor(player, target);
if (branchUsed(ctx, player, branch)) {
logs.push(`${player.name} 发动【谏国】失败：该项本回合已用过`);
return logs;
}
ctx.markSkillUsed(player.id, branchKey(branch));
if (branch === "draw-discard") {
const drawn = ctx.drawCards(target.id, 1);
// 谏国弃牌只限手牌：摸牌后再取手牌来源，木牛流马内牌不在候选里，
// 刚摸的牌此时已在手里、可弃（2026-11-18 巡检：摸前快照致 0 手牌目标弃 0 张）。
const handSources = ctx.buildUsableSources(target).filter((s) => s.origin === "hand");
const half = Math.ceil(target.hand.length / 2);
const discarded =
half > 0
? await ctx.requestDiscardSelection(target, half, "谏国：弃置一半数量的手牌", handSources)
: [];
for (const card of discarded) await ctx.discardCards([card], target, "弃置", logs);
logs.push(
`${player.name} 发动【谏国】：${target.name} 摸 ${drawn} 张牌，然后弃置 ${discarded.length} 张手牌`,
);
} else {
// 弃摸分支：弃牌在摸牌之前，此处取快照即可（同样只限手牌）。
const handSources = ctx.buildUsableSources(target).filter((s) => s.origin === "hand");
const discarded = await ctx.requestDiscardSelection(target, 1, "谏国：弃置一张牌", handSources);
for (const card of discarded) await ctx.discardCards([card], target, "弃置", logs);
const half = Math.ceil(target.hand.length / 2);
const drawn = half > 0? ctx.drawCards(target.id, half): 0;
logs.push(
`${player.name} 发动【谏国】：${target.name} 弃置 ${discarded.length} 张牌，然后摸 ${drawn} 张牌`,
);
}
return logs;
},
} satisfies SkillModule;
