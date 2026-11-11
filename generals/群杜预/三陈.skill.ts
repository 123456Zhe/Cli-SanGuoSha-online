// 三陈（群杜预）— 触发性代码技能，挂 Phase 8 的两个新触发点。
//
// 规则（Fandom 身份局版，繁体原文「三陳」）：觉醒技，准备阶段或结束阶段，
// 若你的“武庫”标记数为3，你加1点体力上限，回复1点体力，获得“滅吳”。
//
// 实现要点：
// - 触发点 `prepare_phase_start` / `end_phase_start` 由引擎在回合首尾发射，
//   payload.actor 即当前回合玩家；包装层只在 actor 持有本技能时放行，
//   所以本技能只在杜预自己的准备/结束阶段判定，不用 globalHook。
// - 觉醒强制（非 optional）：标记满 3 即觉醒；觉醒后把命名空间 id
//   `群杜预/灭吴` push 进 actor.skills（潜在技能，见 general.json 的 latentSkills），
//   之后灭吴的转换即被枚举；觉醒标志记在 wuku-state.ts，防重复觉醒。
// - 已知收窄：翻面跳过回合时 prepare_phase_start 仍会发射（引擎已知的小偏差，
//   见 docs/generals-pack-api.md 的触发点一节），三陈仍会在该准备阶段判定一次。
import type {
  SkillEventPayload,
  SkillModule,
  SkillModuleCtx,
} from "../../../types/generals-pack.js";
import { getMarks, isAwakened, setAwakened } from "./wuku-state.js";

const SKILL_ID = "群杜预/三陈";

const awaken = (ctx: SkillModuleCtx, payload: SkillEventPayload, logs: string[]): void => {
  const actor = payload.actor;
  if (!actor || !actor.alive || !ctx.hasSkill(actor, SKILL_ID)) {
    return;
  }
  if (isAwakened(actor) || getMarks(actor) < 3) {
    return;
  }
  actor.maxHp += 1;
  actor.hp = Math.min(actor.maxHp, actor.hp + 1);
  actor.skills.push("群杜预/灭吴");
  setAwakened(actor);
  logs.push(`${actor.name} 的三陈觉醒：体力上限 +1，回复 1 点体力，获得灭吴`);
};

export default {
  id: "三陈",
  displayName: "三陈",
  kind: "triggered",
  triggers: ["prepare_phase_start", "end_phase_start"],
  description:
    "觉醒技，准备阶段或结束阶段，若你的“武库”标记数为3，你加1点体力上限，回复1点体力，获得“灭吴”。",
  onTrigger: {
    prepare_phase_start: (ctx: SkillModuleCtx, payload: SkillEventPayload, logs: string[]) => {
      awaken(ctx, payload, logs);
    },
    end_phase_start: (ctx: SkillModuleCtx, payload: SkillEventPayload, logs: string[]) => {
      awaken(ctx, payload, logs);
    },
  },
} satisfies SkillModule;
