// 镇卫（界文聘）— 触发性代码技能，挂 `slash_targeted` 事件钩子。
//
// 规则（界限突破）：当你成为其他角色使用或的目标后，你可以摸一张牌。
//
// 实现要点：
// - `slash_targeted` 的 payload 里 `target` 为被杀目标、`source` 为出杀者。
// 钩子先确认 `payload.target` 拥有本技能且 `source` 是其他存活角色（自己对自己
// 出杀不触发，官方"其他角色"限定）。
// - 可选发动：`ctx.shouldActivateOptionalEffect(target, "界文聘/镇卫")` 询问。
// - 摸牌：`ctx.drawCards(target.id, 1)`。
// - 不改写 `payload.canceled`，镇卫只摸牌、不取消本次杀。
//
// 引擎限制（general.md 如实记录）：
// - 决斗目标部分暂不支持——成为目标没有对应钩子（只有 `slash_targeted`），
// 故本包只实现"成为目标"的部分。
//
// 注意：只 `import type`，类型信息运行时被完全擦除，故这个相对路径不影响实际加载。
import type { SkillModule, SkillModuleCtx} from "../../../types/generals-pack.js";

export default {
id: "镇卫",
displayName: "镇卫",
kind: "triggered",
description:
"当你成为其他角色使用的目标后，你可以摸一张牌（成为目标的部分暂不支持，见 general.md）。",
triggers: ["slash_targeted"],
onTrigger: {
slash_targeted: async (ctx, payload, logs) => {
const target = payload.target;
const source = payload.source;
if (!target ||!target.alive) {
return;
}
if (!source || source.id === target.id) {
return;
}
if (!ctx.hasSkill(target, "界文聘/镇卫")) {
return;
}
if (!(await ctx.shouldActivateOptionalEffect(target, "界文聘/镇卫"))) {
return;
}
const drawn = ctx.drawCards(target.id, 1);
logs.push(`${target.name} 发动镇卫（成为 ${source.name} 的杀目标），摸 ${drawn} 张牌`);
},
},
} satisfies SkillModule;
