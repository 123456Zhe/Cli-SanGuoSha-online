// 鬼道（张角）—— 判定拦截点 `judgment` 的改判示例（对照内置「鬼才」的写法）。
//
// 触发点：`judgment`（判定牌已翻开并入弃牌堆后、内置鬼才之前发出）。
// payload：`actor` = 判定牌归属者（`game.ts` 的 `drawJudgmentCard` 里 payload.actor = owner），
//          `reason` = 判定原因文本，`card` / `judgmentCard` = 当前判定牌。
// 改判约定：替换牌必须由钩子自己从原区域移除（`removeHandCardAt`），
//          再把 `payload.judgmentCard` 指向它；引擎负责把它置入弃牌堆并记日志。
import type { Card, SkillModule, SkillModuleCtx } from "../../../types/generals-pack.js";

const SUIT_NAMES = { heart: "红桃", diamond: "方片", club: "梅花", spade: "黑桃", none: "无花色" } as const;

const describe = (card: Card): string => `${SUIT_NAMES[card.suit]}${card.rank} ${card.type}`;

export default {
  id: "鬼道",
  displayName: "鬼道",
  kind: "triggered",
  optional: true,
  triggers: ["judgment"],
  description: "当你的判定牌生效前，你可以打出一张黑色手牌（黑桃/梅花）替换之。",
  onTrigger: {
    judgment: async (ctx: SkillModuleCtx, payload, logs) => {
      // 外部钩子只有"判定牌归属者"拥有本技能时才会被分发（createSkillHooks 的门控）；
      // 这里再自查一次，与内置钩子的写法保持一致。
      const actor = payload.actor;
      if (!actor || !ctx.hasSkill(actor, "张角/鬼道")) {
        return;
      }
      const current = payload.judgmentCard;
      if (!current) {
        return;
      }
      // 鬼道只能用黑色牌（黑桃/梅花）替换，这是与内置鬼才唯一的差别。
      const candidates = actor.hand
        .map((card, index) => ({ card, index }))
        .filter((item) => item.card.color === "black");
      if (candidates.length === 0) {
        return; // 没有黑色手牌 → 无法发动
      }
      // 是否发动 + 用哪张黑色牌：照抄内置鬼才的 choose-discard 询问（allowPass + passLabel）。
      const decision = await ctx.decide({
        kind: "choose-discard",
        requestId: ctx.nextInteractionId(),
        playerId: actor.id,
        reason: `${payload.reason ?? "判定"}：${actor.name} 是否发动鬼道，打出一张黑色手牌替换判定牌？`,
        sources: candidates.map((item) => ({
          sourceId: `guidao:${item.card.id}`,
          origin: "hand" as const,
          card: item.card,
          label: describe(item.card),
        })),
        count: 1,
        allowPass: true,
        passLabel: "不发动鬼道",
      });
      if (decision.choice !== "card") {
        return;
      }
      const picked = candidates.find((item) => `guidao:${item.card.id}` === decision.sourceId);
      if (!picked) {
        return;
      }
      // 用 card.id 重新定位下标（decide 期间手牌理论上不会变，但下标比 id 脆弱）。
      const index = actor.hand.findIndex((card) => card.id === picked.card.id);
      if (index < 0) {
        return;
      }
      // 失去手牌必须走 removeHandCardAt（会触发 hand_card_lost 等钩子）。
      // 这里**不要**自己 push 弃牌堆：引擎在钩子返回后会把替换牌置入弃牌堆。
      const replacement = await ctx.removeHandCardAt(actor, index, logs);
      if (!replacement) {
        return;
      }
      payload.judgmentCard = replacement;
      logs.push(`${actor.name} 发动鬼道，以 ${describe(replacement)} 替换判定牌 ${describe(current)}`);
    },
  },
} satisfies SkillModule;
