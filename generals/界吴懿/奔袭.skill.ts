// 奔袭（吴懿，界限突破版）— 触发性代码技能，挂 `card_used` 事件钩子。
//
// 规则（吴懿，官方卡牌文本）：每当你使用或时，
// 你可以弃置一张牌，然后摸一张牌。
//
// 实现要点：
// - 卡牌类型：杀/火杀/雷杀/闪（`payload.card?.type`）。
// - "使用"口径：同时处理 `reason === "使用"` 与 `reason === "打出"`
// （打出响应是闪最常见的用法；引擎在 card_used 里区分两者）。
// 若官方严格口径仅限"使用"，general.md 已记录该假设，可随时收紧。
// - 弃置限定手牌：走 `choose-discard` 选牌交互（与强袭一致）；
// 官方 FAQ 允许弃置装备区牌，引擎选牌交互暂不支持，此处记录为已知限制。
// - 锁定技但带"可以"选择：按狂骨先例记 `optional: true`，
// 发动前走 `shouldActivateOptionalEffect`（AI 固定策略自动决策）。
// - 无手牌时无法支付代价，直接跳过（不询问）。
//
// 注意：只 `import type`，类型信息运行时被完全擦除，故这个相对路径不影响实际加载。
import type { SkillModule, SkillModuleCtx, SkillEventPayload} from "../../../types/generals-pack.js";
import type { Player} from "../../../types/generals-pack.js";

/** 触发奔袭的牌类：杀（含属性杀）与闪。 */
const BENXI_TYPES = new Set(["杀", "火杀", "雷杀", "闪"]);

/** "使用"口径：包含打出（闪多为打出响应）。 */
const USE_REASONS = new Set(["使用", "打出"]);

/** 持有者手牌来源（可被弃置的手牌）。 */
const handSources = (ctx: SkillModuleCtx, player: Player) =>
ctx.buildUsableSources(player).filter(
(source) => source.origin === "hand" && source.card!== undefined,
);

export default {
id: "奔袭",
displayName: "奔袭",
kind: "triggered",
optional: true,
triggers: ["card_used"],
description:
"每当你使用或打出/时，你可以弃置一张手牌，然后摸一张牌。",
onTrigger: {
card_used: async (ctx: SkillModuleCtx, payload: SkillEventPayload, logs: string[]) => {
const actor = payload.actor;
if (!actor ||!actor.alive) {
return;
}
// 只有"界吴懿/奔袭"持有者自己使用/打出的杀/闪才触发。
if (!ctx.hasSkill(actor, "界吴懿/奔袭")) {
return;
}
if (!USE_REASONS.has(payload.reason?? "")) {
return;
}
const cardType = payload.card?.type;
if (!cardType ||!BENXI_TYPES.has(cardType)) {
return;
}
// 无手牌则无法支付代价，直接跳过。
const sources = handSources(ctx, actor);
if (sources.length === 0) {
return;
}
if (!(await ctx.shouldActivateOptionalEffect(actor, "界吴懿/奔袭"))) {
return;
}
// 步骤一：弃置一张手牌。
const pick = await ctx.decide({
kind: "choose-discard",
requestId: ctx.nextInteractionId(),
playerId: actor.id,
reason: "奔袭：选择一张手牌弃置",
sources,
count: 1,
allowPass: false,
});
if (pick.choice!== "card") {
logs.push(`${actor.name} 发动奔袭失败：未选择要弃置的手牌`);
return;
}
const removed = await ctx.removeUsableCardBySourceId(actor, pick.sourceId);
if (removed) {
ctx.discardPile.push(removed);
}
// 步骤二：摸一张牌。
const drawn = ctx.drawCards(actor.id, 1);
logs.push(
`${actor.name} 发动奔袭（${payload.reason}），弃置 1 张手牌，摸 ${drawn} 张牌`,
);
},
},
} satisfies SkillModule;
