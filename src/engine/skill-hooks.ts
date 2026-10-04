import { Card, CardType } from "./cards.js";
import { countRemovableSelfCards, DamageKind } from "./card-utils.js";
import { getPackHooksFor } from "./skill-module.js";
import type { SkillModuleCtx } from "./skill-module.js";
import { resolveSkillDescriptor } from "./skill-registry.js";
import { InteractionDecision, InteractionRequest, Player, SkillHook, SkillName, SkillTrigger } from "./types.js";

const PACK_TRIGGERS: SkillTrigger[] = ["turn_start", "before_draw", "before_damage", "after_damage"];

export type SkillHooksContext = {
  players: Player[];
  discardPile: Card[];
  rng: () => number;
  hasSkill(player: Player, skill: SkillName): boolean;
  shouldActivateOptionalEffect(player: Player, effect: SkillName | CardType): Promise<boolean>;
  drawCard(): Card | null;
  drawCards(playerId: string, count: number): number;
  discardFromPlayerHand(player: Player, count: number, logs: string[]): Promise<number>;
  takeRandomHandCard(player: Player, receiver: Player): Promise<Card | undefined>;
  drawTopCards(count: number): Card[];
  placeCardsOnTop(cards: Card[]): void;
  placeCardsOnBottom(cards: Card[]): void;
  decide(request: InteractionRequest): Promise<InteractionDecision>;
  nextInteractionId(): number;
  markSkillUsed(playerId: string, skill: SkillName): void;
  hasRemovableCard(player: Player): boolean;
  removeRandomCardFromPlayer(player: Player, mode: "弃置" | "获得", receiver?: Player): Promise<string[]>;
  drawJudgmentCard(reason: string, logs: string[], owner: Player): Promise<Card | null>;
  discardSelfCards(player: Player, count: number): Promise<string[]>;
  applyDamage(
    source: Player | null,
    target: Player,
    amount: number,
    reason: string,
    logs: string[],
    damageCard?: Card,
    damageKind?: DamageKind | null,
    isChainSpread?: boolean,
  ): Promise<void>;
};

/** 魂姿觉醒：体力降到 1 时（含回合开始）触发，已有英魂则跳过（防重复）。 */
const tryAwakenHunZi = (ctx: SkillHooksContext, actor: Player | undefined, logs: string[]): void => {
  if (!actor || !ctx.hasSkill(actor, SkillName.HunZi)) {
    return;
  }
  if (actor.skills.includes(SkillName.YingHun)) {
    return;
  }
  if (actor.hp !== 1) {
    return;
  }
  actor.maxHp = Math.max(1, actor.maxHp - 1);
  actor.skills.push(SkillName.Heroic, SkillName.YingHun);
  logs.push(`${actor.name} 的${SkillName.HunZi}觉醒，体力上限-1 并获得${SkillName.Heroic}、${SkillName.YingHun}`);
};

