// 武库（群杜预）— 触发性代码技能，挂 `card_used` 与 `equip_lost`。
//
// 规则（Fandom 身份局版，繁体原文「武庫」）：锁定技，当你使用装备牌时或其他角色
// 失去装备区内的一张牌时，你获得1枚“武庫”标记（至多为3）。
//
// 实现要点：
// - `globalHook: true`：`equip_lost` 的 actor 是失去装备的玩家，不是持有者，
//   默认包装层过滤（只放行 actor/target/source 持有本技能的事件）会把它拦掉，
//   所以本技能开全局钩子，钩子内自行用 `ctx.players.find(hasSkill)` 定位持有者。
// - 只计其他角色失装：自己失装不计——换武器时 `card_used` 已计一次，
//   若 `equip_lost` 再计就会双计；自己装备被拆/被顺也不计（文本只说"其他角色"）。
// - `card_used` 只计 reason === "使用"：装备牌被当响应"打出"（如经转换当闪）不计。
// - 标记存在包内共享模块 `wuku-state.ts` 的 WeakMap 里（上限 3，见该文件）。
import type {
  Player,
  SkillEventPayload,
  SkillModule,
  SkillModuleCtx,
} from "../../../types/generals-pack.js";
import { EQUIPMENT_TYPES, addMark } from "./wuku-state.js";

const SKILL_ID = "群杜预/武库";

const findHolder = (ctx: SkillModuleCtx): Player | undefined =>
  ctx.players.find((player) => player.alive && ctx.hasSkill(player, SKILL_ID));

export default {
  id: "武库",
  displayName: "武库",
  kind: "triggered",
  globalHook: true,
  triggers: ["card_used", "equip_lost"],
  description:
    "锁定技，当你使用装备牌时或其他角色失去装备区内的一张牌时，你获得1枚“武库”标记（至多为3）。",
  onTrigger: {
    card_used: (ctx: SkillModuleCtx, payload: SkillEventPayload, logs: string[]) => {
      const holder = findHolder(ctx);
      if (!holder || payload.actor?.id !== holder.id) {
        return;
      }
      if (payload.reason !== "使用" || !payload.card || !EQUIPMENT_TYPES.has(payload.card.type)) {
        return;
      }
      const marks = addMark(holder);
      logs.push(`${holder.name} 使用装备${payload.card.type}，武库标记 +1（当前 ${marks} 枚）`);
    },
    equip_lost: (ctx: SkillModuleCtx, payload: SkillEventPayload, logs: string[]) => {
      const holder = findHolder(ctx);
      if (!holder || !payload.equip) {
        return;
      }
      // 只计其他角色失装；自己失装不计（防与 card_used 双计）。
      if (payload.actor?.id === holder.id) {
        return;
      }
      const marks = addMark(holder);
      logs.push(
        `${payload.actor?.name ?? "一名角色"}失去装备${payload.equip}，${holder.name} 武库标记 +1（当前 ${marks} 枚）`,
      );
    },
  },
} satisfies SkillModule;
