import type {
Player,
SkillModule,
SkillModuleCtx,
} from "../../../types/generals-pack.js";

// 弘援（诸葛瑾）— 触发技能，摸牌阶段。
//
// 规则（王者之战2019 / 将星归汉、OL 版）：摸牌阶段，你可以少摸一张牌，然后令至多两名其他角色各摸一张牌。
// （2024珍藏版改版为“每阶段限一次，当你一次获得至少两张牌后，你可以将至多两张牌交给等量名其他角色各一张”，无获得牌触发点且需多目标给牌，引擎做不了，未采用。）
//
// 实现要点：
// - 触发点 `before_draw`：仅当摸牌者为技能持有者时生效；`shouldActivateOptionalEffect` 确认后改写 `payload.drawCount`（-1，最少 0）。
// - 令至多两名其他角色各摸一张：无交互选人，自动挑至多两名其他存活角色（id 顺序），各 `drawCards(..., 1)`。
// - 须摸牌数 ≥1 才可发动（否则无牌可少摸）。

export default {
id: "弘援",
displayName: "弘援",
kind: "triggered",
description:
"摸牌阶段，你可以少摸一张牌，然后令至多两名其他角色各摸一张牌。",
triggers: ["before_draw"],
onTrigger: {
before_draw: async (ctx: SkillModuleCtx, payload: { player?: Player; drawCount?: number}) => {
const logs: string[] = [];
const player = payload.player;
if (!player ||!player.alive) return logs;
if (!ctx.hasSkill(player, "诸葛瑾/弘援")) return logs;
const count = payload.drawCount?? 0;
if (count < 1) return logs;
if (!(await ctx.shouldActivateOptionalEffect(player, "诸葛瑾/弘援"))) return logs;
payload.drawCount = count - 1;
const others = ctx.players
.filter((p) => p.alive && p.id!== player.id)
.slice(0, 2);
for (const target of others) {
ctx.drawCards(target.id, 1);
}
logs.push(
`${player.name} 发动，少摸一张牌，${others.map((p) => p.name).join("、") || "无其他角色"}各摸一张牌`,
);
return logs;
},
},
} satisfies SkillModule;