export function createSkillHooks(ctx: SkillHooksContext): Record<SkillTrigger, SkillHook[]> {
  const hooks: Record<SkillTrigger, SkillHook[]> = {
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
        tryAwakenHunZi(ctx, payload.actor, logs);
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
          const discarded = await ctx.discardFromPlayerHand(target, 1, logs);
          logs.push(`${actor.name} 的${SkillName.YingHun}生效，令 ${target.name} 摸 ${drawn} 张牌并弃置 ${discarded} 张牌`);
        } else {
          const drawn = ctx.drawCards(target.id, 1);
          const discarded = await ctx.discardFromPlayerHand(target, x, logs);
          logs.push(`${actor.name} 的${SkillName.YingHun}生效，令 ${target.name} 摸 ${drawn} 张牌并弃置 ${discarded} 张牌`);
        }
      },
      async (payload, logs) => {
        const actor = payload.actor;
        if (!actor || !ctx.hasSkill(actor, SkillName.GuanXing) || !await ctx.shouldActivateOptionalEffect(actor, SkillName.GuanXing)) {
          return;
        }
        const aliveCount = ctx.players.filter((player) => player.alive).length;
        const count = Math.min(5, aliveCount);
        if (count <= 0) {
          return;
        }
        const drawn = ctx.drawTopCards(count);
        if (drawn.length === 0) {
          return;
        }
        const suitNames = { heart: "红桃", diamond: "方片", club: "梅花", spade: "黑桃", none: "无花色" } as const;
        logs.push(`${actor.name} 的${SkillName.GuanXing}生效，查看了牌堆顶 ${drawn.length} 张牌`);
        const kept: Card[] = [];
        const remaining = [...drawn];
        while (remaining.length > 0) {
          const sources = remaining.map((card) => ({
            sourceId: `guangxing:${card.id}`,
            origin: "hand" as const,
            card,
            label: `${suitNames[card.suit]}${card.rank} ${card.type}`,
          }));
          const decision = await ctx.decide({
            kind: "choose-discard",
            requestId: ctx.nextInteractionId(),
            playerId: actor.id,
            reason: `${SkillName.GuanXing}：选择保留在牌堆顶的牌（其余置入牌堆底）`,
            sources,
            count: 1,
            allowPass: true,
            passLabel: "完成观星",
          });
          if (decision.choice !== "card") {
            break;
          }
          const pickedCard = remaining.find((card) => card.id === decision.sourceId.slice("guangxing:".length));
          if (!pickedCard) {
            break;
          }
          remaining.splice(remaining.indexOf(pickedCard), 1);
          kept.push(pickedCard);
        }
        ctx.placeCardsOnTop(kept);
        ctx.placeCardsOnBottom(remaining);
        logs.push(`${actor.name} 的${SkillName.GuanXing}结束：${kept.length} 张牌置于牌堆顶，${remaining.length} 张置于牌堆底`);
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
        payload.drawCount += resolveSkillDescriptor(SkillName.Heroic).rules?.drawPhaseDelta ?? 1;
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
        payload.drawCount = Math.max(0, payload.drawCount + (resolveSkillDescriptor(SkillName.LuoYi).rules?.drawPhaseDelta ?? -1));
        ctx.markSkillUsed(actor.id, SkillName.LuoYi);
        logs.push(`${actor.name} 的${SkillName.LuoYi}生效，本回合少摸 1 张牌且伤害+1`);
      },
      async (payload, logs) => {
        const actor = payload.actor;
        if (!actor || payload.drawCount === undefined) {
          return;
        }
        if (!ctx.hasSkill(actor, SkillName.TuXi) || !await ctx.shouldActivateOptionalEffect(actor, SkillName.TuXi)) {
          return;
        }
        payload.drawCount = 0;
        const targets = ctx.players
          .filter((item) => item.alive && item.id !== actor.id && item.hand.length > 0)
          .sort((a, b) => b.hand.length - a.hand.length || a.hp - b.hp)
          .slice(0, 2);
        if (targets.length === 0) {
          logs.push(`${actor.name} 发动${SkillName.TuXi}，但没有可突袭的角色，本回合跳过摸牌`);
          return;
        }
        let obtained = 0;
        for (const target of targets) {
          const card = await ctx.takeRandomHandCard(target, actor);
          if (card) {
            obtained += 1;
            logs.push(`${actor.name} 发动${SkillName.TuXi}，从 ${target.name} 处获得 1 张手牌`);
          }
        }
        logs.push(`${actor.name} 的${SkillName.TuXi}生效，本回合改为从 ${obtained} 名角色处各获得 1 张手牌`);
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
          // 原版奸雄：获得造成本次伤害的牌（通常已在弃牌堆；闪电等在判定区）
          const damageCard = payload.card;
          let taken: Card | undefined;
          if (damageCard) {
            const discardIdx = ctx.discardPile.findIndex((card) => card.id === damageCard.id);
            if (discardIdx >= 0) {
              taken = ctx.discardPile.splice(discardIdx, 1)[0];
            } else {
              for (const player of ctx.players) {
                const trickIdx = player.delayedTricks.findIndex((trick) => trick.card?.id === damageCard.id);
                if (trickIdx >= 0) {
                  const trick = player.delayedTricks[trickIdx];
                  if (trick?.card) {
                    player.delayedTricks.splice(trickIdx, 1);
                    taken = trick.card;
                    break;
                  }
                }
              }
            }
          }
          if (taken) {
            target.hand.push(taken);
            logs.push(`${target.name} 的${SkillName.JianXiong}生效，获得了 ${taken.type}`);
          } else {
            logs.push(`${target.name} 的${SkillName.JianXiong}生效，但没有可获得的牌`);
          }
        }
        if (ctx.hasSkill(target, SkillName.YiJi) && await ctx.shouldActivateOptionalEffect(target, SkillName.YiJi)) {
          const drawn = ctx.drawCards(target.id, 2);
          logs.push(`${target.name} 的${SkillName.YiJi}生效，摸了 ${drawn} 张牌`);
        }
        if (ctx.hasSkill(target, SkillName.GangLie) && await ctx.shouldActivateOptionalEffect(target, SkillName.GangLie)) {
          const judgment = await ctx.drawJudgmentCard(`${target.name} 的${SkillName.GangLie}`, logs, target);
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
      (payload, logs) => {
        // 魂姿：回合外掉血到 1 也立即觉醒（原本只在 turn_start 检查）。
        tryAwakenHunZi(ctx, payload.target, logs);
      },
    ],
  };
  // 外部武将包技能：每个触发点在内置钩子之后追加。
  const packCtx = ctx as unknown as SkillModuleCtx;
  for (const trigger of PACK_TRIGGERS) {
    for (const entry of getPackHooksFor(trigger)) {
      hooks[trigger].push((payload, logs) => entry.onTrigger?.[trigger]?.(packCtx, payload, logs));
    }
  }
  return hooks;
}
