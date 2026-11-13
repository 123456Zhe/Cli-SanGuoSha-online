import type {
Player,
SkillModule,
SkillModuleCtx,
} from "../../../types/generals-pack.js";

// 挽危（卞夫人）— 主动技能 + 濒死触发技，每轮限一次。
//
// 规则（Fandom 卞夫人页，将星归汉·零八、移动版）：
// 每轮限一次，出牌阶段，你可以令一名其他角色回复X+1点体力；
// 一名其他角色进入濒死状态时，你可以令其回复X+1点体力
// （若其脱离濒死状态需回复的体力值大于X+1则改为将体力回复至1点），
// 然后你失去X点体力（X为你的体力值）。
//
// 实现要点：
// - 每轮限一次：`canUse`/钩子查 `ctx.isSkillUsedThisRound(player.id, "挽危")`，
// `play`/钩子里 `ctx.markSkillUsedThisRound`（Phase 9 接口，轮次回到起始座位时自动清空）。
// - 出牌阶段分支：主动技，需指定一名其他角色（仅受伤者列为目标，与结姻同口径）；
// 回复 X+1 点体力后自己失去 X 点体力，随后走 resolveDeaths/resolveWinner/
// advanceIfCurrentPlayerDead（与苦肉同口径，自损到 0 体力会当场进入濒死结算，
// 此时自己的约俭可接上救自己）。
// - 濒死分支：`dying` 钩子 + `globalHook: true`（监听其他角色濒死）；
// 需回复量 = 1 - 濒死者当前体力，大于 X+1 时直接把体力置为 1 点，否则回复 X+1 点
// （封顶体力上限）；然后自己失去 X 点体力（钩子内不调 resolveDeaths，
// 引擎在同一次死亡结算里重扫处理新造出的濒死者）。
// - 限制：出牌阶段分支仅受伤的其他角色可选为目标（满血目标回复无效果，结姻同口径）。

const SKILL_ID = "卞夫人/挽危";

/** 挽危的回复结算：X 为持有者当前体力，回复量为 X+1；濒死者需回复量大于 X+1 时改为将体力回复至 1 点。 */
function healForWanWei(holder: Player, target: Player): { before: number; after: number; toOne: boolean} {
const heal = holder.hp + 1;
const before = target.hp;
let after: number;
let toOne = false;
if (target.hp <= 0 && 1 - target.hp > heal) {
after = 1;
toOne = true;
} else {
after = Math.min(target.maxHp, target.hp + heal);
}
target.hp = after;
return { before, after, toOne};
}

export default {
id: "挽危",
displayName: "挽危",
kind: "active",
description:
"每轮限一次，出牌阶段，你可以令一名其他角色回复X+1点体力；一名其他角色进入濒死状态时，你可以令其回复X+1点体力（若其脱离濒死状态需回复的体力值大于X+1则改为将体力回复至1点），然后你失去X点体力（X为你的体力值）。",
triggers: ["dying"],
requiresTarget: true,
targetIntent: "ally",
globalHook: true,
canUse: (ctx: SkillModuleCtx, player: Player) => {
if (!player.alive || ctx.phase!== "出牌阶段") return false;
if (ctx.isSkillUsedThisRound(player.id, "挽危")) return false;
return ctx.players.some((p) => p.alive && p.id!== player.id && p.hp < p.maxHp);
},
getTargets: (ctx: SkillModuleCtx, player: Player) =>
ctx.players
.filter((p) => p.alive && p.id!== player.id && p.hp < p.maxHp)
.sort((a, b) => a.hp - b.hp || a.id.localeCompare(b.id))
.map((p) => p.id),
play: async (ctx: SkillModuleCtx, player: Player, targetId?: string) => {
const logs: string[] = [];
const target = ctx.players.find((p) => p.id === targetId);
if (!target ||!target.alive || target.id === player.id) {
logs.push(`${player.name} 发动【挽危】失败：未选中有效角色`);
return logs;
}
const x = player.hp;
const { before, after, toOne} = healForWanWei(player, target);
player.hp -= x;
ctx.markSkillUsedThisRound(player.id, "挽危");
logs.push(
`${player.name} 发动【挽危】，令 ${target.name} 回复体力（${before}→${after}${toOne? "，改为回复至 1 点": ""}），自己失去 ${x} 点体力`,
);
// 自损可能当场进入濒死：与苦肉同口径，立即结算死亡/胜负/回合推进。
logs.push(...(await ctx.resolveDeaths()));
logs.push(...ctx.resolveWinner());
await ctx.advanceIfCurrentPlayerDead(logs);
return logs;
},
onTrigger: {
dying: async (ctx: SkillModuleCtx, payload, logs: string[]) => {
const holder = ctx.players.find((p) => ctx.hasSkill(p, SKILL_ID));
if (!holder ||!holder.alive) return;
const dying = payload.actor;
if (!dying ||!dying.alive || dying.id === holder.id) return;
// 同一次濒死里先执行的钩子可能已把人救回：重查体力，确认仍濒死才发动。
if (dying.hp > 0) return;
if (ctx.isSkillUsedThisRound(holder.id, "挽危")) return;
if (!(await ctx.shouldActivateOptionalEffect(holder, SKILL_ID))) return;
const x = holder.hp;
const { before, after, toOne} = healForWanWei(holder, dying);
holder.hp -= x;
ctx.markSkillUsedThisRound(holder.id, "挽危");
logs.push(
`${holder.name} 发动【挽危】，令濒死的 ${dying.name} 回复体力（${before}→${after}${toOne? "，改为回复至 1 点": ""}），自己失去 ${x} 点体力`,
);
},
},
} satisfies SkillModule;
