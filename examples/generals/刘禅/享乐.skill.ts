// 享乐（刘禅）— 锁定技，代码技能，挂 `slash_targeted` 拦截点。
//
// 规则：锁定技，当你成为【杀】的目标后，使用者需弃置一张基本牌，否则此【杀】对你无效。
//
// 为什么是代码技能而不是 `.skill.json`：
// `rules` 词汇表只表达数值/豁免（距离、摸牌数、伤害、手牌上限…），表达不了"令使用者
// 做一次弃牌选择，失败则取消本次杀"这种带交互与分支的效果；声明式技能也没有 `onTrigger`。
// 所以这里落到 `slash_targeted` 拦截点 + ctx 的交互能力。
//
// 关键约定（漏做会**静默**坏掉）：
// - `slash_targeted` 的 payload 里 `source` = 杀的使用者、`target` = 成为目标的玩家；
//   置 `payload.canceled = true` 即取消本次杀（引擎在 emit 后读的是同一个 payload 对象）。
// - `ctx.requestDiscardSelection` 返回的牌**不会自动进弃牌堆**，必须自己
//   `ctx.discardPile.push(card)`；返回空数组 = 没弃成牌。
// - 锁定技：不询问"是否发动"，也不声明 `optional`（`kind: "triggered"` 即可）。
// - 别在钩子里再发起杀：那会再次触发 `slash_targeted`（引擎不设保护）。
//
// 注意：只 `import type`，类型信息在运行时被完全擦除，因此这个相对路径不影响实际加载。
// 本文件位于 `examples/generals/刘禅/`，`../../../` 正好指向仓库根，即 `types/generals-pack.d.ts`。
import type { SkillModule, SkillModuleCtx } from "../../../types/generals-pack.js";
import type { Card, CardSource, Player, SkillEventPayload } from "../../../types/generals-pack.js";

/** 基本牌（引擎口径）：杀 / 火杀 / 雷杀 / 闪 / 桃 / 酒。 */
const BASIC_CARD_TYPES: ReadonlySet<string> = new Set(["杀", "火杀", "雷杀", "闪", "桃", "酒"]);

/**
 * 使用者「可弃置的基本牌来源」：走 `ctx.buildUsableSources`（手牌 + 木牛流马内的牌，
 * 与引擎弃牌交互同一套编号），再按基本牌牌类过滤，并排除没有实体牌的来源。
 */
const basicSourcesOf = (ctx: SkillModuleCtx, user: Player): Array<CardSource & { card: Card }> =>
  ctx.buildUsableSources(user).filter(
    (entry): entry is CardSource & { card: Card } => entry.card !== undefined && BASIC_CARD_TYPES.has(entry.card.type),
  );

export default {
  id: "享乐",
  displayName: "享乐",
  kind: "triggered",
  triggers: ["slash_targeted"],
  description: "锁定技，当你成为杀的目标后，使用者需弃置一张基本牌，否则此杀对你无效。",
  onTrigger: {
    slash_targeted: async (ctx: SkillModuleCtx, payload: SkillEventPayload, logs: string[]): Promise<void> => {
      // payload.target = 成为【杀】目标的玩家（技能持有者）；payload.source = 【杀】的使用者。
      const me = payload.target;
      const user = payload.source;
      // 自己对自己不生效；payload 缺字段时安全返回（不抛错）。
      if (!me || !user || me.id === user.id) {
        return;
      }
      // 只对持有「刘禅/享乐」的玩家生效（外部技能 id 已命名空间化）。
      if (!ctx.hasSkill(me, "刘禅/享乐")) {
        return;
      }
      const candidates = basicSourcesOf(ctx, user);
      if (candidates.length === 0) {
        // 使用者一张基本牌都没有：直接令此杀无效。
        payload.canceled = true;
        logs.push(`${me.name} 的享乐生效：${user.name} 没有可弃置的基本牌，本次杀无效`);
        return;
      }
      // 要求使用者弃置一张基本牌（候选来源已过滤；引擎的弃牌交互是 allowPass:false，
      // 返回空数组即代表没有弃成）。
      const discarded = await ctx.requestDiscardSelection(
        user,
        1,
        `${me.name} 的享乐：${user.name} 需弃置一张基本牌，否则此杀对 ${me.name} 无效`,
        candidates,
      );
      const card = discarded[0];
      if (!card) {
        // 未弃牌：本次杀无效。
        payload.canceled = true;
        logs.push(`${me.name} 的享乐生效：${user.name} 未弃置基本牌，本次杀无效`);
        return;
      }
      // 隐式约定：requestDiscardSelection 只把牌移出原区域，不会自动进弃牌堆。
      ctx.discardPile.push(card);
      logs.push(`${me.name} 的享乐结算：${user.name} 弃置 ${card.type}，本次杀继续结算`);
    },
  },
} satisfies SkillModule;
