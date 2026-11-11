// 灭吴（群杜预）— 转换代码技能，潜在技能（general.json 的 latentSkills）。
//
// 规则（Fandom 身份局版，繁体原文「滅吳」）：每回合每种牌名限一次，
// 你可以移去1枚“武庫”标记，然后将一张牌当任意一种基本牌或普通锦囊牌使用或打出。
//
// 实现要点：
// - 18 条转换：任意一张手牌（from 为四花色全匹配）可当任意基本牌/普通锦囊；
//   响应时机：杀/火杀/雷杀当杀响应（slash）、桃当桃（peach）、闪当闪（dodge）、
//   无懈可击当无懈可击（negate），与龙魂的 asResponse 口径一致。
// - 限次与扣费走 Phase 8 的两个钩子：`canUseConversion` 纯门控——标记 ≥1 且本回合
//   该牌名未用过（计数键 `灭吴:<牌名>`，存在 ctx.skillCountsThisTurn 里，
//   每回合由引擎自动清零，与强袭的复合键同一写法）；`onConversionUsed` 在成功
//   结算后调用一次，移去 1 枚标记并把计数 +1。门控为假时转换不枚举，
//   伪造动作提交时结算也会复算门控并拒绝（引擎行为，见 conversions.test.ts）。
// - 拆/顺经灭吴当出时，目标牌选择走随机（转换动作不带选牌步骤，
//   与 AI 出牌的兜底同口径，见 docs/generals-pack-api.md 的当牌转换一节）。
import type {
  ResponseKind,
  SkillConversion,
  SkillModule,
  SkillModuleCtx,
} from "../../../types/generals-pack.js";
import { consumeMark, getMarks } from "./wuku-state.js";

const SKILL_ID = "群杜预/灭吴";
const countKey = (to: string): string => `灭吴:${to}`;

/** 可当成的 18 种牌：全部基本牌 + 全部普通锦囊（延时锦囊与装备不在引擎白名单内）。 */
const TARGETS: string[] = [
  "杀",
  "火杀",
  "雷杀",
  "桃",
  "酒",
  "闪",
  "无懈可击",
  "过河拆桥",
  "顺手牵羊",
  "决斗",
  "无中生有",
  "南蛮入侵",
  "万箭齐发",
  "借刀杀人",
  "火攻",
  "铁索连环",
  "桃园结义",
  "五谷丰登",
];

const RESPONSE_MAP: Record<string, ResponseKind[]> = {
  杀: ["slash"],
  火杀: ["slash"],
  雷杀: ["slash"],
  桃: ["peach"],
  闪: ["dodge"],
  无懈可击: ["negate"],
};

export default {
  id: "灭吴",
  displayName: "灭吴",
  kind: "conversion",
  description:
    "每回合每种牌名限一次，你可以移去1枚“武库”标记，然后将一张牌当任意一种基本牌或普通锦囊牌使用或打出。",
  conversions: TARGETS.map((to): SkillConversion => {
    const conversion: SkillConversion = {
      from: { suit: ["heart", "diamond", "club", "spade"] },
      to: to as SkillConversion["to"],
    };
    const asResponse = RESPONSE_MAP[to];
    if (asResponse) {
      conversion.asResponse = asResponse;
    }
    return conversion;
  }),
  canUseConversion: (ctx: SkillModuleCtx, player, conversion: SkillConversion): boolean => {
    if (!ctx.hasSkill(player, SKILL_ID)) {
      return false;
    }
    if (getMarks(player) < 1) {
      return false;
    }
    const used = ctx.skillCountsThisTurn.get(player.id)?.get(countKey(conversion.to)) ?? 0;
    return used === 0;
  },
  onConversionUsed: (
    ctx: SkillModuleCtx,
    player,
    conversion: SkillConversion,
    logs: string[],
  ): void => {
    consumeMark(player);
    const counts = ctx.skillCountsThisTurn.get(player.id) ?? new Map<string, number>();
    counts.set(countKey(conversion.to), (counts.get(countKey(conversion.to)) ?? 0) + 1);
    ctx.skillCountsThisTurn.set(player.id, counts);
    logs.push(`${player.name} 发动灭吴当${conversion.to}，移去 1 枚武库标记（剩余 ${getMarks(player)} 枚）`);
  },
} satisfies SkillModule;
