// 勤政（界骆统）— 触发性代码技能，挂 `card_used` 事件钩子。
//
// 规则（移动版）：锁定技，你每使用或打出三张牌时，你随机获得一张或；
// 每使用或打出五张牌时，你随机获得一张或；每使用或打出八张牌时，
// 你随机获得一张或。
//
// 实现要点：
// - `card_used` 的 payload 里 `reason` 为"使用"或"打出"，两者都计入（官方"使用或打出"）。
// - 计次：本回合使用/打出牌数，存在 `ctx.skillCountsThisTurn.get(actor.id)` 的
// `勤政计数` key 里（引擎每回合自动重置）。
// - 里程碑：计次恰好达到 3 / 5 / 8 时各获得一次（每回合每档一次，不重复触发）。
// 3 张→随机/，5 张→随机/，8 张→随机/。
// - "随机获得"：引擎未向武将包暴露创牌接口，故直接合成 Card 对象置入手牌：
// 类型用 `ctx.randomIndex` 二选一；花色用 `ctx.randomIndex` 四选一（红桃/方块为红，
// 梅花/黑桃为黑）；点数用 `ctx.randomIndex(13) + 1`。合成牌 id 形如
// `qinzhen-<类型>-<interactionId>`，保证唯一。
// - 锁定技：不询问，直接生效。
//
// 注意：只 `import type`，类型信息运行时被完全擦除，故这个相对路径不影响实际加载。
import type { SkillModule, SkillModuleCtx} from "../../../types/generals-pack.js";
import type { Card} from "../../../types/generals-pack.js";

/** 里程碑：计次 → 可获得的牌类对。 */
const MILESTONES: Record<number, [string, string]> = {
3: ["杀", "闪"],
5: ["桃", "酒"],
8: ["无中生有", "决斗"],
};

/** 四种花色（红桃/方块为红，梅花/黑桃为黑）。 */
const SUITS = ["heart", "diamond", "club", "spade"] as const;

/** 合成一张随机花色点数的牌（引擎无创牌接口，调用方直接置入手牌）。 */
const synthesizeCard = (ctx: SkillModuleCtx, type: string): Card => {
const suit = SUITS[ctx.randomIndex(SUITS.length)];
const color = suit === "heart" || suit === "diamond"? "red": "black";
return {
id: `qinzhen-${type}-${ctx.nextInteractionId()}`,
type: type as Card["type"],
suit,
rank: ctx.randomIndex(13) + 1,
color,
};
};

export default {
id: "勤政",
displayName: "勤政",
kind: "triggered",
description:
"锁定技，你每使用或打出三张牌时，你随机获得一张或；每使用或打出五张牌时，你随机获得一张或；每使用或打出八张牌时，你随机获得一张或。",
triggers: ["card_used"],
onTrigger: {
card_used: (ctx, payload, logs) => {
const actor = payload.actor;
if (!actor ||!actor.alive) {
return;
}
if (!ctx.hasSkill(actor, "界骆统/勤政")) {
return;
}
// 只计"使用"或"打出"（card_used 的 reason 即此二值；其他触发点不进此钩子）。
if (payload.reason!== "使用" && payload.reason!== "打出") {
return;
}
const counts = ctx.skillCountsThisTurn.get(actor.id)?? new Map<string, number>();
const count = (counts.get("勤政计数")?? 0) + 1;
counts.set("勤政计数", count);
ctx.skillCountsThisTurn.set(actor.id, counts);
const pair = MILESTONES[count];
if (!pair) {
return;
}
const type = pair[ctx.randomIndex(pair.length)];
const card = synthesizeCard(ctx, type);
actor.hand.push(card);
logs.push(
`${actor.name} 发动勤政（本回合已使用/打出 ${count} 张牌），随机获得一张`,
);
},
},
} satisfies SkillModule;
