// 强袭（界典韦）— 主动代码技能。
//
// 规则（界限突破，2020版）：出牌阶段对每名角色各限一次，
// 你可以失去 1 点体力或弃置一张武器牌，
// 然后对攻击范围内的一名其他角色造成 1 点伤害。
//
// 实现要点：
// - "对每名角色各限一次"：按目标分别计数，key 为 `强袭:<targetId>`，
//   存在 ctx.skillCountsThisTurn.get(player.id) 里（引擎每回合自动重置）。
//   canUse 只判断"是否还有可指定的目标"，getTargets 过滤掉本回合已指定过的。
// - 代价二选一（官方 FAQ：武器牌包括手牌和已装备的牌，全包括）：
//   a) 失去 1 点体力：直接 hp -= 1（"失去"非"受到伤害"，不触发伤害类钩子）。
//      1 体力也可发动：先结算自己的濒死/死亡（resolveDeaths→resolveWinner→
//      advanceIfCurrentPlayerDead），若对局未结束则目标仍受到 1 点伤害（官方 FAQ）。
//   b) 弃置一张武器牌：手牌中的武器牌走 choose-discard 选牌（调用方手动置入弃牌堆）；
//      已装备的武器无 Card 实体，直接置空并往弃牌堆补一张合成牌（牌堆计数自洽）。
//      若手牌和装备区都有武器，优先让玩家从手牌选（交互）；手牌无武器时用已装备的。
// - 伤害走 ctx.applyDamage，随后自行 resolveDeaths → resolveWinner →
//   advanceIfCurrentPlayerDead，否则濒死与胜负会静默不结算（见张角「雷击」）。
//
// 引擎限制：
// - "攻击范围内"需要距离计算，本引擎未向武将包暴露距离 API，简化为可指定任意
//   其他存活角色（不计距离/马匹修正），general.md 如实记录。
// - 弃置已装备武器未触发 equip_lost 钩子（SkillModuleCtx 未暴露 onLoseEquip），
//   general.md 如实记录。
//
// 注意：只 `import type`，类型信息运行时被完全擦除，故这个相对路径不影响实际加载。
import type { SkillModule, SkillModuleCtx } from "../../../types/generals-pack.js";
import type { Player } from "../../../types/generals-pack.js";

/** 武器牌类集合（手牌中可被弃置的武器）。 */
const WEAPON_TYPES = new Set([
  "诸葛连弩", "雌雄双股剑", "青釭剑", "寒冰剑", "银月枪", "古锭刀",
  "丈八蛇矛", "青龙偃月刀", "贯石斧", "方天画戟", "麒麟弓", "朱雀羽扇",
]);

/** 本回合已对某目标发动强袭？ */
const usedOn = (ctx: SkillModuleCtx, playerId: string, targetId: string): boolean =>
  (ctx.skillCountsThisTurn.get(playerId)?.get(`强袭:${targetId}`) ?? 0) > 0;

const markUsedOn = (ctx: SkillModuleCtx, playerId: string, targetId: string): void => {
  const counts = ctx.skillCountsThisTurn.get(playerId) ?? new Map<string, number>();
  counts.set(`强袭:${targetId}`, (counts.get(`强袭:${targetId}`) ?? 0) + 1);
  ctx.skillCountsThisTurn.set(playerId, counts);
};

/** 本回合还可指定的目标（存活、且本回合未对其发动过强袭）。 */
const availableTargets = (ctx: SkillModuleCtx, player: Player): Player[] =>
  ctx.players.filter(
    (candidate) => candidate.alive && candidate.id !== player.id && !usedOn(ctx, player.id, candidate.id),
  );

/** 手牌中的武器牌来源。 */
const handWeaponSources = (ctx: SkillModuleCtx, player: Player) =>
  ctx.buildUsableSources(player).filter(
    (source) => source.origin === "hand" && source.card !== undefined && WEAPON_TYPES.has(source.card.type),
  );

