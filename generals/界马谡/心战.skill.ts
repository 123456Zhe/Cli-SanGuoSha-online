import type {
Player,
SkillModule,
SkillModuleCtx,
} from "../../../types/generals-pack.js";

// 心战（界马谡）— 主动技能，出牌阶段限一次。
//
// 规则（一将成名）：出牌阶段，若你的手牌数大于你的体力上限，你可以观看牌堆顶的三张牌，然后展示其中任意数量♥的牌并获得之，其余以任意顺序置于牌堆顶。每回合限一次。
//
// 实现要点：
// - 限一次：`canUse` 查 `ctx.skillUsedThisTurn`（plain "心战"，与飞军同一约定），`play` 里 `ctx.markSkillUsed`。
// - 条件：手牌数 > 体力上限（maxHp）。
// - 观看牌堆顶三张：`ctx.drawTopCards(3)`（取走牌堆顶；心战的获得/放回与取走等价）。
// - 红桃自动全取："任意数量"的一合法选择（全部红桃）；其余原序 `placeCardsOnTop`（"任意顺序"的一合法选择）。
// - 日志不点名非红桃牌：牌堆顶顺序是隐藏信息，点名等于公开牌堆顶（2026-11-09 巡检报的泄牌 bug）；
//   只记"看了几张、获得哪些红桃、其余几张放回"（获得的红桃是展示过的，可以点名）。
// - 无目标：不设 `requiresTarget` / `getTargets`。

export default {
id: "心战",
displayName: "心战",
kind: "active",
description:
"出牌阶段，若你的手牌数大于你的体力上限，你可以观看牌堆顶的三张牌，然后展示其中任意数量♥的牌并获得之，其余以任意顺序置于牌堆顶。每回合限一次。",
canUse: (ctx: SkillModuleCtx, player: Player) => {
if (!player.alive || ctx.phase!== "出牌阶段") return false;
if (ctx.skillUsedThisTurn.get(player.id)?.has("心战")) return false;
return player.hand.length > player.maxHp;
},
play: async (ctx: SkillModuleCtx, player: Player) => {
const logs: string[] = [];
const revealed = ctx.drawTopCards(3);
if (revealed.length === 0) {
logs.push(`${player.name} 发动【心战】，但牌堆顶无牌`);
return logs;
}
const hearts = revealed.filter((c) => c.suit === "heart");
const rest = revealed.filter((c) => c.suit!== "heart");
player.hand.push(...hearts);
ctx.placeCardsOnTop(rest);
ctx.markSkillUsed(player.id, "心战");
logs.push(
`${player.name} 发动【心战】，观看牌堆顶 ${revealed.length} 张牌，获得红桃 ${hearts.map((c) => `${c.type}${c.rank}`).join("、") || "无"}，其余 ${rest.length} 张置于牌堆顶`,
);
return logs;
},
} satisfies SkillModule;
