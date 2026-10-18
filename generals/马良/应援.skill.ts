// 应援（马良）— 触发性代码技能，挂 `card_used` 事件钩子。
//
// 规则（界马良）：每当你于回合内使用一张基本牌、锦囊牌或装备牌时，
// 你可以令一名其他角色摸一张牌。
//
// 引擎限制（重要）：触发性技能**没有交互式"选角色"的请求类型**
// （`InteractionRequest` 只有 respond / collateral / choose-discard /
// choose-suit / optional-effect 五种），所以"一名其他角色"由技能自动挑选，
// 写法与内置「英魂」一致。排序口径：其他存活角色里手牌最少者优先，
// 手牌相同按 id 升序，保证 `--seed` 复现与联机一致。
//
// 注意：只 `import type`，类型信息运行时被完全擦除，故这个相对路径不影响实际加载。
import type { SkillModule, SkillModuleCtx, SkillEventPayload } from "../../../types/generals-pack.js";
import type { Player } from "../../../types/generals-pack.js";

/** 基本牌牌类。 */
const BASIC_TYPES = new Set(["杀", "火杀", "雷杀", "闪", "桃", "酒"]);
/** 非延时锦囊牌类。 */
const TRICK_TYPES = new Set([
  "过河拆桥", "顺手牵羊", "决斗", "无中生有", "南蛮入侵", "万箭齐发",
  "借刀杀人", "无懈可击", "桃园结义", "五谷丰登", "火攻", "铁索连环",
]);
/** 装备牌类（武器/防具/坐骑/宝物）。 */
const EQUIP_TYPES = new Set([
  "诸葛连弩", "雌雄双股剑", "青釭剑", "寒冰剑", "银月枪", "古锭刀",
  "丈八蛇矛", "青龙偃月刀", "贯石斧", "方天画戟", "麒麟弓", "朱雀羽扇",
  "八卦阵", "仁王盾", "藤甲", "白银狮子",
  "的卢", "绝影", "爪黄飞电", "骅骝", "赤兔", "大宛", "紫骍",
  "木牛流马",
]);

const isYingYuanCard = (cardType: string): boolean =>
  BASIC_TYPES.has(cardType) || TRICK_TYPES.has(cardType) || EQUIP_TYPES.has(cardType);

/** 其他存活角色里手牌最少者优先，手牌相同按 id 升序 → seed 可复现；自动挑一名。 */
const pickBeneficiary = (ctx: SkillModuleCtx, actor: Player): Player | undefined =>
  ctx.players
    .filter((player) => player.alive && player.id !== actor.id)
    .sort((a, b) => a.hand.length - b.hand.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];

export default {
  id: "应援",
  displayName: "应援",
  kind: "triggered",
  optional: true,
  triggers: ["card_used"],
  description:
    "每当你于回合内使用一张基本牌、锦囊牌或装备牌时，你可以令一名其他角色摸一张牌（引擎自动选择手牌最少者）。",
  onTrigger: {
    card_used: async (ctx: SkillModuleCtx, payload: SkillEventPayload, logs: string[]) => {
      const actor = payload.actor;
      if (!actor || !actor.alive) {
        return;
      }
      if (!ctx.hasSkill(actor, "马良/应援")) {
        return;
      }
      // 只处理"使用"（打出不算）；且必须是马良自己回合内使用的牌。
      if (payload.reason !== "使用") {
        return;
      }
      if (ctx.currentPlayer.id !== actor.id) {
        return;
      }
      const cardType = payload.card?.type;
      if (!cardType || !isYingYuanCard(cardType)) {
        return;
      }
      if (!(await ctx.shouldActivateOptionalEffect(actor, "马良/应援"))) {
        return;
      }
      const beneficiary = pickBeneficiary(ctx, actor);
      if (!beneficiary) {
        logs.push(`${actor.name} 发动应援，但没有其他存活角色`);
        return;
      }
      const actual = ctx.drawCards(beneficiary.id, 1);
      logs.push(`${actor.name} 发动应援，令 ${beneficiary.name} 摸 ${actual} 张牌`);
    },
  },
} satisfies SkillModule;
