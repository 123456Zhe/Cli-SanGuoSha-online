import type {
Player,
SkillModule,
SkillModuleCtx,
} from "../../../types/generals-pack.js";

// 甘露（界吴国太）— 主动技能，出牌阶段限一次。
//
// 规则（一将成名）：出牌阶段限一次，你可以选择两名装备区里的牌数之差不大于你已损失体力值的角色，交换他们装备区里的牌。
//
// 实现要点：
// - 限一次：`canUse` 查 `ctx.skillUsedThisTurn`，`play` 里 `ctx.markSkillUsed`。
// - 引擎主动技能只支持单目标选择（`getTargets` + `play(targetId)`），故玩家选第一名角色后，第二名角色由技能自动挑选（见已知限制）。
// - 第二名角色自动挑选口径：满足 |装备数之差| ≤ 吴国太已损失体力值 的其他存活角色中，装备数最多者；并列 id 升序。
// - 目标条件在 `getTargets` 与 `play` 里双重校验（play 时重算，避免选择与结算之间状态变化导致非法交换）。
// - 交换范围：武器/防具/防御马/进攻马/宝物五个槽位 + 木牛流马内牌（`treasureCards` 跟随宝物交换）。
// - 装备交换用槽位直接赋值（与飞军弃装备同一约定），不触发 `equip_lost` / 装备获得钩子。

type EquipSlot = "weapon" | "armor" | "defenseHorse" | "attackHorse" | "treasure";
const EQUIP_SLOTS: EquipSlot[] = ["weapon", "armor", "defenseHorse", "attackHorse", "treasure"];

function equipCount(p: Player): number {
let n = 0;
for (const slot of EQUIP_SLOTS) {
if ((p as unknown as Record<string, unknown>)[slot]!= null) n += 1;
}
return n;
}

function lostHp(p: Player): number {
return p.maxHp - p.hp;
}

/** 在满足条件的其他存活角色中按口径挑一名（无满足者返回 undefined）。 */
function validPartner(ctx: SkillModuleCtx, user: Player, a: Player): Player | undefined {
const limit = lostHp(user);
const aCount = equipCount(a);
let best: Player | undefined;
let bestCount = -1;
for (const cand of ctx.players) {
if (!cand.alive || cand.id === a.id) continue;
if (Math.abs(equipCount(cand) - aCount) > limit) continue;
const c = equipCount(cand);
if (c > bestCount || (c === bestCount && best!== undefined && cand.id < best.id)) {
best = cand;
bestCount = c;
}
}
return best;
}

export default {
id: "甘露",
displayName: "甘露",
kind: "active",
description:
"出牌阶段限一次，你可以选择两名装备区里的牌数之差不大于你已损失体力值的角色，交换他们装备区里的牌。",
requiresTarget: true,
targetIntent: "any",
canUse: (ctx: SkillModuleCtx, player: Player) => {
if (!player.alive) return false;
if (ctx.skillUsedThisTurn.get(player.id)?.has("界吴国太/甘露")) return false;
for (const a of ctx.players) {
if (!a.alive) continue;
if (validPartner(ctx, player, a)) return true;
}
return false;
},
getTargets: (ctx: SkillModuleCtx, player: Player) =>
ctx.players
.filter((a) => a.alive && validPartner(ctx, player, a)!== undefined)
.map((a) => a.id),
play: async (ctx: SkillModuleCtx, player: Player, targetId?: string) => {
const logs: string[] = [];
const a = ctx.players.find((p) => p.id === targetId);
if (!a ||!a.alive) {
logs.push(`${player.name} 发动甘露失败：未选中有效角色`);
return logs;
}
const b = validPartner(ctx, player, a);
if (!b) {
logs.push(`${player.name} 发动甘露失败：没有满足条件的第二名角色`);
return logs;
}
const diff = Math.abs(equipCount(a) - equipCount(b));
for (const slot of EQUIP_SLOTS) {
const recA = a as unknown as Record<string, unknown>;
const recB = b as unknown as Record<string, unknown>;
const tmp = recA[slot];
recA[slot] = recB[slot];
recB[slot] = tmp;
}
const tmpCards = a.treasureCards;
(a as unknown as Record<string, unknown>).treasureCards = b.treasureCards;
(b as unknown as Record<string, unknown>).treasureCards = tmpCards;
ctx.markSkillUsed(player.id, "界吴国太/甘露");
logs.push(
`${player.name} 发动：交换 ${a.name} 与 ${b.name} 装备区里的牌（装备数之差 ${diff}，已损失体力 ${lostHp(player)}）`,
);
return logs;
},
} satisfies SkillModule;
