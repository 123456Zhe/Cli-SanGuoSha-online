import { Card, CardType } from "./cards.js";
import { countRemovableSelfCards } from "./card-utils.js";
import { Player, SkillHook, SkillName, SkillTrigger } from "./types.js";

export type SkillHooksContext = {
  players: Player[];
  discardPile: Card[];
  rng: () => number;
  hasSkill(player: Player, skill: SkillName): boolean;
  shouldActivateOptionalEffect(player: Player, effect: SkillName | CardType): Promise<boolean>;
  drawCard(): Card | null;
  drawCards(playerId: string, count: number): number;
  discardFromPlayerHand(player: Player, count: number, logs: string[]): number;
  markSkillUsed(playerId: string, skill: SkillName): void;
  hasRemovableCard(player: Player): boolean;
  removeRandomCardFromPlayer(player: Player, mode: "弃置" | "获得", receiver?: Player): Promise<string[]>;
  drawJudgmentCard(reason: string, logs: string[]): Card | null;
  discardSelfCards(player: Player, count: number): Promise<string[]>;
  applyDamage(source: Player | null, target: Player, amount: number, reason: string, logs: string[]): Promise<void>;
};

export function createSkillHooks(ctx: SkillHooksContext): Record<SkillTrigger, SkillHook[]> {
  return {
    turn_start: [
      async (payload, logs) => {
        const actor = payload.actor;
        if (!actor || !ctx.hasSkill(actor, SkillName.LuoShen) || !await ctx.shouldActivateOptionalEffect(actor, SkillName.LuoShen)) {
          return;
        }
        const suitNames = { heart: "红桃", diamond: "方片", club: "梅花", spade: "黑桃", none: "无花色" } as const;
        let gained = 0;
        while (true) {
          const card = ctx.drawCard();
          if (!card) {
            logs.push(`${actor.name} 的${SkillName.LuoShen}判定失败：牌堆为空`);
            break;
          }
          if (card.color === "black") {
            actor.hand.push(card);
            gained += 1;
            logs.push(`${actor.name} 的${SkillName.LuoShen}判定：${suitNames[card.suit]}${card.rank} ${card.type}，获得之`);
            continue;
          }
          ctx.discardPile.push(card);
          logs.push(`${actor.name} 的${SkillName.LuoShen}判定：${suitNames[card.suit]}${card.rank} ${card.type}，停止判定`);
          break;
        }
        if (gained > 0) logs.push(`${actor.name} 的${SkillName.LuoShen}生效，共获得 ${gained} 张牌`);
      },
      (payload, logs) => {
        const actor = payload.actor;
        if (!actor || !ctx.hasSkill(actor, SkillName.HunZi)) {
          return;
        }
        if (actor.skills.includes(SkillName.YingHun)) {
          return;
        }
        if (actor.hp !== 1) {
          return;
        }
        const newMax = Math.max(1, actor.maxHp - 1);
        actor.maxHp = newMax;
        actor.skills.push(SkillName.Heroic, SkillName.YingHun);
        logs.push(`${actor.name} 的${SkillName.HunZi}觉醒，体力上限-1 并获得${SkillName.Heroic}、${SkillName.YingHun}`);
      },
      async (payload, logs) => {
        const actor = payload.actor;
        if (!actor || !ctx.hasSkill(actor, SkillName.YingHun) || !await ctx.shouldActivateOptionalEffect(actor, SkillName.YingHun)) {
          return;
        }
        const lost = Math.max(0, actor.maxHp - actor.hp);
        if (lost <= 0) {
          return;
        }
        const others = ctx.players.filter((player) => player.alive && player.id !== actor.id);
        if (others.length === 0) {
          return;
        }
        const target = others.sort((a, b) => a.hp - b.hp || a.hand.length - b.hand.length)[0];
        if (!target) {
          return;
        }
        const x = lost;
        const option = ctx.rng() < 0.5 ? "draw" : "discard";
        if (option === "draw") {
          const drawn = ctx.drawCards(target.id, x);
          const discarded = ctx.discardFromPlayerHand(target, 1, logs);
          logs.push(`${actor.name} 的${SkillName.YingHun}生效，令 ${target.name} 摸 ${drawn} 张牌并弃置 ${discarded} 张牌`);
        } else {
          const drawn = ctx.drawCards(target.id, 1);
          const discarded = ctx.discardFromPlayerHand(target, x, logs);
          logs.push(`${actor.name} 的${SkillName.YingHun}生效，令 ${target.name} 摸 ${drawn} 张牌并弃置 ${discarded} 张牌`);
        }
      },
    ],
    before_draw: [
      async (payload, logs) => {
        const actor = payload.actor;
        if (!actor || payload.drawCount === undefined) {
          return;
        }
        if (!ctx.hasSkill(actor, SkillName.Heroic) || !await ctx.shouldActivateOptionalEffect(actor, SkillName.Heroic)) {
          return;
        }
        payload.drawCount += 1;
        logs.push(`${actor.name} 的${SkillName.Heroic}生效，额外摸 1 张牌`);
      },
      async (payload, logs) => {
        const actor = payload.actor;
        if (!actor || payload.drawCount === undefined) {
          return;
        }
        if (!ctx.hasSkill(actor, SkillName.LuoYi) || !await ctx.shouldActivateOptionalEffect(actor, SkillName.LuoYi) || payload.drawCount <= 0) {
          return;
        }
        payload.drawCount = Math.max(0, payload.drawCount - 1);
        ctx.markSkillUsed(actor.id, SkillName.LuoYi);
        logs.push(`${actor.name} 的${SkillName.LuoYi}生效，本回合少摸 1 张牌且伤害+1`);
      },
    ],
    before_damage: [],
    after_damage: [
      async (payload, logs) => {
        const target = payload.target;
        const source = payload.source;
        if (!target || !source || !source.alive || source.id === target.id) {
          return;
        }
        if (ctx.hasSkill(target, SkillName.FanKui) && await ctx.shouldActivateOptionalEffect(target, SkillName.FanKui) && ctx.hasRemovableCard(source)) {
          logs.push(...await ctx.removeRandomCardFromPlayer(source, "获得", target));
        }
        if (ctx.hasSkill(target, SkillName.JianXiong) && await ctx.shouldActivateOptionalEffect(target, SkillName.JianXiong)) {
          const drawn = ctx.drawCards(target.id, 1);
          logs.push(`${target.name} 的${SkillName.JianXiong}生效，摸了 ${drawn} 张牌`);
        }
        if (ctx.hasSkill(target, SkillName.YiJi) && await ctx.shouldActivateOptionalEffect(target, SkillName.YiJi)) {
          const drawn = ctx.drawCards(target.id, 2);
          logs.push(`${target.name} 的${SkillName.YiJi}生效，摸了 ${drawn} 张牌`);
        }
        if (ctx.hasSkill(target, SkillName.GangLie) && await ctx.shouldActivateOptionalEffect(target, SkillName.GangLie)) {
          const judgment = ctx.drawJudgmentCard(`${target.name} 的${SkillName.GangLie}`, logs);
          const succeeded = judgment !== null && judgment.suit !== "heart";
          logs.push(`${target.name} 发动${SkillName.GangLie}，判定${succeeded ? "成功" : "失败"}`);
          if (succeeded) {
            if (countRemovableSelfCards(source) >= 2) {
              logs.push(...(await ctx.discardSelfCards(source, 2)));
              logs.push(`${source.name} 为响应${SkillName.GangLie}弃置了 2 张牌`);
            } else {
              logs.push(`${source.name} 无法弃置 2 张牌，受到${SkillName.GangLie}的 1 点伤害`);
              await ctx.applyDamage(target, source, 1, SkillName.GangLie, logs);
            }
          }
        }
      },
    ],
  };
}
