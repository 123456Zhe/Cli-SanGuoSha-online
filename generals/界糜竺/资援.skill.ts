import type {
Card,
Player,
SkillModule,
SkillModuleCtx,
} from "../../../types/generals-pack.js";

// 资援（界糜竺）— 主动技能，出牌阶段限一次。
//
// 规则：出牌阶段限一次，你可以将任意张点数之和为13的手牌交给一名其他角色，然后该角色回复1点体力。
//
// 实现要点：
// - 限一次：`canUse` 查 `ctx.skillUsedThisTurn`（plain "资援"，与飞军同一约定），`play` 里 `ctx.markSkillUsed`。
// - 子集自动挑选：无按点数和选子集的交互，故自动挑选点数之和恰为13的手牌子集（张数最少者；并列取枚举顺序首个）；无合法子集时 `canUse` 为 false。
// - 给牌：子集牌用 `removeHandCardAt` 逐张移出手牌（触发失去手牌钩子），再 push 到目标手牌；仅手牌可给，木牛内牌不给（FAQ）。
// - 回血：引擎无回血接口，直接改 `hp` 并封顶到 maxHp（满血目标回血无效果，与 FAQ 一致）；出牌阶段使用、目标非濒死，无需死亡结算。

/** 在手牌中找点数之和恰为13的子集（张数最少者；无则返回 null）。 */
function findThirteenSubset(hand: Card[]): Card[] | null {
const n = hand.length;
let best: Card[] | null = null;
const total = 1 << n;
for (let mask = 0; mask < total; mask += 1) {
const subset: Card[] = [];
let sum = 0;
for (let i = 0; i < n; i += 1) {
if (mask & (1 << i)) {
subset.push(hand[i]);
sum += hand[i].rank;
}
}
if (sum!== 13) continue;
if (best === null || subset.length < best.length) {
best = subset;
}
}
return best;
}

function fmt(c: Card): string {
return `${c.type}${c.rank}`;
}

export default {
id: "资援",
displayName: "资援",
kind: "active",
description:
"出牌阶段限一次，你可以将任意张点数之和为13的手牌交给一名其他角色，然后该角色回复1点体力。",
requiresTarget: true,
targetIntent: "ally",
canUse: (ctx: SkillModuleCtx, player: Player) => {
if (!player.alive || ctx.phase!== "出牌阶段") return false;
if (ctx.skillUsedThisTurn.get(player.id)?.has("资援")) return false;
if (findThirteenSubset(player.hand) === null) return false;
return ctx.players.some((p) => p.alive && p.id!== player.id);
},
getTargets: (ctx: SkillModuleCtx, player: Player) =>
ctx.players.filter((p) => p.alive && p.id!== player.id).map((p) => p.id),
play: async (ctx: SkillModuleCtx, player: Player, targetId?: string) => {
const logs: string[] = [];
const target = ctx.players.find((p) => p.id === targetId);
if (!target ||!target.alive) {
logs.push(`${player.name} 发动资援失败：未选中有效角色`);
return logs;
}
const subset = findThirteenSubset(player.hand);
if (subset === null) {
logs.push(`${player.name} 发动资援失败：手牌中无点数之和为13的子集`);
return logs;
}
// 按手牌下标降序逐张移出（避免下标移位），再交给目标。
const subsetIds = new Set(subset.map((c) => c.id));
const indices: number[] = [];
player.hand.forEach((c, i) => {
if (subsetIds.has(c.id)) indices.push(i);
});
indices.sort((a, b) => b - a);
const given: Card[] = [];
for (const i of indices) {
const card = await ctx.removeHandCardAt(player, i, logs);
if (card) given.push(card);
}
target.hand.push(...given);
const beforeHp = target.hp;
(target as unknown as Record<string, unknown>).hp = Math.min(
target.maxHp,
target.hp + 1,
);
ctx.markSkillUsed(player.id, "资援");
logs.push(
`${player.name} 发动，将 ${given.map(fmt).join("、")} 交给 ${target.name}，${target.name}回复 1 点体力（${beforeHp}→${target.hp}）`,
);
return logs;
},
} satisfies SkillModule;
