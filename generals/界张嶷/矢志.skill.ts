// 矢志（界张嶷）— 锁定技，体力值为 1 时，你的【闪】视为【杀】。
//
// 规则（Fandom 张嶷页，一将成名2015 原版，繁体原文）：
// 锁定技，若你的体力值为1，你的【闪】视为【杀】。
// 2021 界版另加用此类【杀】造成伤害后回复 1 点体力（且体力上限为 5），队列注记定用原版/2020版，未采用。
// 憮戎（同时展示手牌博弈）无引擎接口，不在队列内。
//
// 实现要点：
// - 声明式转换：闪当杀（asResponse: ["slash"]，决斗/激将可打出）；
//   Phase 8 门控 canUseConversion：仅体力值为 1 时可用（枚举与结算各复算一次，纯只读）。
// - 「视为」的另一半——1 血时闪不能再当闪用：provide_response 钩子在 need 为 dodge
//   且体力为 1 时，把 responseSources 里的原生闪来源（无 viaSkill）过滤掉；
//   带 viaSkill 的转换来源（如其他技能变出的闪）不受影响。八卦阵是内置判定机制，不走此路。
// - 已知收窄：十周年规则集把作为判定牌的闪也视为杀，引擎判定流程内置、转换不影响
//   判定牌；按 Fandom 原版文本（无判定牌那句）实现，见 general.md。
import type {
  SkillConversion,
  SkillEventPayload,
  SkillModule,
  SkillModuleCtx,
} from "../../../types/generals-pack.js";

const SKILL_ID = "界张嶷/矢志";

export default {
  id: "矢志",
  displayName: "矢志",
  kind: "triggered",
  triggers: ["provide_response"],
  description: "锁定技，若你的体力值为1，你的【闪】视为【杀】。",
  conversions: [
    {
      from: { type: ["闪"] },
      to: "杀",
      asResponse: ["slash"],
    },
  ],
  canUseConversion: (_ctx: SkillModuleCtx, player, _conversion: SkillConversion): boolean =>
    player.hp === 1,
  onTrigger: {
    provide_response: (ctx: SkillModuleCtx, payload: SkillEventPayload, logs: string[]): void => {
      const actor = payload.actor;
      if (!actor || payload.need !== "dodge") return;
      if (!ctx.hasSkill(actor, SKILL_ID)) return;
      if (actor.hp !== 1) return;
      const sources = payload.responseSources;
      if (!sources || sources.length === 0) return;
      const before = sources.length;
      payload.responseSources = sources.filter(
        (source) => source.card?.type !== "闪" || source.viaSkill !== undefined,
      );
      if (payload.responseSources.length < before) {
        logs.push(`${actor.name} 的矢志：体力为 1，【闪】视为【杀】，不能打出【闪】`);
      }
    },
  },
} satisfies SkillModule;
