// 潜袭（界马岱）— 触发性代码技能，挂 `before_damage` 事件钩子。
//
// 规则（界限突破）：每当你使用对目标角色造成伤害时，你可以进行一次判定，
// 若判定结果不为红桃，则此伤害+1。
//
// 实现要点：
// - `before_damage` 的 payload 里没有 `actor`，只有 `source`（伤害来源）。
// 钩子先确认 `payload.source` 拥有本技能（`ctx.hasSkill(source, "界马岱/潜袭")`）。
// - "使用造成伤害"：`payload.card?.type` 为 杀/火杀/雷杀（`applyDamage`
// 的 `damageCard` 参数透传进来）。决斗、南蛮等非杀伤害不触发。
// - 可选发动：`ctx.shouldActivateOptionalEffect(source, "界马岱/潜袭")` 询问。
// - 判定：`ctx.drawJudgmentCard("潜袭", logs, source)`（自动触发 `judgment`
// 钩子，支持改判）；判定牌花色不为红桃（`suit!== "heart"`）则
// `payload.damage = (payload.damage?? 1) + 1`。引擎在钩子返回后用
// `payload.damage` 作为最终伤害（game.ts 2616 行），改写即生效。
// - 注意判定牌进弃牌堆由引擎处理（`drawJudgmentCard` 内部负责）。
//
// 注意：只 `import type`，类型信息运行时被完全擦除，故这个相对路径不影响实际加载。
import type { SkillModule, SkillModuleCtx} from "../../../types/generals-pack.js";

/** 杀类牌（普杀/火杀/雷杀）。 */
const SLASH_TYPES = new Set(["杀", "火杀", "雷杀"]);

export default {
id: "潜袭",
displayName: "潜袭",
kind: "triggered",
description:
"每当你使用对目标角色造成伤害时，你可以进行一次判定，若判定结果不为红桃，则此伤害+1。",
triggers: ["before_damage"],
onTrigger: {
before_damage: async (ctx, payload, logs) => {
const source = payload.source;
if (!source ||!source.alive) {
return;
}
if (!ctx.hasSkill(source, "界马岱/潜袭")) {
return;
}
// 必须是"使用"造成的伤害（决斗/南蛮/技能伤害不触发）。
if (!payload.card ||!SLASH_TYPES.has(payload.card.type)) {
return;
}
if (!(await ctx.shouldActivateOptionalEffect(source, "界马岱/潜袭"))) {
return;
}
const judgment = await ctx.drawJudgmentCard("潜袭", logs, source);
if (!judgment) {
logs.push(`${source.name} 发动潜袭，但牌堆已空无法判定`);
return;
}
const suitName =
judgment.suit === "heart"? "红桃":
judgment.suit === "diamond"? "方块":
judgment.suit === "club"? "梅花":
judgment.suit === "spade"? "黑桃": "无花色";
if (judgment.suit!== "heart") {
payload.damage = (payload.damage?? 1) + 1;
logs.push(
`${source.name} 发动潜袭，判定为${suitName}${judgment.type}（非红桃），本次伤害+1`,
);
} else {
logs.push(`${source.name} 发动潜袭，判定为红桃${judgment.type}，伤害不变`);
}
},
},
} satisfies SkillModule;
