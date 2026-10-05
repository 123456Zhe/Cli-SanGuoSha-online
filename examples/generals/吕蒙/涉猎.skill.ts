// 代码技能示例：一个可在出牌阶段主动发动的技能（官方规则复刻）。
//
// 注意：这里只 `import type`，类型信息在运行时被完全擦除，
// 因此这个相对路径不会影响实际加载；复制到 `generals/吕蒙/` 后仍能正常执行。
// 也可不复制，直接用 `npm run dev -- --generals-dir=examples/generals` 加载本目录。
import type { SkillModule, SkillModuleCtx } from "../../../src/engine/skill-module.js";
import type { Player } from "../../../src/engine/types.js";
import type { Card } from "../../../src/engine/cards.js";

const SUIT_NAMES = { heart: "红桃", diamond: "方片", club: "梅花", spade: "黑桃", none: "无花色" } as const;

const describe = (card: Card): string => `${SUIT_NAMES[card.suit]}${card.rank} ${card.type}`;

/** 涉猎可送出的花色：黑桃 / 梅花。 */
const isSheLieSuit = (card: Card): boolean => card.suit === "spade" || card.suit === "club";

export default {
  id: "涉猎",
  displayName: "涉猎",
  kind: "active",
  requiresTarget: true,
  label: "发动涉猎（看牌堆顶 5 张，黑桃/梅花可交给其他角色，其余置顶）",
  description:
    "出牌阶段限一次：观看牌堆顶的 5 张牌（不足则全看），将其中任意数量的黑桃/梅花牌交给一名其他角色，其余以任意顺序置于牌堆顶。",
  canUse: (ctx: SkillModuleCtx, player: Player) => !(ctx.skillUsedThisTurn.get(player.id)?.has("涉猎") ?? false),
  getTargets: (ctx: SkillModuleCtx, player: Player) =>
    ctx.players.filter((candidate) => candidate.alive && candidate.id !== player.id).map((candidate) => candidate.id),
  play: async (ctx: SkillModuleCtx, player: Player, targetId?: string) => {
    const logs: string[] = [];
    const drawn = ctx.drawTopCards(5);
    if (drawn.length === 0) {
      return [`${player.name} 发动涉猎，但牌堆已空`];
    }
    logs.push(`${player.name} 发动涉猎，观看牌堆顶 ${drawn.length} 张牌`);
    const target = ctx.players.find((candidate) => candidate.id === targetId && candidate.alive);

    // 步骤一：从黑桃/梅花牌里任意选若干张交给目标角色（可一张不给）。
    const giveable = drawn.filter(isSheLieSuit);
    const remaining = [...drawn];
    const given: Card[] = [];
    while (giveable.length > 0 && target) {
      const sources = giveable.map((card) => ({
        sourceId: `shelie:${card.id}`,
        origin: "hand" as const,
        card,
        label: describe(card),
      }));
      const decision = await ctx.decide({
        kind: "choose-discard",
        requestId: ctx.nextInteractionId(),
        playerId: player.id,
        reason: `涉猎：选择要交给 ${target.name} 的黑桃/梅花牌（可跳过）`,
        sources,
        count: 1,
        allowPass: true,
        passLabel: "不再交牌",
      });
      if (decision.choice !== "card") {
        break;
      }
      const picked = giveable.find((card) => card.id === decision.sourceId.slice("shelie:".length));
      if (!picked) {
        break;
      }
      giveable.splice(giveable.indexOf(picked), 1);
      remaining.splice(remaining.indexOf(picked), 1);
      given.push(picked);
    }
    if (target && given.length > 0) {
      target.hand.push(...given);
      logs.push(`${player.name} 将 ${given.map(describe).join("、")} 交给 ${target.name}`);
    }

    // 步骤二：其余牌以任意顺序置于牌堆顶（先选的最靠上）。
    const ordered: Card[] = [];
    while (remaining.length > 0) {
      const sources = remaining.map((card) => ({
        sourceId: `shelie-top:${card.id}`,
        origin: "hand" as const,
        card,
        label: describe(card),
      }));
      const decision = await ctx.decide({
        kind: "choose-discard",
        requestId: ctx.nextInteractionId(),
        playerId: player.id,
        reason: "涉猎：按从上到下的顺序选择置于牌堆顶的牌",
        sources,
        count: 1,
        allowPass: true,
        passLabel: "剩余保持原序",
      });
      if (decision.choice !== "card") {
        break;
      }
      const picked = remaining.find((card) => card.id === decision.sourceId.slice("shelie-top:".length));
      if (!picked) {
        break;
      }
      remaining.splice(remaining.indexOf(picked), 1);
      ordered.push(picked);
    }
    ctx.placeCardsOnTop([...ordered, ...remaining]);
    ctx.markSkillUsed(player.id, "涉猎");
    logs.push(`${player.name} 的涉猎结束：${given.length} 张交出，${ordered.length + remaining.length} 张置于牌堆顶`);
    return logs;
  },
} satisfies SkillModule;
