import type {
Player,
SkillEventPayload,
SkillModule,
SkillModuleCtx,
} from "../../../types/generals-pack.js";

// 倾势（魏杜预）— 触发技，card_used。
//
// 规则（三国杀官网 2024-01-31 更新公告与 BWIKI 倾势页）：
// 当你于回合内使用【杀】或锦囊牌指定目标后，若此牌为你本回合使用的第X张牌
// （X为你的手牌数），你可以对一名其他目标角色造成1点伤害。
//
// 实现要点：
// - card_used 钩子，条件：reason="使用"（打出不算）+ 回合内（当前回合角色为持有者）
// + 牌为杀/锦囊 + payload.targets 含其他角色。targets 字段由引擎 2026-11-14 提交
// （153b377）提供；旧引擎上该字段缺失，技能不触发（生产 host 须先拉新引擎并重启）。
// - 本回合用牌计数：模块级 WeakMap<Player, number>（以本局 Player 对象为键，不跨局泄漏）；
// turn_start（持有者回合开始）清零；每次 card_used（使用）+1；与结算时手牌数比较，
// 相等即满足"第X张牌"。计数含所有使用过的牌（桃/酒/装备也计入），只计"使用"不计"打出"。
// - 伤害目标：targets 中除自己外的第一名（id 升序），自动挑选，见 general.md。
// - 伤害走 ctx.applyDamage；不单独结算死亡——card_used 在 resolveUsedCard 结算前发出，
// 原牌结算后引擎统一走 resolveDeaths，濒死/胜负由其处理（见 general.md）。
// - 可选发动：条件满足后走 shouldActivateOptionalEffect 询问。

const SKILL_ID = "魏杜预/倾势";

/** 杀 + 全部锦囊（普通锦囊与延时锦囊；无中生有/无懈可击会被目标/原因检查另行排除）。 */
const QINGSHI_CARD_TYPES = new Set([
"杀",
"火杀",
"雷杀",
"过河拆桥",
"顺手牵羊",
"决斗",
"无中生有",
"南蛮入侵",
"万箭齐发",
"借刀杀人",
"无懈可击",
"桃园结义",
"五谷丰登",
"火攻",
"铁索连环",
"乐不思蜀",
"兵粮寸断",
"闪电",
]);

/** 本回合已使用牌数（仅"使用"，不计"打出"），持有者回合开始时清零。 */
const usedThisTurn = new WeakMap<Player, number>();

export default {
id: "倾势",
displayName: "倾势",
kind: "triggered",
triggers: ["turn_start", "card_used"],
optional: true,
description:
"当你于回合内使用【杀】或锦囊牌指定目标后，若此牌为你本回合使用的第X张牌（X为你的手牌数），你可以对一名其他目标角色造成1点伤害。",
onTrigger: {
turn_start: (ctx: SkillModuleCtx, payload: SkillEventPayload, _logs: string[]): void => {
const actor = payload.actor;
if (!actor ||!ctx.hasSkill(actor, SKILL_ID)) return;
usedThisTurn.set(actor, 0);
},
card_used: async (
ctx: SkillModuleCtx,
payload: SkillEventPayload,
logs: string[],
): Promise<void> => {
const actor = payload.actor;
if (!actor ||!actor.alive) return;
if (!ctx.hasSkill(actor, SKILL_ID)) return;
if (payload.reason!== "使用") return;
// 回合内：当前回合角色须为持有者（借刀杀人等他人回合内的使用不计）。
if (ctx.currentPlayer.id!== actor.id) return;
const count = (usedThisTurn.get(actor)?? 0) + 1;
usedThisTurn.set(actor, count);
const card = payload.card;
if (!card ||!QINGSHI_CARD_TYPES.has(card.type)) return;
const targets = payload.targets?? [];
const victims = targets.filter((t) => t.id!== actor.id && t.alive);
if (victims.length === 0) return;
// X 为结算时手牌数（用牌已离手，hand.length 即 X）。
if (count!== actor.hand.length) return;
if (!(await ctx.shouldActivateOptionalEffect(actor, SKILL_ID))) return;
const victim = victims.sort((a, b) => (a.id < b.id? -1: 1))[0];
if (!victim) return;
logs.push(
`${actor.name} 发动【倾势】：本回合第 ${count} 张牌（手牌数 ${actor.hand.length}），对 ${victim.name} 造成 1 点伤害`,
);
await ctx.applyDamage(actor, victim, 1, "倾势", logs, card);
},
},
} satisfies SkillModule;
