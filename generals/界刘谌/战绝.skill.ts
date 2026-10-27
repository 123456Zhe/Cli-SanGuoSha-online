// 战绝（界刘谌）— 主动代码技能。
//
// 规则（界限突破）：出牌阶段，你可以将所有手牌当【决斗】使用，然后你和受伤的
// 角色各摸一张牌。若你此法摸过两张或更多的牌，则本回合"战绝"失效。
//
// 实现要点：
// - 代价：全部手牌（至少一张）。逐张 `removeUsableCardBySourceId`（手牌来源，
// 内部走 `removeHandCardAt`，触发连营等"失去手牌"钩子），调用方手动置入弃牌堆。
// - 决斗：`ctx.resolveDuel(player, target)`（内部已处理空城、无懈可击、轮流出杀、
// 伤害结算；无实体决斗牌，传 undefined）。
// - 伤害结算后自行 `resolveDeaths` → `resolveWinner` → `advanceIfCurrentPlayerDead`。
// - "受伤的角色"判定：决斗前后体力对比（`resolveDuel` 只返回日志不返回胜负）。
// - 目标受伤：刘谌摸 1 张，目标摸 1 张。
// - 刘谌受伤：刘谌摸 2 张（"你"1 张 + "受伤的角色"1 张），并累计满 2 张即失效。
// - 无人受伤（无懈可击抵消等）：刘谌仍摸 1 张（官方 FAQ）。
// - 失效计数：本回合刘谌经战绝摸牌累计数，存在
// `ctx.skillCountsThisTurn.get(player.id)` 的 `战绝摸牌` key 里（引擎每回合自动重置）。
// 累计 ≥ 2 时 `canUse` 返回 false。
//
// 注意：只 `import type`，类型信息运行时被完全擦除，故这个相对路径不影响实际加载。
import type { SkillModule, SkillModuleCtx} from "../../../types/generals-pack.js";
import type { Player} from "../../../types/generals-pack.js";

/** 本回合经战绝摸牌累计数。 */
const drawnViaZhanJue = (ctx: SkillModuleCtx, playerId: string): number =>
ctx.skillCountsThisTurn.get(playerId)?.get("战绝摸牌")?? 0;

const addDrawnViaZhanJue = (ctx: SkillModuleCtx, playerId: string, count: number): void => {
const counts = ctx.skillCountsThisTurn.get(playerId)?? new Map<string, number>();
counts.set("战绝摸牌", (counts.get("战绝摸牌")?? 0) + count);
ctx.skillCountsThisTurn.set(playerId, counts);
};

export default {
id: "战绝",
displayName: "战绝",
kind: "active",
requiresTarget: true,
targetIntent: "enemy",
label: "发动战绝（将全部手牌当决斗使用，结算后你和受伤的角色各摸一张牌）",
description:
"出牌阶段，你可以将所有手牌当【决斗】使用，然后你和受伤的角色各摸一张牌。若你此法摸过两张或更多的牌，则本回合战绝失效。",
canUse: (ctx: SkillModuleCtx, player: Player) => {
if (!player.alive || ctx.phase!== "出牌阶段") {
return false;
}
if (player.hand.length < 1) {
return false;
}
if (drawnViaZhanJue(ctx, player.id) >= 2) {
return false;
}
return ctx.players.some((p) => p.alive && p.id!== player.id);
},
getTargets: (ctx: SkillModuleCtx, player: Player) =>
ctx.players.filter((p) => p.alive && p.id!== player.id).map((p) => p.id),
play: async (ctx: SkillModuleCtx, player: Player, targetId?: string) => {
const logs: string[] = [];
const target = ctx.players.find((p) => p.id === targetId && p.alive);
if (!target) {
return [`${player.name} 发动战绝失败：目标不合法`];
}
if (player.hand.length < 1) {
return [`${player.name} 发动战绝失败：没有手牌`];
}
if (drawnViaZhanJue(ctx, player.id) >= 2) {
return [`${player.name} 发动战绝失败：本回合战绝已失效`];
}

// 步骤一：将全部手牌当【决斗】使用（手牌全部置入弃牌堆）。
const handCopy = [...player.hand];
for (const card of handCopy) {
const removed = await ctx.removeUsableCardBySourceId(player, `hand:${card.id}`);
if (removed) {
ctx.discardPile.push(removed);
}
}
logs.push(`${player.name} 发动战绝，将 ${handCopy.length} 张手牌当【决斗】对 ${target.name} 使用`);

// 步骤二：决斗结算 + 死亡/胜负结算。
const playerHpBefore = player.hp;
const targetHpBefore = target.hp;
logs.push(...(await ctx.resolveDuel(player, target)));
logs.push(...(await ctx.resolveDeaths()));
logs.push(...ctx.resolveWinner());
await ctx.advanceIfCurrentPlayerDead(logs);

// 步骤三：摸牌（"你和受伤的角色各摸一张牌"）。
const playerInjured = player.hp < playerHpBefore;
const targetInjured = target.hp < targetHpBefore;
let playerDrawn = 0;
if (player.alive) {
const drawn = ctx.drawCards(player.id, 1);
playerDrawn += drawn;
logs.push(`${player.name} 发动战绝摸 ${drawn} 张牌`);
}
if (targetInjured && target.alive) {
const drawn = ctx.drawCards(target.id, 1);
logs.push(`${target.name} 因战绝受伤，摸 ${drawn} 张牌`);
}
if (playerInjured && player.alive) {
// 刘谌自己就是"受伤的角色"，再摸 1 张。
const drawn = ctx.drawCards(player.id, 1);
playerDrawn += drawn;
logs.push(`${player.name} 既是发动者又是受伤者，再摸 ${drawn} 张牌`);
}
if (playerDrawn > 0) {
addDrawnViaZhanJue(ctx, player.id, playerDrawn);
if (drawnViaZhanJue(ctx, player.id) >= 2) {
logs.push(`${player.name} 本回合经战绝已摸 ${drawnViaZhanJue(ctx, player.id)} 张牌，战绝失效`);
}
}
return logs;
},
} satisfies SkillModule;
