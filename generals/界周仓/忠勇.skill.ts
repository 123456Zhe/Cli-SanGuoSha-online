// 忠勇（界周仓）— 触发性代码技能，挂 `slash_targeted` 事件钩子。
//
// 规则（界限突破）：当你于出牌阶段内使用指定目标后，你可以令其弃置一张牌。
//
// 实现要点：
// - `slash_targeted` 在指定目标时触发，payload 里 `source` 为出杀者、
// `target` 为被杀目标——正好对应"使用指定目标后"的时机（闪响应之前）。
// - "出牌阶段内"用 `ctx.currentPlayer.id === source.id && ctx.phase === "出牌阶段"`
// 精确判断（引擎暴露当前回合玩家与阶段），其他阶段出杀不触发。
// - 可选发动：`ctx.shouldActivateOptionalEffect(source, "界周仓/忠勇")` 询问出杀者。
// - 弃牌：目标自己选一张手牌弃置（`requestDiscardSelection(target, …)`，
// 返回的牌调用方手动 `discardPile.push`，与飞军代价同一约定）。
// - 不改写 `payload.canceled`，忠勇只令目标弃牌、不取消本次杀。
//
// 注意：只 `import type`，类型信息运行时被完全擦除，故这个相对路径不影响实际加载。
import type { SkillModule, SkillModuleCtx} from "../../../types/generals-pack.js";

export default {
id: "忠勇",
displayName: "忠勇",
kind: "triggered",
description: "当你于出牌阶段内使用指定目标后，你可以令其弃置一张牌。",
triggers: ["slash_targeted"],
onTrigger: {
slash_targeted: async (ctx, payload, logs) => {
const source = payload.source;
const target = payload.target;
if (!source ||!source.alive ||!target ||!target.alive) {
return;
}
if (source.id === target.id) {
return;
}
if (!ctx.hasSkill(source, "界周仓/忠勇")) {
return;
}
// 仅限出杀者自己的出牌阶段。
if (ctx.currentPlayer.id!== source.id || ctx.phase!== "出牌阶段") {
return;
}
if (!(await ctx.shouldActivateOptionalEffect(source, "界周仓/忠勇"))) {
return;
}
const handSources = ctx.buildUsableSources(target).filter((s) => s.origin === "hand");
if (handSources.length === 0) {
logs.push(`${source.name} 发动忠勇，但 ${target.name} 没有手牌可弃`);
return;
}
const [discarded] = await ctx.requestDiscardSelection(
target,
1,
"忠勇：弃置一张牌",
handSources,
);
if (!discarded) {
return;
}
ctx.discardPile.push(discarded);
logs.push(`${source.name} 发动忠勇，令 ${target.name} 弃置 ${discarded.type}`);
},
},
} satisfies SkillModule;
