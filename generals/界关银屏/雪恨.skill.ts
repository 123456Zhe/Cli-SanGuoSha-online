import type {
Player,
SkillModule,
SkillModuleCtx,
} from "../../../types/generals-pack.js";

// 雪恨（界关银屏）— 主动技能，出牌阶段限一次。
//
// 规则（桌游志91期）：出牌阶段限一次，你可以弃置一张红色牌，然后选择至多X名角色，横置这些角色并对其中一名角色造成1点火焰伤害（X为你已损失的体力值且至少为1）。
//
// 实现要点：
// - 限一次：`canUse` 查 `ctx.skillUsedThisTurn`（plain "雪恨"，与飞军同一约定），`play` 里 `ctx.markSkillUsed`。
// - 代价：弃置一张红色手牌（`buildUsableSources` 过滤 origin=hand 且 color=red；无红手牌时 `canUse` 为 false；弃掉的牌调用方用 `ctx.discardCards` 置入弃牌堆，与飞军同一约定）。
// - X = max(1, 已损失体力值)，满血时 X=1（FAQ 确认满血可发动）。
// - 玩家选一名角色为伤害目标（`getTargets` + `play(targetId)` 单目标）；其余至多 X-1 名横置角色由技能自动挑选（见已知限制）。
// - 横置：`chained` 字段直接赋值；已横置者按 FAQ 视为少指定一名，故自动挑选只选未横置者。
// - 火焰伤害：`ctx.applyDamage(..., "fire")`，随后 `resolveDeaths` → `resolveWinner` → `advanceIfCurrentPlayerDead`（与文档的伤害后结算约定一致）。

function lostHp(p: Player): number {
return p.maxHp - p.hp;
}

export default {
id: "雪恨",
displayName: "雪恨",
kind: "active",
description:
"出牌阶段限一次，你可以弃置一张红色牌，然后选择至多X名角色，横置这些角色并对其中一名角色造成1点火焰伤害（X为你已损失的体力值且至少为1）。",
requiresTarget: true,
targetIntent: "enemy",
canUse: (ctx: SkillModuleCtx, player: Player) => {
if (!player.alive || ctx.phase!== "出牌阶段") return false;
if (ctx.skillUsedThisTurn.get(player.id)?.has("雪恨")) return false;
if (!player.hand.some((c) => c.color === "red")) return false;
return ctx.players.some((p) => p.alive && p.id!== player.id);
},
getTargets: (ctx: SkillModuleCtx, player: Player) =>
ctx.players.filter((p) => p.alive && p.id!== player.id).map((p) => p.id),
play: async (ctx: SkillModuleCtx, player: Player, targetId?: string) => {
const logs: string[] = [];
const target = ctx.players.find((p) => p.id === targetId);
if (!target ||!target.alive) {
logs.push(`${player.name} 发动雪恨失败：未选中有效角色`);
return logs;
}
const redHandSources = ctx
.buildUsableSources(player)
.filter((s) => s.origin === "hand" && s.card?.color === "red");
const [discarded] = await ctx.requestDiscardSelection(
player,
1,
"雪恨：弃置一张红色牌",
redHandSources,
);
if (!discarded) {
logs.push(`${player.name} 发动雪恨失败：未弃置红色牌`);
return logs;
}
await ctx.discardCards([discarded], player, "弃置", logs);
const x = Math.max(1, lostHp(player));
const chained: Player[] = [target];
(target as unknown as Record<string, unknown>).chained = true;
for (const cand of ctx.players) {
if (chained.length >= x) break;
if (!cand.alive || cand.id === target.id || cand.id === player.id) continue;
if (cand.chained) continue;
(cand as unknown as Record<string, unknown>).chained = true;
chained.push(cand);
}
ctx.markSkillUsed(player.id, "雪恨");
logs.push(
`${player.name} 发动，弃置红色牌，横置 ${chained.map((p) => p.name).join("、")}，对 ${target.name} 造成 1 点火焰伤害`,
);
await ctx.applyDamage(player, target, 1, "雪恨", logs, undefined, "fire");
const deathLogs = await ctx.resolveDeaths();
logs.push(...deathLogs);
const winners = ctx.resolveWinner();
if (winners.length > 0) {
await ctx.advanceIfCurrentPlayerDead(logs);
}
return logs;
},
} satisfies SkillModule;
