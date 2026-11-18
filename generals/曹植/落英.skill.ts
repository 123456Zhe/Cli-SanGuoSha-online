import type {
SkillEventPayload,
SkillModule,
SkillModuleCtx,
} from "../../../types/generals-pack.js";

// 落英（曹植）— 触发技，card_discarded（全局钩子）。
//
// 规则（经典版/界限突破版相同，三国杀WIKI_BWIKI 曹植页）：
// 当其他角色的梅花牌因判定或弃置而进入弃牌堆时，你可以获得之。
// 酒诗不在队列内，未实现，见 general.md。
//
// 实现要点：
// - card_discarded 钩子 + globalHook：监听所有角色因弃置/判定入堆的牌；
// 钩子内用 ctx.players.find(hasSkill) 定位持有者（全局钩子须自行定位）。
// - 条件：牌的花色为梅花 + 牌的原主不是持有者本人（其他角色）+ 牌仍在弃牌堆中
// （多曹植同局时先获得者已取走，后触发者须跳过；先查弃牌堆再询问，避免无效提问）。
// - 可选发动：条件满足后走 shouldActivateOptionalEffect 询问；获得时按 id 从弃牌堆
// splice 取出并 push 进持有者手牌（与内置天妒同一取牌方式）。
// - 依赖 Phase 10 引擎：card_discarded 触发点 + discardCards 中央入口；旧引擎上不触发。
// - 已知顺序：判定牌在判定结算前即入堆，落英先于天妒获得是既定顺序（见 docs）。

const SKILL_ID = "曹植/落英";

export default {
id: "落英",
displayName: "落英",
kind: "triggered",
triggers: ["card_discarded"],
globalHook: true,
optional: true,
description:
"当其他角色的梅花牌因判定或弃置而进入弃牌堆时，你可以获得之。",
onTrigger: {
card_discarded: async (
ctx: SkillModuleCtx,
payload: SkillEventPayload,
logs: string[],
): Promise<void> => {
const actor = payload.actor;
const card = payload.card;
if (!actor ||!card) return;
if (card.suit!== "club") return;
const holder = ctx.players.find((p) => p.alive && ctx.hasSkill(p, SKILL_ID));
if (!holder) return;
if (actor.id === holder.id) return;
const index = ctx.discardPile.findIndex((item) => item.id === card.id);
if (index < 0) return;
if (!(await ctx.shouldActivateOptionalEffect(holder, SKILL_ID))) return;
const [taken] = ctx.discardPile.splice(index, 1);
if (!taken) return;
holder.hand.push(taken);
logs.push(
`${holder.name} 发动【落英】，获得 ${actor.name} ${payload.reason === "判定" ? "判定" : "弃置"}的梅花牌`,
);
},
},
} satisfies SkillModule;
