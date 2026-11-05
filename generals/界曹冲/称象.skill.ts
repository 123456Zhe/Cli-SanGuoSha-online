import type {
Card,
SkillModule,
SkillModuleCtx,
} from "../../../types/generals-pack.js";

// 称象（界曹冲）— 触发技能。
//
// 规则（一将成名2014）：当你受到伤害后，你可以亮出牌堆顶的四张牌，然后你获得其中的任意张点数之和不大于13的牌。
// （2014版未明说余牌去向，按一将成名2013版"将其余的牌置入弃牌堆"处理。）
//
// 实现要点：
// - 触发点 after_damage，payload.target 为受伤者；用 ctx.hasSkill(target, "界曹冲/称象") 确认是曹冲受伤（镇卫同一约定）。
// - "你可以" → shouldActivateOptionalEffect 询问。
// - 亮牌堆顶四张：ctx.drawTopCards(4)（取走牌堆顶，引擎实现为连续 drawCard；称象的获得/弃置与取走等价）。
// - 子集自动挑选：无按点数约束选子集的交互，故自动挑选点数和最大且 ≤13 的子集（并列取张数多者，再并列按枚举顺序取首个）；其余置入弃牌堆。
// - 获得：直接 push 到手牌；其余：discardPile.push。
// - 无每回合次数限制，每次受伤均可触发。

/** 在全部子集中取点数和最大且 ≤13 者（并列取张数多者）。 */
function pickSubset(cards: Card[]): { kept: Card[]; rest: Card[]} {
const n = cards.length;
let best: Card[] = [];
let bestSum = 0;
const total = 1 << n;
for (let mask = 0; mask < total; mask += 1) {
const subset: Card[] = [];
let sum = 0;
for (let i = 0; i < n; i += 1) {
if (mask & (1 << i)) {
subset.push(cards[i]);
sum += cards[i].rank;
}
}
if (sum > 13) continue;
if (sum > bestSum || (sum === bestSum && subset.length > best.length)) {
best = subset;
bestSum = sum;
}
}
const keptIds = new Set(best.map((c) => c.id));
const rest = cards.filter((c) =>!keptIds.has(c.id));
return { kept: best, rest};
}

function fmt(c: Card): string {
return `${c.type}${c.rank}`;
}

export default {
id: "称象",
displayName: "称象",
kind: "triggered",
description:
"当你受到伤害后，你可以亮出牌堆顶的四张牌，然后你获得其中的任意张点数之和不大于13的牌。",
triggers: ["after_damage"],
onTrigger: {
after_damage: async (ctx: SkillModuleCtx, payload, logs: string[]) => {
const target = payload.target;
if (!target ||!target.alive) return;
if (!ctx.hasSkill(target, "界曹冲/称象")) return;
if (!(await ctx.shouldActivateOptionalEffect(target, "界曹冲/称象"))) return;
const revealed = ctx.drawTopCards(4);
if (revealed.length === 0) {
logs.push(`${target.name} 发动，但牌堆顶无牌`);
return;
}
const { kept, rest} = pickSubset(revealed);
target.hand.push(...kept);
ctx.discardPile.push(...rest);
logs.push(
`${target.name} 发动，亮出牌堆顶 ${revealed.map(fmt).join("、")}，获得 ${kept.map(fmt).join("、")}，其余置入弃牌堆`,
);
},
},
} satisfies SkillModule;
