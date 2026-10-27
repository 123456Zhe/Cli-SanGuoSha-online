// 飞军（界王平）— 主动代码技能。
//
// 规则（界限突破）：出牌阶段限一次，你可以弃置一张牌，然后：令一名手牌数大于你的
// 角色交给你一张牌；或令一名装备区里牌数大于你的角色弃置一张装备牌。
//
// 实现要点：
// - 限一次：`canUse` 查 `ctx.skillUsedThisTurn`，`play` 里 `ctx.markSkillUsed`。
// - 代价：弃置一张手牌（手牌来源限定），`requestDiscardSelection` 内部已
//   `removeUsableCardBySourceId` 移出手牌，调用方手动置入弃牌堆。
// - 目标条件（getTargets 与 play 双重校验）：手牌数大于你，或装备区牌数大于你。
//   弃置代价只减少自己的手牌数，不改变装备数，故 getTargets 时成立的条件在
//   play 时依然成立（手牌条件只会更成立）。
// - 两项都满足时用 `optional-effect` 让玩家二选一；只满足一项时直接执行该项。
// - "交给你一张牌"：目标用 `requestDiscardSelection` 选一张手牌（内部已移出），
//   调用方不进弃牌堆、改为 `player.hand.push`（与好施给牌同路）。
// - "弃置一张装备牌"：装备区无 Card 实体，按武器→防具→防御马→进攻马→宝物的
//   固定顺序取首个非空装备置空，并往弃牌堆补一张合成牌（牌堆计数自洽）。
//   目标无选择交互（引擎无"选装备"请求类型），general.md 如实记录。
//
// 兵略的联动（见兵略.skill.ts 说明）：
// - 引擎没有"技能发动"触发点，兵略监听 `hand_card_lost` 钩子。飞军在弃置代价前
//   往 `ctx.skillFlagsThisTurn` 里写 `飞军发动:<targetId>` 标记，兵略钩子在
//   玩家失去手牌时读到该标记即结算（首次对该目标发动时摸两张牌），并清除标记。
//   play 末尾也会清一次标记作兜底，防止钩子未触发时标记残留到同回合后续弃牌。
//
// 注意：只 `import type`，类型信息运行时被完全擦除，故这个相对路径不影响实际加载。
import type { SkillModule, SkillModuleCtx } from "../../../types/generals-pack.js";
import type { Player } from "../../../types/generals-pack.js";

/** 装备区牌数（武器/防具/防御马/进攻马/宝物，非空即计 1）。 */
const equipCount = (player: Player): number =>
  [player.weapon, player.armor, player.defenseHorse, player.attackHorse, player.treasure].filter(
    (slot) => slot !== null,
  ).length;

/** 可飞军的目标：手牌数大于你，或装备区牌数大于你。 */
const validTargets = (ctx: SkillModuleCtx, player: Player): Player[] =>
  ctx.players.filter(
    (p) =>
      p.alive &&
      p.id !== player.id &&
      (p.hand.length > player.hand.length || equipCount(p) > equipCount(player)),
  );

/** 按固定顺序取首个非空装备槽位名（目标无选择交互时用）。 */
const firstEquipSlot = (player: Player): { slot: string; name: string } | undefined => {
  if (player.weapon !== null) return { slot: "weapon", name: player.weapon };
  if (player.armor !== null) return { slot: "armor", name: player.armor };
  if (player.defenseHorse !== null) return { slot: "defenseHorse", name: player.defenseHorse };
  if (player.attackHorse !== null) return { slot: "attackHorse", name: player.attackHorse };
  if (player.treasure !== null) return { slot: "treasure", name: player.treasure };
  return undefined;
};

