// 代码技能示例：一个可在出牌阶段主动发动的技能。
//
// 注意：这里只 `import type`，类型信息在运行时被完全擦除，
// 因此这个相对路径不会影响实际加载；复制到 `generals/吕蒙/` 后仍能正常执行。
// 也可不复制，直接用 `npm run dev -- --generals-dir=examples/generals` 加载本目录。
import type { SkillModule, SkillModuleCtx } from "../../../src/engine/skill-module.js";
import type { Player } from "../../../src/engine/types.js";

const SUIT_NAMES = { heart: "红桃", diamond: "方片", club: "梅花", spade: "黑桃", none: "无花色" } as const;

export default {
  id: "涉猎",
  displayName: "涉猎",
  kind: "active",
  requiresTarget: false,
  label: "发动涉猎（观看牌堆顶 3 张，取 1 张，其余置底）",
  description: "出牌阶段限一次：观看牌堆顶 3 张牌，选择 1 张获得，其余以任意顺序置于牌堆底。",
  canUse: (ctx: SkillModuleCtx, player: Player) => !(ctx.skillUsedThisTurn.get(player.id)?.has("涉猎") ?? false),
  play: async (ctx: SkillModuleCtx, player: Player) => {
    const logs: string[] = [];
    const drawn = ctx.drawTopCards(3);
    if (drawn.length === 0) {
      return [`${player.name} 发动涉猎，但牌堆已空`];
    }
    logs.push(`${player.name} 发动涉猎，观看牌堆顶 ${drawn.length} 张牌`);
    const remaining = [...drawn];
    const kept: typeof drawn = [];
    while (remaining.length > 0) {
      const sources = remaining.map((card) => ({
        sourceId: `sheli:${card.id}`,
        origin: "hand" as const,
        card,
        label: `${SUIT_NAMES[card.suit]}${card.rank} ${card.type}`,
      }));
      const decision = await ctx.decide({
        kind: "choose-discard",
        requestId: ctx.nextInteractionId(),
        playerId: player.id,
        reason: "涉猎：选择 1 张获得（其余置于牌堆底）",
        sources,
        count: 1,
        allowPass: true,
        passLabel: "完成涉猎",
      });
      if (decision.choice !== "card") {
        break;
      }
      const picked = remaining.find((card) => card.id === decision.sourceId.slice("sheli:".length));
      if (!picked) {
        break;
      }
      remaining.splice(remaining.indexOf(picked), 1);
      kept.push(picked);
    }
    for (const card of kept) {
      player.hand.push(card);
    }
    ctx.placeCardsOnBottom(remaining);
    ctx.markSkillUsed(player.id, "涉猎");
    logs.push(`${player.name} 的涉猎结束：获得 ${kept.length} 张，${remaining.length} 张置于牌堆底`);
    return logs;
  },
} satisfies SkillModule;
