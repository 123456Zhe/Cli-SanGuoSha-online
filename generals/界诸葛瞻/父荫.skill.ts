// 父荫（界诸葛瞻）— 触发性代码技能，挂 `slash_targeted` 事件钩子。
//
// 规则（2020 版）：锁定技，你每回合第一次成为或的目标后，
// 若你的手牌数不大于该角色，此牌对你无效。
//
// 实现要点：
// - `slash_targeted` 在指定目标时触发，payload 里 `target` 为被杀目标、
// `source` 为出杀者。
// - "每回合第一次"：用 `ctx.skillCountsThisTurn` 的 `父荫` key 计次（引擎每回合
// 自动重置）；钩子先标记已结算（计次置 1），再判断手牌条件——即"第一次"只
// 评估一次，若手牌条件不满足，本回合不再重复判断。
// - "手牌数不大于该角色"：比较 `target.hand.length <= source.hand.length`。
// - "此牌对你无效"：对置 `payload.canceled = true`（钩子文档约定的取消方式）。
// - 锁定技：不询问，直接生效。
//
// 引擎限制（general.md 如实记录）：
// - 成为目标的部分暂不支持——决斗指定目标没有对应钩子（只有 `slash_targeted`），
// 故本包只实现"成为目标"的部分。
//
// 注意：只 `import type`，类型信息运行时被完全擦除，故这个相对路径不影响实际加载。
import type { SkillModule, SkillModuleCtx} from "../../../types/generals-pack.js";

export default {
id: "父荫",
displayName: "父荫",
kind: "triggered",
description:
"锁定技，你每回合第一次成为或的目标后，若你的手牌数不大于该角色，此牌对你无效（成为目标的部分暂不支持，见 general.md）。",
triggers: ["slash_targeted"],
onTrigger: {
slash_targeted: (ctx, payload, logs) => {
const target = payload.target;
const source = payload.source;
if (!target ||!target.alive) {
return;
}
if (!source || source.id === target.id) {
return;
}
if (!ctx.hasSkill(target, "界诸葛瞻/父荫")) {
return;
}
// 每回合只评估第一次成为目标。
const counts = ctx.skillCountsThisTurn.get(target.id)?? new Map<string, number>();
if ((counts.get("父荫")?? 0) >= 1) {
return;
}
counts.set("父荫", 1);
ctx.skillCountsThisTurn.set(target.id, counts);
// 手牌数不大于出杀者时，此杀无效。
if (target.hand.length > source.hand.length) {
return;
}
payload.canceled = true;
logs.push(
`${target.name} 发动父荫（本回合第一次成为杀目标，手牌 ${target.hand.length} 张不大于 ${source.name} 的 ${source.hand.length} 张），此杀无效`,
);
},
},
} satisfies SkillModule;
