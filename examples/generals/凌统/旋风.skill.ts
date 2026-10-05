// 旋风（凌统）— 触发性代码技能，挂 `equip_lost` 事件钩子。
//
// 规则：每当你失去装备区里的一张牌时，你可以依次弃置一至两名其他角色的各一张牌。
//
// 引擎限制（重要）：触发性技能**没有交互式"选角色"的请求类型**（`InteractionRequest` 只有
// respond / collateral / choose-discard / choose-suit / optional-effect 五种），
// 所以"一至两名其他角色"由技能自动挑选，写法与内置「英魂」一致（见 src/engine/skill-hooks.ts ：
// `ctx.players.filter(...)` 后排序取前 N 名）。排序口径：可弃牌的角色里手牌多者优先，
// 手牌相同则按 id 升序，保证 `--seed` 复现与联机一致（随机数只用 ctx.randomIndex，不用 Math.random）。
//
// 注意：只 `import type`，类型信息运行时被完全擦除，因此这个相对路径不影响实际加载。
// 本文件位于 `examples/generals/凌统/`，`../../../` 正好指向仓库根，即 `types/generals-pack.d.ts`。
import type { SkillModule, SkillModuleCtx, SkillEventPayload } from "../../../types/generals-pack.js";
import type { Player } from "../../../types/generals-pack.js";

/**
 * 自动挑选的被弃牌角色（引擎没有交互式选角，故这里定口径）：
 * 1. 其他存活角色；
 * 2. 有牌可弃（`ctx.hasRemovableCard`：手牌或装备区任一非空）；
 * 3. 手牌多者优先 → 手牌相同按 id 升序（稳定排序，seed 可复现）；
 * 4. 至多两名。
 */
const pickVictims = (ctx: SkillModuleCtx, actor: Player): Player[] =>
  ctx.players
    .filter((player) => player.alive && player.id !== actor.id && ctx.hasRemovableCard(player))
    .sort((a, b) => b.hand.length - a.hand.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, 2);

export default {
  id: "旋风",
  displayName: "旋风",
  kind: "triggered",
  optional: true,
  triggers: ["equip_lost"],
  description: "每当你失去装备区里的一张牌时，你可以依次弃置一至两名其他角色的各一张牌。",
  onTrigger: {
    equip_lost: async (ctx: SkillModuleCtx, payload: SkillEventPayload, logs: string[]) => {
      // payload.actor = 失去装备的玩家；payload.equip = 失去的装备**牌类**（装备区没有 Card 实体）。
      const actor = payload.actor;
      if (!actor) {
        return;
      }
      // 只对持有「凌统/旋风」的玩家生效（外部技能 id 已命名空间化）。
      if (!ctx.hasSkill(actor, "凌统/旋风")) {
        return;
      }
      // 可选技能：询问"是否发动"（自对弈里 answerInteraction 一律发动，真实对局走玩家/AI 决策）。
      if (!await ctx.shouldActivateOptionalEffect(actor, "凌统/旋风")) {
        return;
      }
      const victims = pickVictims(ctx, actor);
      if (victims.length === 0) {
        logs.push(`${actor.name} 发动旋风，但没有可弃牌的其他角色`);
        return;
      }
      logs.push(`${actor.name} 失去装备${payload.equip ?? ""}，发动旋风弃置 ${victims.map((victim) => victim.name).join("、")} 的牌`);
      // 依次弃置每个目标的一张随机牌（手牌或装备区的牌）；返回日志字符串数组，必须并入 logs。
      // 本技能不碰自己的装备区：这里弃置的是**其他角色**的牌，不会再触发自己的 equip_lost 递归。
      for (const victim of victims) {
        if (!victim.alive || !ctx.hasRemovableCard(victim)) {
          continue;
        }
        logs.push(...await ctx.removeRandomCardFromPlayer(victim, "弃置", undefined));
      }
      logs.push(`${actor.name} 的旋风结算完毕`);
    },
  },
} satisfies SkillModule;
