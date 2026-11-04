// 涯角（界赵云）— 触发性代码技能，挂 `card_used` 事件钩子。
//
// 规则（界限突破）：当你于回合外使用或打出一张手牌时，你可以展示牌堆顶的
// 一张牌，若此牌与你使用的牌类别相同，你可以将此牌交给一名角色，否则你
// 将此牌置入弃牌堆。
//
// 实现要点：
// - “回合外”：`actor.id !== ctx.currentPlayer.id`。
// - “使用或打出”：同时处理 `reason === "使用"` 与 `reason === "打出"`（与奔袭同口径）。
// - “类别”：牌面只有 type 字段，故按官方分类推导——基本牌（杀/火杀/雷杀/闪/
//   桃/酒）、装备牌（武器/防具/马/木牛流马），其余一律归锦囊牌（含延时锦囊）。
// - “交给一名角色”：触发钩子没有交互选目标（见 docs/generals-pack-api.md），
//   故自动交给自己（好施/飞军给牌同路：`target.hand.push`），general.md 已记录。
// - 展示牌取自 `ctx.drawTopCards(1)`；类别不同则 `ctx.discardPile.push`。
// - 给牌走 hand.push，不触发 card_used，无递归风险。
//
// 注意：只 `import type`，类型信息运行时被完全擦除，故这个相对路径不影响实际加载。
import type { SkillModule, SkillModuleCtx, SkillEventPayload } from "../../../types/generals-pack.js";

const BASIC = new Set(["杀", "火杀", "雷杀", "闪", "桃", "酒"]);
const EQUIP = new Set([
  "诸葛连弩", "雌雄双股剑", "青釭剑", "寒冰剑", "银月枪", "古锭刀",
  "丈八蛇矛", "青龙偃月刀", "贯石斧", "方天画戟", "麒麟弓", "朱雀羽扇",
  "八卦阵", "仁王盾", "藤甲", "白银狮子",
  "的卢", "绝影", "爪黄飞电", "骅骝", "赤兔", "大宛", "紫骍", "木牛流马",
]);

const category = (type: string): "基本牌" | "锦囊牌" | "装备牌" =>
  BASIC.has(type) ? "基本牌" : EQUIP.has(type) ? "装备牌" : "锦囊牌";

export default {
  id: "涯角",
  displayName: "涯角",
  kind: "triggered",
  optional: true,
  triggers: ["card_used"],
  description:
    "当你于回合外使用或打出一张手牌时，你可以展示牌堆顶的一张牌，若此牌与你使用的牌类别相同，你可以将此牌交给一名角色（触发钩子无法交互选目标，自动交给自己），否则你将此牌置入弃牌堆。",
  onTrigger: {
    card_used: async (ctx: SkillModuleCtx, payload: SkillEventPayload, logs: string[]) => {
      const actor = payload.actor;
      if (!actor || !actor.alive) {
        return;
      }
      if (!ctx.hasSkill(actor, "界赵云/涯角")) {
        return;
      }
      // 回合外：当前回合玩家不是自己。
      if (ctx.currentPlayer && actor.id === ctx.currentPlayer.id) {
        return;
      }
      if (payload.reason !== "使用" && payload.reason !== "打出") {
        return;
      }
      const used = payload.card;
      if (!used) {
        return;
      }
      if (!(await ctx.shouldActivateOptionalEffect(actor, "界赵云/涯角"))) {
        return;
      }
      const drawn = ctx.drawTopCards(1);
      if (drawn.length === 0) {
        logs.push(`${actor.name} 发动涯角失败：牌堆已空`);
        return;
      }
      const top = drawn[0];
      if (category(top.type) === category(used.type)) {
        actor.hand.push(top);
        logs.push(
          `${actor.name} 发动涯角：牌堆顶 ${top.type}（${category(top.type)}）与使用的 ${used.type}（${category(used.type)}）类别相同，交给自己`,
        );
      } else {
        ctx.discardPile.push(top);
        logs.push(
          `${actor.name} 发动涯角：牌堆顶 ${top.type}（${category(top.type)}）与使用的 ${used.type}（${category(used.type)}）类别不同，置入弃牌堆`,
        );
      }
    },
  },
} satisfies SkillModule;