export default {
  id: "强袭",
  displayName: "强袭",
  kind: "active",
  requiresTarget: true,
  targetIntent: "enemy",
  label: "发动强袭（失去1体力/弃武器牌，对一名其他角色造成1点伤害，每名角色每回合限一次）",
  description:
    "出牌阶段对每名角色各限一次：你可以失去 1 点体力或弃置一张武器牌（手牌或已装备的），然后对一名其他角色造成 1 点伤害（暂不计距离/马匹修正）。",
  canUse: (ctx: SkillModuleCtx, player: Player) => {
    if (!player.alive || ctx.phase !== "出牌阶段") {
      return false;
    }
    return availableTargets(ctx, player).length > 0;
  },
  getTargets: (ctx: SkillModuleCtx, player: Player) =>
    availableTargets(ctx, player).map((candidate) => candidate.id),
  play: async (ctx: SkillModuleCtx, player: Player, targetId?: string) => {
    const logs: string[] = [];
    const target = ctx.players.find((candidate) => candidate.id === targetId && candidate.alive);
    if (!target || usedOn(ctx, player.id, target.id)) {
      return [`${player.name} 发动强袭失败：目标不合法或本回合已对其发动过`];
    }

    // 步骤一：支付代价（失去体力 / 弃置武器牌二选一）。
    const weapons = handWeaponSources(ctx, player);
    const hasWeapon = weapons.length > 0 || player.weapon !== null;
    let discardWeapon = false;
    if (hasWeapon) {
      const decision = await ctx.decide({
        kind: "optional-effect",
        requestId: ctx.nextInteractionId(),
        playerId: player.id,
        effect: "界典韦/强袭弃置武器",
        reason: "强袭：弃置一张武器牌（是）还是失去 1 点体力（否）？",
      });
      discardWeapon = decision.choice === "effect" && decision.enabled;
    }
    if (discardWeapon) {
      if (weapons.length > 0) {
        // 优先弃手牌中的武器牌（有 Card 实体，走选牌交互）。
        const pick = await ctx.decide({
          kind: "choose-discard",
          requestId: ctx.nextInteractionId(),
          playerId: player.id,
          reason: "强袭：选择一张武器牌弃置",
          sources: weapons,
          count: 1,
          allowPass: false,
        });
        if (pick.choice !== "card") {
          return [`${player.name} 发动强袭失败：未选择武器牌`];
        }
        const removed = await ctx.removeUsableCardBySourceId(player, pick.sourceId);
        if (removed) {
          ctx.discardPile.push(removed);
        }
        logs.push(`${player.name} 发动强袭，弃置一张武器手牌`);
      } else if (player.weapon !== null) {
        // 弃已装备的武器（装备区无 Card 实体，直接置空；补一张合成牌进弃牌堆）。
        const discarded = player.weapon;
        player.weapon = null;
        ctx.discardPile.push({
          id: `qiangxi-weapon-${ctx.nextInteractionId()}`,
          type: discarded,
          suit: "none",
          rank: 0,
          color: "colorless",
        });
        logs.push(`${player.name} 发动强袭，弃置已装备的武器 ${discarded}`);
      }
    } else {
      // 失去 1 点体力（"失去"非"受到伤害"，不触发伤害类钩子；1 体力也可发动）。
      player.hp -= 1;
      logs.push(`${player.name} 发动强袭，失去 1 点体力（剩余 ${player.hp}）`);
      if (player.hp <= 0) {
        // 官方 FAQ：1 体力发动时典韦先进入濒死结算；无论是否被救回，
        // 只要对局未结束，目标仍受到 1 点伤害。
        logs.push(...(await ctx.resolveDeaths()));
        const winnerLogs = ctx.resolveWinner();
        logs.push(...winnerLogs);
        await ctx.advanceIfCurrentPlayerDead(logs);
        if (winnerLogs.length > 0) {
          // 对局已分出胜负，不再造成伤害。
          return logs;
        }
      }
    }

    markUsedOn(ctx, player.id, target.id);
    ctx.markSkillUsed(player.id, "强袭");

    // 步骤二：对目标造成 1 点伤害，并结算死亡/胜负/回合推进。
    logs.push(`${player.name} 的强袭对 ${target.name} 造成 1 点伤害`);
    await ctx.applyDamage(player, target, 1, "强袭", logs);
    logs.push(...(await ctx.resolveDeaths()));
    logs.push(...ctx.resolveWinner());
    await ctx.advanceIfCurrentPlayerDead(logs);
    return logs;
  },
} satisfies SkillModule;
