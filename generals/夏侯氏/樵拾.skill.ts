import type {
SkillEventPayload,
SkillModule,
SkillModuleCtx,
} from "../../../types/generals-pack.js";

// 樵拾（夏侯氏）— 触发技，end_phase_start（全局钩子）。
//
// 规则（一将成名2015 / 经典版，三国杀官网 2016 攻略与 BWIKI 夏侯氏页）：
// 其他角色的结束阶段开始时，若其手牌数等于你，你可以令你与其各摸一张牌。
// 燕语（重铸杀+出牌阶段结束时令男性角色摸牌）不在队列内，未实现，见 general.md。
//
// 实现要点：
// - end_phase_start 钩子 + globalHook：监听所有角色的结束阶段入口；actor 为当前回合角色。
// - 条件：actor 不是持有者本人（其他角色）+ actor 存活 + 双方手牌数相等；
// 钩子内用 ctx.players.find(hasSkill) 定位持有者（全局钩子须自行定位）。
// - 可选发动：条件满足后走 shouldActivateOptionalEffect 询问；双方各摸一张牌。
// - 结束阶段入口在弃牌阶段之后，手牌数按弃牌后的实际数量比较，与官方时机一致。

const SKILL_ID = "夏侯氏/樵拾";

export default {
id: "樵拾",
displayName: "樵拾",
kind: "triggered",
triggers: ["end_phase_start"],
globalHook: true,
optional: true,
description:
"其他角色的结束阶段开始时，若其手牌数等于你，你可以令你与其各摸一张牌。",
onTrigger: {
end_phase_start: async (
ctx: SkillModuleCtx,
payload: SkillEventPayload,
logs: string[],
): Promise<void> => {
const actor = payload.actor;
if (!actor ||!actor.alive) return;
const holder = ctx.players.find((p) => p.alive && ctx.hasSkill(p, SKILL_ID));
if (!holder) return;
if (actor.id === holder.id) return;
if (actor.hand.length!== holder.hand.length) return;
if (!(await ctx.shouldActivateOptionalEffect(holder, SKILL_ID))) return;
const count = actor.hand.length;
ctx.drawCards(holder.id, 1);
ctx.drawCards(actor.id, 1);
logs.push(
`${holder.name} 发动【樵拾】：${actor.name} 的手牌数（${count}）与自己相等，各摸一张牌`,
);
},
},
} satisfies SkillModule;