export default {
  id: "飞军",
  displayName: "飞军",
  kind: "active",
  requiresTarget: true,
  targetIntent: "enemy",
  label: "发动飞军（弃置一张牌，令手牌/装备多于你的角色给你牌或弃装备，每回合限一次）",
  description:
    "出牌阶段限一次：你可以弃置一张牌，然后令一名手牌数大于你的角色交给你一张牌，或令一名装备区里牌数大于你的角色弃置一张装备牌。",
  canUse: (ctx: SkillModuleCtx, player: Player) => {
    if (!player.alive || ctx.phase !== "出牌阶段") {
      return false;
    }
    if (ctx.skillUsedThisTurn.get(player.id)?.has("飞军")) {
      return false;
    }
    if (player.hand.length < 1) {
      return false;
    }
    return validTargets(ctx, player).length > 0;
  },
  getTargets: (ctx: SkillModuleCtx, player: Player) =>
    validTargets(ctx, player).map((p) => p.id),
  play: async (ctx: SkillModuleCtx, player: Player, targetId?: string) => {
    const logs: string[] = [];
    const target = ctx.players.find((p) => p.id === targetId && p.alive);
    if (!target) {
      return [`${player.name} 发动飞军失败：目标不合法`];
    }
    if (player.hand.length < 1) {
      return [`${player.name} 发动飞军失败：没有可弃置的手牌`];
    }

    // 步骤一：弃置一张手牌作代价（先写兵略标记，弃牌触发 hand_card_lost 时兵略钩子结算）。
    const flags = ctx.skillFlagsThisTurn.get(player.id) ?? new Set<string>();
    ctx.skillFlagsThisTurn.set(player.id, flags);
    flags.add(`飞军发动:${target.id}`);
    const handSources = ctx.buildUsableSources(player).filter((s) => s.origin === "hand");
    const [discarded] = await ctx.requestDiscardSelection(player, 1, "飞军：弃置一张牌", handSources);
    if (!discarded) {
      flags.delete(`飞军发动:${target.id}`);
      return [`${player.name} 发动飞军失败：未弃置手牌`];
    }
    ctx.discardPile.push(discarded);
    logs.push(`${player.name} 发动飞军，弃置 ${discarded.type}`);
    ctx.markSkillUsed(player.id, "飞军");

    // 步骤二：按条件执行效果（两项都满足时玩家二选一）。
    const handCondition = target.hand.length > player.hand.length;
    const equipCondition = equipCount(target) > equipCount(player);
    let doGive = handCondition;
    if (handCondition && equipCondition) {
      const decision = await ctx.decide({
        kind: "optional-effect",
        requestId: ctx.nextInteractionId(),
        playerId: player.id,
        effect: "界王平/飞军给牌",
        reason: "飞军：令其交给你一张牌（是）还是令其弃置一张装备牌（否）？",
      });
      doGive = decision.choice === "effect" && decision.enabled;
    }
    if (doGive) {
      if (target.hand.length < 1) {
        logs.push(`${target.name} 没有手牌可交，飞军给牌效果落空`);
      } else {
        const targetSources = ctx.buildUsableSources(target).filter((s) => s.origin === "hand");
        const [given] = await ctx.requestDiscardSelection(
          target,
          1,
          `飞军：交给${player.name}一张牌`,
          targetSources,
        );
        if (given) {
          player.hand.push(given);
          logs.push(`${target.name} 将 ${given.type} 交给 ${player.name}`);
        }
      }
    } else {
      const slot = firstEquipSlot(target);
      if (!slot) {
        logs.push(`${target.name} 装备区已空，飞军弃装备效果落空`);
      } else {
        (target as unknown as Record<string, unknown>)[slot.slot] = null;
        ctx.discardPile.push({
          id: `feijun-equip-${ctx.nextInteractionId()}`,
          type: slot.name,
          suit: "none",
          rank: 0,
          color: "colorless",
        });
        logs.push(`${target.name} 因飞军弃置装备 ${slot.name}`);
      }
    }

    // 兜底清标记：兵略钩子已在弃牌时结算并清掉标记；若钩子未触发，这里清掉，
    // 防止标记残留到同回合后续弃牌。
    flags.delete(`飞军发动:${target.id}`);
    return logs;
  },
} satisfies SkillModule;
