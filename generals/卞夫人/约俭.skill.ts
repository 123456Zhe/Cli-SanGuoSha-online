import type {
Player,
SkillModule,
SkillModuleCtx,
} from "../../../types/generals-pack.js";

// 约俭（卞夫人）— 锁定技（手牌上限）+ 濒死触发技。
//
// 规则（Fandom 卞夫人页，将星归汉·零八、移动版）：
// 你的手牌上限等于你的体力上限；当你进入濒死状态时，你可以弃置两张牌，然后回复1点体力。
//
// 实现要点：
// - 手牌上限：`handLimit` 纯函数返回 maxHp - hp（与神赵云绝境同一写法），
// 上限 = 体力 + (体力上限 - 体力) = 体力上限。
// - 濒死分支：`dying` 钩子；手牌不足 2 张时不发动；弃置用 requestDiscardSelection
// （不传预置 sources，让引擎每轮重建来源，避免 count>1 时复用旧列表踩到已移走的牌，
// 与结姻同口径）；弃置成功后回复 1 点体力（封顶体力上限）。
// - 限制：弃置仅限手牌与木牛内牌（buildUsableSources 默认范围，装备区不在候选里）；
// 本技能无次数限制，每次进入濒死都可发动（官方文本如此）。

const SKILL_ID = "卞夫人/约俭";

export default {
id: "约俭",
displayName: "约俭",
kind: "triggered",
description:
"你的手牌上限等于你的体力上限；当你进入濒死状态时，你可以弃置两张牌，然后回复1点体力。",
triggers: ["dying"],
handLimit: (player: Player) => Math.max(0, player.maxHp - player.hp),
onTrigger: {
dying: async (ctx: SkillModuleCtx, payload, logs: string[]) => {
const actor = payload.actor;
if (!actor ||!actor.alive) return;
if (!ctx.hasSkill(actor, SKILL_ID)) return;
// 同一次濒死里，先执行的钩子（如另一名卞夫人的挽危）可能已把人救回 1 点以上：
// 必须重查体力，否则会在满血时白白弃两张牌（真实对局验证 10 局里抓到 2 次）。
if (actor.hp > 0) return;
if (actor.hand.length < 2) return;
if (!(await ctx.shouldActivateOptionalEffect(actor, SKILL_ID))) return;
const discarded = await ctx.requestDiscardSelection(actor, 2, "约俭：弃置两张牌");
if (discarded.length < 2) {
logs.push(`${actor.name} 发动【约俭】失败：未弃置两张牌`);
return;
}
for (const card of discarded) {
ctx.discardPile.push(card);
}
const before = actor.hp;
actor.hp = Math.min(actor.maxHp, actor.hp + 1);
logs.push(
`${actor.name} 发动【约俭】，弃置 ${discarded.map((c) => c.type).join("、")}，回复 1 点体力（${before}→${actor.hp}）`,
);
},
},
} satisfies SkillModule;
