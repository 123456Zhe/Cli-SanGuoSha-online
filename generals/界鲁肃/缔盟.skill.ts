// 缔盟（界鲁肃）— 主动代码技能。
//
// 规则（界限突破）：出牌阶段限一次，你可以令两名手牌数不同的其他角色交换手牌。
//
// 实现要点：
// - 触发技无交互式选角请求类型（`InteractionRequest` 没有"选玩家"类型），故
//   `requiresTarget: false`，在 play 里自动挑选两名目标，与凌统「旋风」同口径。
// - 目标自动挑选：手牌最多者与手牌最少者（并列取 id 升序首位）；若两者手牌数
//   相同则无合法目标，`canUse` 返回 false。
// - 交换手牌：直接数组互换（`splice` 取出再 `push` 回，保持数组引用不变）。
//   官方「交换」不视为"失去/获得"触发连营等钩子，故不走 removeHandCardAt，
//   general.md 如实记录。
// - 限一次：`canUse` 查 `ctx.skillUsedThisTurn`，`play` 里 `ctx.markSkillUsed`。
//
// 注意：只 `import type`，类型信息运行时被完全擦除，故这个相对路径不影响实际加载。
import type { SkillModule, SkillModuleCtx } from "../../../types/generals-pack.js";
import type { Player } from "../../../types/generals-pack.js";

/** 排序稳定的极值挑选：按手牌数取最值，并列取 id 升序首位。 */
const pickExtreme = (
  candidates: Player[],
  pickMax: boolean,
): Player | undefined => {
  if (candidates.length === 0) {
    return undefined;
  }
  const sorted = [...candidates].sort((a, b) => {
    const diff = pickMax ? b.hand.length - a.hand.length : a.hand.length - b.hand.length;
    if (diff !== 0) {
      return diff;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return sorted[0];
};

/** 找到一对可缔盟的目标（手牌数不同的两名其他存活角色），无则返回 undefined。 */
const findPair = (ctx: SkillModuleCtx, actor: Player): [Player, Player] | undefined => {
  const others = ctx.players.filter((p) => p.alive && p.id !== actor.id);
  if (others.length < 2) {
    return undefined;
  }
  const most = pickExtreme(others, true)!;
  const fewest = pickExtreme(others, false)!;
  if (most.id === fewest.id || most.hand.length === fewest.hand.length) {
    return undefined;
  }
  return [most, fewest];
};

export default {
  id: "缔盟",
  displayName: "缔盟",
  kind: "active",
  requiresTarget: false,
  targetIntent: "ally",
  label: "发动缔盟（令手牌最多者与最少者交换手牌，每回合限一次）",
  description:
    "出牌阶段限一次：令两名手牌数不同的其他角色交换手牌（自动选手牌最多者与最少者）。",
  canUse: (ctx: SkillModuleCtx, player: Player) => {
    if (!player.alive || ctx.phase !== "出牌阶段") {
      return false;
    }
    if (ctx.skillUsedThisTurn.get(player.id)?.has("缔盟")) {
      return false;
    }
    return findPair(ctx, player) !== undefined;
  },
  play: async (ctx: SkillModuleCtx, player: Player) => {
    const pair = findPair(ctx, player);
    if (!pair) {
      return [`${player.name} 发动缔盟失败：没有手牌数不同的两名其他角色`];
    }
    const [most, fewest] = pair;
    const mostCount = most.hand.length;
    const fewestCount = fewest.hand.length;
    ctx.markSkillUsed(player.id, "缔盟");
    const mostCards = most.hand.splice(0, most.hand.length);
    const fewestCards = fewest.hand.splice(0, fewest.hand.length);
    most.hand.push(...fewestCards);
    fewest.hand.push(...mostCards);
    return [
      `${player.name} 发动缔盟，${most.name}（${mostCount} 张）与${fewest.name}（${fewestCount} 张）交换手牌`,
    ];
  },
} satisfies SkillModule;
