// 兵略（界王平）— 触发性代码技能，挂 `hand_card_lost` 事件钩子。
//
// 规则（界限突破）：锁定技，当你对每名其他角色第一次发动"飞军"时，你摸两张牌。
//
// 实现机制：
// - 引擎没有"技能发动"触发点，故飞军在弃置代价前往 `ctx.skillFlagsThisTurn` 里
//   写 `飞军发动:<targetId>` 标记；本钩子在玩家失去手牌时读到该标记即结算，
//   并清除标记（标记只存活到同回合弃牌结算，飞军 play 末尾也会清一次作兜底）。
// - 跨回合的"第一次"记录用模块级 `WeakMap<Player, Set<string>>`：键是本对局的
//   玩家对象（每局新建，对局结束即被回收，不会跨对局泄漏），值是已对其发动过
//   飞军的目标 id 集合。首次对某目标发动飞军时摸两张牌。
// - 目标给牌时的手牌失去（目标的手牌减少）不会误触发：标记只写在飞军发动者身上，
//   钩子只认发动者自己的标记。
//
// 注意：只 `import type`，类型信息运行时被完全擦除，故这个相对路径不影响实际加载。
import type { SkillModule, SkillModuleCtx } from "../../../types/generals-pack.js";

/** 兵略记录：每名玩家已对其发动过飞军的目标 id 集合（WeakMap 以对局内玩家对象为键）。 */
const binglueTargets = new WeakMap<object, Set<string>>();

/** 从当回合标记里取出飞军目标 id（无则返回 undefined）。 */
const takeFeijunTarget = (ctx: SkillModuleCtx, playerId: string): string | undefined => {
  const flags = ctx.skillFlagsThisTurn.get(playerId);
  if (!flags) {
    return undefined;
  }
  for (const flag of flags) {
    if (flag.startsWith("飞军发动:")) {
      flags.delete(flag);
      return flag.slice("飞军发动:".length);
    }
  }
  return undefined;
};

export default {
  id: "兵略",
  displayName: "兵略",
  kind: "triggered",
  description:
    "锁定技，当你对每名其他角色第一次发动“飞军”时，你摸两张牌（经飞军弃牌时的 hand_card_lost 钩子结算）。",
  triggers: ["hand_card_lost"],
  onTrigger: {
    hand_card_lost: (ctx, payload, logs) => {
      const actor = payload.actor;
      if (!actor || !actor.alive) {
        return;
      }
      if (!ctx.hasSkill(actor, "界王平/兵略")) {
        return;
      }
      const targetId = takeFeijunTarget(ctx, actor.id);
      if (!targetId) {
        return;
      }
      const target = ctx.players.find((p) => p.id === targetId);
      let targets = binglueTargets.get(actor);
      if (!targets) {
        targets = new Set<string>();
        binglueTargets.set(actor, targets);
      }
      if (targets.has(targetId)) {
        return;
      }
      targets.add(targetId);
      const drawn = ctx.drawCards(actor.id, 2);
      logs.push(
        `${actor.name} 的兵略生效（第一次对 ${target?.name ?? targetId} 发动飞军），摸 ${drawn} 张牌`,
      );
    },
  },
} satisfies SkillModule;
