import { Card, CardType } from "./cards.js";
import {
  countRemovableSelfCards,
  DamageKind,
  hasRemovableCard,
  isArmorCard,
  isAttackHorseCard,
  isDefenseHorseCard,
  isSlashCard,
  isWeaponCard,
  slashKindOf,
  SlashKind,
  usableCardCount,
} from "./card-utils.js";
import { resolveGeneralByName } from "./generals.js";
import { getSkillRules, isImmuneTo, sumActivatedRules } from "./skill-rules.js";
import {
  CardSource,
  EquipCardType,
  InteractionDecision,
  InteractionRequest,
  KINGDOM,
  Player,
  PlayerRole,
  ResponseKind,
  SkillName,
} from "./types.js";

export type ResolveContext = {
  players: Player[];
  discardPile: Card[];
  winner: "human" | "ai" | "draw" | null;
  deferDyingResolution: boolean;
  skipDrawPhase: string | null;
  skipPlayPhase: string | null;
  turn: number;
  mustGetPlayer(id: string): Player;
  hasSkill(player: Player, skill: SkillName): boolean;
  shouldActivateOptionalEffect(player: Player, effect: SkillName | CardType): Promise<boolean>;
  isSkillUsed(playerId: string, skill: SkillName): boolean;
  isKongChengProtected(target: Player, cardType: CardType): boolean;
  decide(request: InteractionRequest): Promise<InteractionDecision>;
  nextInteractionId(): number;
  buildUsableSources(player: Player): CardSource[];
  removeUsableCardBySourceId(player: Player, sourceId: string): Promise<Card | undefined>;
  removeHandCardAt(player: Player, index: number, logs?: string[]): Promise<Card | undefined>;
  drawCards(playerId: string, count: number): number;
  drawJudgmentCard(reason: string, logs: string[], owner: Player): Promise<Card | null>;
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
  discardSelfCards(player: Player, count: number): Promise<string[]>;
  canPlayerRespond(playerId: string, kind: ResponseKind): boolean;
  setPlayerResponseSelection(playerId: string, kind: ResponseKind, optionId: string | null): void;
  requestCardResponse(
    player: Player,
    kind: ResponseKind,
    trigger: { cardName: string; actorId: string },
    logs: string[],
  ): Promise<boolean>;
  consumePeachResponse(player: Player, dyingPlayerId: string, logs: string[]): Promise<boolean>;
  randomIndex(length: number): number;
  buildSlashSources(player: Player): CardSource[];
  /** 酒的"下一张杀伤害+1"：若玩家有酒增益则消耗并返回 true */
  consumeWineBuff(player: Player): boolean;
  /** 记录最近一次伤害的来源，供死亡结算的击杀奖惩使用；null 表示无来源（闪电、苦肉等） */
  noteDamageSource(sourceId: string | null, targetId: string): void;
  /** 取出并清除目标的伤害来源（死亡结算时消费一次，避免旧伤害被重复计入） */
  takeDamageSource(targetId: string): string | null;
};

export function resolveSlash(
  ctx: ResolveContext,
  attacker: Player,
  target: Player,
  fromSerpent = false,
  kind: SlashKind = "normal",
  damageCard?: Card,
): Promise<string[]> {
  return (async () => {
    const kindName = kind === "fire" ? CardType.FireSlash : kind === "thunder" ? CardType.ThunderSlash : CardType.Slash;
    const logs = [`${attacker.name} 对 ${target.name} 使用${kindName}`];
    await triggerJiAng(ctx, attacker, target, damageCard?.color === "red", logs);
    if (ctx.isKongChengProtected(target, CardType.Slash)) {
      logs.push(`${target.name} 的${SkillName.KongCheng}生效，无法成为杀的目标`);
      return logs;
    }
    if (fromSerpent) {
      logs.push("本次杀来自丈八蛇矛转化");
    }
    // 流离：成为杀目标时，可弃1张牌将此杀转移给攻击范围内的其他角色
    if (ctx.hasSkill(target, SkillName.LiuLi)) {
      const redirectCandidates = ctx.players.filter(
        (player) => player.alive && player.id !== target.id && player.id !== attacker.id && canReachForSlash(ctx, target, player),
      );
      const liuLiSources = ctx.buildUsableSources(target);
      if (redirectCandidates.length > 0 && liuLiSources.length > 0) {
        const discardDecision = await ctx.decide({
          kind: "choose-discard",
          requestId: ctx.nextInteractionId(),
          playerId: target.id,
          reason: `${target.name} 的${SkillName.LiuLi}：弃置1张牌以将此杀转移？`,
          sources: liuLiSources,
          count: 1,
          allowPass: true,
          passLabel: `不发动${SkillName.LiuLi}`,
        });
        if (discardDecision.choice === "card") {
          const discarded = await ctx.removeUsableCardBySourceId(target, discardDecision.sourceId);
          if (discarded) {
            ctx.discardPile.push(discarded);
            const redirectDecision = await ctx.decide({
              kind: "collateral",
              requestId: ctx.nextInteractionId(),
              targetId: target.id,
              actorId: attacker.id,
              victims: redirectCandidates.map((player) => player.id),
              sources: [],
              allowHandOverWeapon: false,
              reason: `${SkillName.LiuLi}：将此杀转移给攻击范围内的其他角色`,
            });
            const chosen =
              redirectDecision.choice === "target"
                ? redirectCandidates.find((player) => player.id === redirectDecision.targetId)
                : undefined;
            if (chosen) {
              logs.push(`${target.name} 发动${SkillName.LiuLi}，弃置 ${discarded.type} 将杀转移给 ${chosen.name}`);
              logs.push(...(await resolveSlash(ctx, attacker, chosen, fromSerpent, kind, damageCard)));
              return logs;
            }
          }
        }
      }
    }
    const ignoreArmor = attacker.weapon === CardType.QinggangSword && await ctx.shouldActivateOptionalEffect(attacker, CardType.QinggangSword);
    if (kind === "normal" && !ignoreArmor && target.armor === CardType.VineArmor) {
      logs.push(`${target.name} 的藤甲生效，抵消了杀`);
      return logs;
    }
    if (!ignoreArmor && target.armor === CardType.RenWangShield && damageCard?.color === "black") {
      logs.push(`${target.name} 的仁王盾生效，抵消了黑色的杀`);
      return logs;
    }
    if (attacker.weapon === CardType.FemaleSword && await ctx.shouldActivateOptionalEffect(attacker, CardType.FemaleSword) && attacker.gender !== target.gender) {
      if (usableCardCount(target) > 0) {
        const decision = await ctx.decide({
          kind: "choose-discard",
          requestId: ctx.nextInteractionId(),
          playerId: target.id,
          reason: `${attacker.name} 的雌雄双股剑：弃置1张牌，或令其摸1张牌`,
          sources: ctx.buildUsableSources(target),
          count: 1,
          allowPass: true,
          passLabel: `令${attacker.name}摸1张牌`,
        });
        if (decision.choice === "card") {
          const removed = await ctx.removeUsableCardBySourceId(target, decision.sourceId);
          if (removed) {
            ctx.discardPile.push(removed);
            logs.push(`${attacker.name} 的雌雄双股剑生效，${target.name} 弃置了 ${removed.type}`);
          }
        } else {
          const drawn = ctx.drawCards(attacker.id, 1);
          logs.push(`${attacker.name} 的雌雄双股剑生效，摸了 ${drawn} 张牌`);
        }
      } else {
        const drawn = ctx.drawCards(attacker.id, 1);
        logs.push(`${attacker.name} 的雌雄双股剑生效，摸了 ${drawn} 张牌`);
      }
    }
    if (!ignoreArmor && target.armor === CardType.EightDiagram) {
      const judgment = await ctx.drawJudgmentCard(`${target.name} 的八卦阵`, logs, target);
      if (judgment?.color === "red") {
        logs.push(`${target.name} 的八卦阵判定为红色，视为打出闪`);
        return logs;
      }
    }
    let requireDodgeCount = getSkillRules(attacker).responseMultiplier;
    if (ctx.hasSkill(attacker, SkillName.TieQi) && await ctx.shouldActivateOptionalEffect(attacker, SkillName.TieQi)) {
      const judgment = await ctx.drawJudgmentCard(`${attacker.name} 的${SkillName.TieQi}`, logs, attacker);
      if (judgment?.color === "red") {
        requireDodgeCount = 0;
        logs.push(`${attacker.name} 的${SkillName.TieQi}判定为红色，此杀不可被闪避`);
      }
    }
    let dodged = true;
    if (requireDodgeCount > 1) {
      const available = countAvailableDodgeResponses(ctx, target);
      if (available < requireDodgeCount) {
        logs.push(`${target.name} 面对${SkillName.WuShuang}，需 ${requireDodgeCount} 张闪抵消，仅有 ${available} 张，未能抵消`);
        dodged = false;
      } else {
        for (let i = 0; i < requireDodgeCount; i += 1) {
          if (!(await consumeDodgeResponse(ctx, target, { cardName: kindName, actorId: attacker.id }, logs))) {
            dodged = false;
            break;
          }
        }
      }
    } else {
      for (let i = 0; i < requireDodgeCount; i += 1) {
        if (!(await consumeDodgeResponse(ctx, target, { cardName: kindName, actorId: attacker.id }, logs))) {
          dodged = false;
          break;
        }
      }
    }
    if (dodged && requireDodgeCount > 0) {
      const wushuangNote = requireDodgeCount > 1 ? `（${SkillName.WuShuang}消耗 ${requireDodgeCount} 张闪）` : "";
      logs.push(`${target.name} 打出闪，抵消了杀${wushuangNote}`);
      if (attacker.weapon === CardType.RockCleavingAxe && await ctx.shouldActivateOptionalEffect(attacker, CardType.RockCleavingAxe) && countRemovableSelfCards(attacker) >= 2) {
        logs.push(...(await ctx.discardSelfCards(attacker, 2)));
        logs.push(`${attacker.name} 的贯石斧生效，此次杀强制命中`);
      } else if (attacker.weapon === CardType.GreenDragonBlade && await ctx.shouldActivateOptionalEffect(attacker, CardType.GreenDragonBlade)) {
        const nextSlash = attacker.hand.findIndex((card) => isSlashCard(card.type));
        if (nextSlash >= 0) {
          const slash = await ctx.removeHandCardAt(attacker, nextSlash, logs);
          if (slash) {
            ctx.discardPile.push(slash);
            logs.push(`${attacker.name} 的青龙偃月刀生效，追加一张杀`);
            logs.push(...(await resolveSlash(ctx, attacker, target, false, slashKindOf(attacker, slash.type), slash)));
            return logs;
          }
        }
        // 没有额外杀可追加，闪避有效
        return logs;
      } else {
        return logs;
      }
    }
    if (attacker.weapon === CardType.IceSword && await ctx.shouldActivateOptionalEffect(attacker, CardType.IceSword) && hasRemovableCard(target)) {
      logs.push(`${attacker.name} 的寒冰剑生效，防止本次伤害并弃置目标2张牌`);
      logs.push(...await removeRandomCardFromPlayer(ctx, target, "弃置"));
      if (hasRemovableCard(target)) {
        logs.push(...await removeRandomCardFromPlayer(ctx, target, "弃置"));
      }
      return logs;
    }
    let damage = 1;
    if (kind === "fire" && target.armor === CardType.VineArmor) {
      damage += 1;
      logs.push(`${target.name} 的藤甲受到火焰克制，伤害+1`);
    }
    if (ctx.consumeWineBuff(attacker)) {
      damage += 1;
      logs.push(`${attacker.name} 的酒生效，本次杀伤害+1`);
    }
    if (attacker.weapon === CardType.GudingBlade && await ctx.shouldActivateOptionalEffect(attacker, CardType.GudingBlade) && target.hand.length === 0) {
      damage += 1;
      logs.push(`${attacker.name} 的古锭刀生效，伤害+1`);
    }
    const slashDamageBonus = sumActivatedRules(attacker, "damageDelta", (id) => ctx.isSkillUsed(attacker.id, id));
    if (slashDamageBonus !== 0) {
      damage += slashDamageBonus;
      logs.push(`${attacker.name} 的伤害加成技能生效，本次杀伤害${slashDamageBonus > 0 ? "+" : ""}${slashDamageBonus}`);
    }
    await ctx.applyDamage(attacker, target, damage, "杀", logs, damageCard, kind === "normal" ? null : kind);
    if (attacker.weapon === CardType.KylinBow && await ctx.shouldActivateOptionalEffect(attacker, CardType.KylinBow)) {
      const horseLogs = removeHorseEquip(ctx, target);
      logs.push(...horseLogs);
    }
    return logs;
  })();
}

export function resolveDismantle(ctx: ResolveContext, user: Player, target: Player, selectedCardId?: string): Promise<string[]> {
  return (async () => {
    const logs = [`${user.name} 对 ${target.name} 使用过河拆桥`];
    if (await tryNegate(ctx, target, CardType.Dismantle, logs, user.id)) {
      return logs;
    }
    if (!hasRemovableCard(target)) {
      logs.push(`${target.name} 没有可拆的牌`);
      return logs;
    }
    if (selectedCardId) {
      const removedByChoice = await removeSelectedCardFromPlayer(ctx, target, "弃置", selectedCardId);
      if (removedByChoice.length > 0) {
        logs.push(...removedByChoice);
        return logs;
      }
    }
    logs.push(...await removeRandomCardFromPlayer(ctx, target, "弃置"));
    return logs;
  })();
}

export function resolveSnatch(ctx: ResolveContext, user: Player, target: Player, selectedCardId?: string): Promise<string[]> {
  return (async () => {
    const logs = [`${user.name} 对 ${target.name} 使用顺手牵羊`];
    if (isImmuneTo(target, "snatch")) {
      logs.push(`${target.name} 的${SkillName.QianXun}生效，不能成为顺手牵羊的目标`);
      return logs;
    }
    if (!canReachForDistanceOneTrick(ctx, user, target)) {
      logs.push(`${target.name} 距离 ${user.name} 超过 1，${CardType.Snatch}无效`);
      return logs;
    }
    if (await tryNegate(ctx, target, CardType.Snatch, logs, user.id)) {
      return logs;
    }
    if (!hasRemovableCard(target)) {
      logs.push(`${target.name} 没有可获得的牌`);
      return logs;
    }
    if (selectedCardId) {
      const removedByChoice = await removeSelectedCardFromPlayer(ctx, target, "获得", selectedCardId, user);
      if (removedByChoice.length > 0) {
        logs.push(...removedByChoice);
        return logs;
      }
    }
    logs.push(...await removeRandomCardFromPlayer(ctx, target, "获得", user));
    return logs;
  })();
}

export function resolveDuel(ctx: ResolveContext, user: Player, target: Player, duelCard?: Card): Promise<string[]> {
  return (async () => {
    const logs = [`${user.name} 对 ${target.name} 发起决斗`];
    await triggerJiAng(ctx, user, target, duelCard?.color === "red", logs);
    if (ctx.isKongChengProtected(target, CardType.Duel)) {
      logs.push(`${target.name} 的${SkillName.KongCheng}生效，无法成为决斗目标`);
      return logs;
    }
    if (await tryNegate(ctx, target, CardType.Duel, logs, user.id)) {
      return logs;
    }
    let attacker = user;
    let defender = target;
    while (true) {
      const needCount = getSkillRules(attacker).responseMultiplier;
      let valid = true;
      const available = countAvailableSlashResponses(ctx, defender);
      if (available < needCount) {
        if (needCount > 1) {
          logs.push(`${defender.name} 面对${SkillName.WuShuang}，需 ${needCount} 张杀响应，仅有 ${available} 张，未能响应`);
        }
        valid = false;
      } else {
        for (let i = 0; i < needCount; i += 1) {
          if (!(await consumeSlashResponse(ctx, defender, { cardName: CardType.Duel, actorId: attacker.id }, logs))) {
            valid = false;
            break;
          }
        }
      }
      if (!valid) {
        let damage = 1;
        const duelDamageBonus = sumActivatedRules(attacker, "damageDelta", (id) => ctx.isSkillUsed(attacker.id, id));
        if (duelDamageBonus !== 0) {
          damage += duelDamageBonus;
          logs.push(`${attacker.name} 的伤害加成技能生效，本次决斗伤害${duelDamageBonus > 0 ? "+" : ""}${duelDamageBonus}`);
        }
        await ctx.applyDamage(attacker, defender, damage, "决斗", logs, duelCard);
        break;
      }
      const wushuangNote = needCount > 1 ? `（${SkillName.WuShuang}消耗 ${needCount} 张杀）` : "";
      logs.push(`${defender.name} 打出杀响应决斗${wushuangNote}`);
      const swap = attacker;
      attacker = defender;
      defender = swap;
    }
    return logs;
  })();
}

export function resolveBarbarian(ctx: ResolveContext, user: Player, trickCard?: Card): Promise<string[]> {
  return (async () => {
    const logs = [`${user.name} 使用南蛮入侵`];
    for (const target of ctx.players) {
      if (!target.alive || target.id === user.id) {
        continue;
      }
      if (await tryNegate(ctx, target, CardType.Barbarian, logs, user.id)) {
        continue;
      }
      if (target.armor === CardType.VineArmor) {
        logs.push(`${target.name} 的藤甲生效，抵消南蛮入侵`);
        continue;
      }
      if (await consumeSlashResponse(ctx, target, { cardName: CardType.Barbarian, actorId: user.id }, logs)) {
        logs.push(`${target.name} 打出杀，抵消南蛮入侵`);
      } else {
        await ctx.applyDamage(user, target, 1, "南蛮入侵", logs, trickCard);
      }
    }
    return logs;
  })();
}

export function resolveArrowRain(ctx: ResolveContext, user: Player, trickCard?: Card): Promise<string[]> {
  return (async () => {
    const logs = [`${user.name} 使用万箭齐发`];
    for (const target of ctx.players) {
      if (!target.alive || target.id === user.id) {
        continue;
      }
      if (await tryNegate(ctx, target, CardType.ArrowRain, logs, user.id)) {
        continue;
      }
      if (target.armor === CardType.VineArmor) {
        logs.push(`${target.name} 的藤甲生效，抵消万箭齐发`);
        continue;
      }
      if (await consumeDodgeResponse(ctx, target, { cardName: CardType.ArrowRain, actorId: user.id }, logs)) {
        logs.push(`${target.name} 打出闪，抵消万箭齐发`);
      } else {
        await ctx.applyDamage(user, target, 1, "万箭齐发", logs, trickCard);
      }
    }
    return logs;
  })();
}

export function resolveCollateral(ctx: ResolveContext, user: Player, target: Player): Promise<string[]> {
  return (async () => {
    const logs = [`${user.name} 对 ${target.name} 使用借刀杀人`];
    if (await tryNegate(ctx, target, CardType.Collateral, logs, user.id)) {
      return logs;
    }
    const slashSources = ctx.buildSlashSources(target);
    const victims =
      slashSources.length > 0
        ? ctx.players
            .filter(
              (player) =>
                player.alive &&
                player.id !== user.id &&
                player.id !== target.id &&
                canReachForSlash(ctx, target, player) &&
                !ctx.isKongChengProtected(player, CardType.Slash),
            )
            .sort((a, b) => a.hp - b.hp || a.hand.length - b.hand.length)
        : [];
    if (victims.length === 0) {
      if (target.weapon === null) {
        logs.push(`${target.name} 无法出杀且没有攻击目标`);
        return logs;
      }
      logs.push(...(await removeSelectedCardFromPlayer(ctx, target, "获得", "weapon", user)));
      return logs;
    }

    // Phase 1: Card user (Player A) chooses the victim
    const victimDecision = await ctx.decide({
      kind: "collateral",
      requestId: ctx.nextInteractionId(),
      targetId: user.id,
      actorId: user.id,
      victims: victims.map((v) => v.id),
      sources: [],
      allowHandOverWeapon: false,
      reason: "借刀杀人：请选择要被攻击的目标",
    });
    const chosenVictim =
      victimDecision.choice === "target"
        ? victims.find((v) => v.id === victimDecision.targetId)
        : victims[0];
    if (!chosenVictim) {
      logs.push(`${target.name} 无法攻击指定目标`);
      return logs;
    }

    // Phase 2: Target (Player B) decides: play slash on chosenVictim, or hand over weapon
    const response = await ctx.decide({
      kind: "collateral",
      requestId: ctx.nextInteractionId(),
      targetId: target.id,
      actorId: user.id,
      victims: [chosenVictim.id],
      sources: slashSources,
      allowHandOverWeapon: target.weapon !== null,
      reason: `借刀杀人：对 ${chosenVictim.name} 使用杀？否则交出武器`,
    });
    if (response.choice === "target" && response.targetId === chosenVictim.id) {
      const sourceId = response.sourceId ?? slashSources[0]?.sourceId;
      const slash = sourceId ? await ctx.removeUsableCardBySourceId(target, sourceId) : undefined;
      if (slash) {
        ctx.discardPile.push(slash);
        logs.push(`${target.name} 对 ${chosenVictim.name} 使用杀`);
        logs.push(...(await resolveSlash(ctx, target, chosenVictim, false, slashKindOf(target, slash.type), slash)));
        return logs;
      }
    }
    // Target chose to hand over weapon (or couldn't slash)
    if (target.weapon === null) {
      logs.push(`${target.name} 无法出杀且没有武器`);
      return logs;
    }
    logs.push(...(await removeSelectedCardFromPlayer(ctx, target, "获得", "weapon", user)));
    return logs;
  })();
}

/**
 * 火攻：目标展示一张手牌，你可弃置一张同花色手牌，对其造成 1 点火焰伤害。
 * 官方规则：出牌阶段对一名其他角色使用；目标无手牌则无法展示，火攻无效。
 */
export function resolveFireAttack(ctx: ResolveContext, user: Player, target: Player, usedCard: Card): Promise<string[]> {
  return (async () => {
    const logs = [`${user.name} 对 ${target.name} 使用${CardType.FireAttack}`];
    if (await tryNegate(ctx, target, CardType.FireAttack, logs, user.id)) {
      return logs;
    }
    if (target.hand.length === 0) {
      logs.push(`${target.name} 没有手牌可展示，${CardType.FireAttack}无效`);
      return logs;
    }
    // 目标选择一张手牌展示（不弃置）
    const showDecision = await ctx.decide({
      kind: "choose-discard",
      requestId: ctx.nextInteractionId(),
      playerId: target.id,
      reason: `${CardType.FireAttack}：${target.name} 请选择 1 张手牌展示`,
      sources: ctx.buildUsableSources(target).filter((source) => source.origin === "hand"),
      count: 1,
      allowPass: false,
    });
    let shownSuit: Card["suit"] | null = null;
    if (showDecision.choice === "card") {
      const shown = target.hand.find((card) => `hand:${card.id}` === showDecision.sourceId);
      if (shown) {
        shownSuit = shown.suit;
        const suitNames = { heart: "红桃", diamond: "方片", club: "梅花", spade: "黑桃", none: "无" } as const;
        logs.push(`${target.name} 展示了${suitNames[shown.suit]}牌`);
      }
    }
    if (!shownSuit) {
      return logs;
    }
    const sameSuit = user.hand.filter((card) => card.suit === shownSuit);
    if (sameSuit.length === 0) {
      logs.push(`${user.name} 没有同花色的手牌可弃置，${CardType.FireAttack}无效`);
      return logs;
    }
    const discardDecision = await ctx.decide({
      kind: "choose-discard",
      requestId: ctx.nextInteractionId(),
      playerId: user.id,
      reason: `${CardType.FireAttack}：是否弃置 1 张同花色手牌造成 1 点火焰伤害？`,
      sources: sameSuit.map((card) => ({
        sourceId: `hand:${card.id}`,
        origin: "hand" as const,
        card,
        label: `弃置${card.type}`,
      })),
      count: 1,
      allowPass: true,
      passLabel: "不弃置",
    });
    if (discardDecision.choice !== "card") {
      logs.push(`${user.name} 选择不弃置，${CardType.FireAttack}无效`);
      return logs;
    }
    const discarded = await ctx.removeUsableCardBySourceId(user, discardDecision.sourceId);
    if (!discarded) {
      return logs;
    }
    ctx.discardPile.push(discarded);
    logs.push(`${user.name} 弃置 ${discarded.type}，${CardType.FireAttack}生效`);
    await ctx.applyDamage(user, target, 1, CardType.FireAttack, logs, usedCard);
    return logs;
  })();
}

/**
 * 铁索连环：横置/重置一名角色（连环状态切换）；或重铸（弃置此牌摸一张）。
 * 注：官方为"至多两名角色"，本实现因单目标行动模型每次指定一名，可连用两张达到同样效果。
 * 处于连环状态的角色受到属性伤害时，伤害向其他连环角色传导（见 applyDamage）。
 */
export function resolveIronChain(
  ctx: ResolveContext,
  user: Player,
  target: Player,
): Promise<string[]> {
  return (async () => {
    const logs = [`${user.name} 对 ${target.name} 使用${CardType.IronChain}`];
    if (await tryNegate(ctx, target, CardType.IronChain, logs, user.id)) {
      return logs;
    }
    target.chained = !target.chained;
    logs.push(`${target.name} 的武将牌被${target.chained ? "横置" : "重置"}`);
    return logs;
  })();
}

export function resolveDelayedTrick(ctx: ResolveContext, user: Player, usedCard: Card, targetId: string): Promise<string[]> {
  return (async () => {
    const target = ctx.mustGetPlayer(targetId);
    const logs = [`${user.name} 对 ${target.name} 使用 ${usedCard.type}`];
    if (usedCard.type === CardType.Indulgence && isImmuneTo(target, "indulgence")) {
      logs.push(`${target.name} 的${SkillName.QianXun}生效，不能成为乐不思蜀的目标`);
      return logs;
    }
    if (usedCard.type === CardType.SuppliesCut && !canReachForDistanceOneTrick(ctx, user, target)) {
      logs.push(`${target.name} 距离 ${user.name} 超过 1，${CardType.SuppliesCut}无效`);
      return logs;
    }
    if (usedCard.type !== CardType.Lightning && await tryNegate(ctx, target, usedCard.type, logs, user.id)) {
      return logs;
    }
    target.delayedTricks.push({ cardType: usedCard.type, sourcePlayerId: user.id, card: usedCard });
    logs.push(`${target.name} 的判定区增加了 ${usedCard.type}`);
    return logs;
  })();
}

export function resolveDelayedJudgments(ctx: ResolveContext, player: Player): Promise<string[]> {
  return (async () => {
    const logs: string[] = [];
    // Process in order: Lightning -> SuppliesCut -> Indulgence
    const lightningIdx = player.delayedTricks.findIndex((t) => t.cardType === CardType.Lightning);
    if (lightningIdx >= 0) {
      logs.push(...(await resolveSingleDelayedJudgment(ctx, player, lightningIdx)));
      if (!player.alive) return logs;
    }
    const suppliesIdx = player.delayedTricks.findIndex((t) => t.cardType === CardType.SuppliesCut);
    if (suppliesIdx >= 0) {
      logs.push(...(await resolveSingleDelayedJudgment(ctx, player, suppliesIdx)));
      if (!player.alive) return logs;
    }
    const indulgenceIdx = player.delayedTricks.findIndex((t) => t.cardType === CardType.Indulgence);
    if (indulgenceIdx >= 0) {
      logs.push(...(await resolveSingleDelayedJudgment(ctx, player, indulgenceIdx)));
    }
    return logs;
  })();
}

export function resolveSingleDelayedJudgment(ctx: ResolveContext, player: Player, index: number): Promise<string[]> {
  return (async () => {
    const logs: string[] = [];
    const trick = player.delayedTricks[index];
    if (!trick) return logs;
    player.delayedTricks.splice(index, 1);

    const judgment = await ctx.drawJudgmentCard(`${player.name} 的 ${trick.cardType}`, logs, player);
    if (!judgment) return logs;

    if (trick.cardType === CardType.Lightning) {
      if (judgment.suit === "spade" && judgment.rank >= 2 && judgment.rank <= 9) {
        logs.push(`${player.name} 的闪电判定为黑桃${judgment.rank}，受到 3 点雷电伤害`);
        await ctx.applyDamage(player, player, 3, "闪电", logs, trick.card);
      } else {
        logs.push(`${player.name} 的闪电判定未命中`);
        const alivePlayers = ctx.players.filter((p) => p.alive);
        const playerIndex = alivePlayers.findIndex((p) => p.id === player.id);
        const nextPlayer = alivePlayers[(playerIndex + 1) % alivePlayers.length];
        if (nextPlayer) {
          nextPlayer.delayedTricks.push({ cardType: CardType.Lightning, sourcePlayerId: trick.sourcePlayerId });
          logs.push(`闪电移至 ${nextPlayer.name} 的判定区`);
        }
      }
    } else if (trick.cardType === CardType.SuppliesCut) {
      if (judgment.suit !== "club") {
        logs.push(`${player.name} 的兵粮寸断生效，跳过摸牌阶段`);
        ctx.skipDrawPhase = player.id;
      } else {
        logs.push(`${player.name} 的兵粮寸断判定为梅花，不生效`);
      }
    } else if (trick.cardType === CardType.Indulgence) {
      if (judgment.suit !== "heart") {
        logs.push(`${player.name} 的乐不思蜀生效，跳过出牌阶段`);
        ctx.skipPlayPhase = player.id;
      } else {
        logs.push(`${player.name} 的乐不思蜀判定为红桃，不生效`);
      }
    }
    return logs;
  })();
}

export function resolvePeachGarden(ctx: ResolveContext, user: Player): string[] {
  const logs = [`${user.name} 使用桃园结义`];
  for (const target of ctx.players) {
    if (!target.alive) {
      continue;
    }
    if (target.hp >= target.maxHp) {
      logs.push(`${target.name} 体力已满`);
      continue;
    }
    target.hp = Math.min(target.maxHp, target.hp + 1);
    logs.push(`${target.name} 回复 1 点体力`);
  }
  return logs;
}

export function resolveHarvest(ctx: ResolveContext, user: Player): string[] {
  const logs = [`${user.name} 使用五谷丰登`];
  for (const target of ctx.players) {
    if (!target.alive) {
      continue;
    }
    const drawn = ctx.drawCards(target.id, 1);
    logs.push(`${target.name} 摸了 ${drawn} 张牌`);
  }
  return logs;
}

export function resolveEquip(ctx: ResolveContext, user: Player, equipType: EquipCardType): Promise<string[]> {
  return (async () => {
    const logs: string[] = [];
    if (isWeaponCard(equipType)) {
      const previous = user.weapon;
      user.weapon = equipType;
      if (previous !== null) {
        ctx.discardPile.push(createCard(ctx, previous, `replace-${ctx.turn}`));
        logs.push(`${user.name} 的旧武器 ${previous} 被替换并弃置`);
        logs.push(...(await onLoseEquip(ctx, user, previous)));
      }
      logs.push(`${user.name} 装备了${equipType}`);
      return logs;
    }
    if (isArmorCard(equipType)) {
      const previous = user.armor;
      user.armor = equipType;
      if (previous !== null) {
        ctx.discardPile.push(createCard(ctx, previous, `replace-${ctx.turn}`));
        logs.push(`${user.name} 的旧防具 ${previous} 被替换并弃置`);
        logs.push(...(await onLoseEquip(ctx, user, previous)));
      }
      logs.push(`${user.name} 装备了${equipType}`);
      return logs;
    }
    if (isDefenseHorseCard(equipType)) {
      const previous = user.defenseHorse;
      user.defenseHorse = equipType;
      if (previous !== null) {
        ctx.discardPile.push(createCard(ctx, previous, `replace-${ctx.turn}`));
        logs.push(`${user.name} 的旧+1马 ${previous} 被替换并弃置`);
        logs.push(...(await onLoseEquip(ctx, user, previous)));
      }
      logs.push(`${user.name} 装备了${equipType}`);
      return logs;
    }
    if (isAttackHorseCard(equipType)) {
      const previous = user.attackHorse;
      user.attackHorse = equipType;
      if (previous !== null) {
        ctx.discardPile.push(createCard(ctx, previous, `replace-${ctx.turn}`));
        logs.push(`${user.name} 的旧-1马 ${previous} 被替换并弃置`);
        logs.push(...(await onLoseEquip(ctx, user, previous)));
      }
      logs.push(`${user.name} 装备了${equipType}`);
      return logs;
    }
    const previous = user.treasure;
    user.treasure = equipType;
    if (previous !== null) {
      ctx.discardPile.push(createCard(ctx, previous, `replace-${ctx.turn}`));
      logs.push(`${user.name} 的旧宝物 ${previous} 被替换并弃置`);
      discardWoodenOxStoredCards(ctx, user, logs);
      logs.push(...(await onLoseEquip(ctx, user, previous)));
    }
    logs.push(`${user.name} 装备了${equipType}`);
    return logs;
  })();
}

export function resolveDeaths(ctx: ResolveContext): Promise<string[]> {
  return (async () => {
    if (ctx.deferDyingResolution) return [];
    const logs: string[] = [];
    for (const player of ctx.players) {
      if (!player.alive) {
        continue;
      }
      if (player.hp > 0) {
        continue;
      }
      // 濒死：每张桃只回复 1 点体力，必须回到 1 点以上才算脱离濒死，
      // 因此欠 N 点就要 N+1 张桃（hp=-2 需要 3 张）。
      // 先由濒死者本人自救（酒可当桃自救），可连续使用多张；
      // 再由其他存活角色按座次顺序逐一救援，每人也可连续使用多张，
      // 直到体力 > 0 或无人再出桃，未脱离则阵亡。
      while (player.hp <= 0 && (await ctx.consumePeachResponse(player, player.id, logs))) {
        player.hp = Math.min(player.maxHp, player.hp + 1);
        logs.push(`${player.name} 自救，体力恢复到 ${player.hp}`);
      }
      if (player.hp <= 0) {
        for (const rescuer of getRescuersInOrder(ctx, player)) {
          while (player.hp <= 0 && (await ctx.consumePeachResponse(rescuer, player.id, logs))) {
            let recovered = 1;
            const peachSaveBonus = player.role === PlayerRole.Lord ? getSkillRules(player).peachSaveBonus : 0;
            if (peachSaveBonus > 0 && getPlayerKingdom(ctx, rescuer) === KINGDOM.Wu) {
              recovered += peachSaveBonus;
              logs.push(`${player.name} 的${SkillName.JiuYuan}生效，额外回复 ${peachSaveBonus} 点体力`);
            }
            player.hp = Math.min(player.maxHp, player.hp + recovered);
            logs.push(`${rescuer.name} 对${player.name}使用${CardType.Peach}，其体力恢复到 ${player.hp}`);
          }
          if (player.hp > 0) {
            break;
          }
        }
      }
      if (player.hp <= 0) {
        player.alive = false;
        player.delayedTricks = [];
        logs.push(`${player.name} 阵亡，身份：${player.role}`);
        logs.push(...resolveKillReward(ctx, player));
      }
    }
    return logs;
  })();
}

/**
 * 击杀奖惩（身份局标准，见 rules.md §8）：
 * - 击杀反贼：击杀者摸 3 张牌（任何身份击杀都生效）；
 * - 主公杀死忠臣：主公弃置所有手牌与装备区牌（含木牛流马内存的牌）；
 * - 无来源伤害（闪电、苦肉等）或凶手已阵亡时不结算奖惩。
 *
 * 已知简化：主公受罚弃置装备时不触发枭姬/白银狮子等"失去装备"技能，只做弃置。
 */
export function resolveKillReward(ctx: ResolveContext, victim: Player): string[] {
  const killerId = ctx.takeDamageSource(victim.id);
  if (killerId === null) {
    return [];
  }
  const killer = ctx.players.find((player) => player.id === killerId);
  if (!killer || killer.id === victim.id || !killer.alive) {
    return [];
  }
  if (victim.role === PlayerRole.Rebel) {
    const drawn = ctx.drawCards(killer.id, 3);
    return [`${killer.name} 击杀${PlayerRole.Rebel}${victim.name}，摸 ${drawn} 张牌`];
  }
  if (victim.role !== PlayerRole.Loyalist || killer.role !== PlayerRole.Lord) {
    return [];
  }
  const logs: string[] = [];
  const handCount = killer.hand.length;
  ctx.discardPile.push(...killer.hand);
  killer.hand = [];
  const equips: EquipCardType[] = [];
  if (killer.weapon !== null) equips.push(killer.weapon);
  if (killer.armor !== null) equips.push(killer.armor);
  if (killer.defenseHorse !== null) equips.push(killer.defenseHorse);
  if (killer.attackHorse !== null) equips.push(killer.attackHorse);
  if (killer.treasure !== null) equips.push(killer.treasure);
  for (const equip of equips) {
    ctx.discardPile.push(createCard(ctx, equip, `punish-${ctx.turn}`));
  }
  killer.weapon = null;
  killer.armor = null;
  killer.defenseHorse = null;
  killer.attackHorse = null;
  killer.treasure = null;
  discardWoodenOxStoredCards(ctx, killer, logs);
  logs.push(
    `${killer.name} 作为${PlayerRole.Lord}杀死${PlayerRole.Loyalist}${victim.name}，弃置全部 ${handCount} 张手牌与 ${equips.length} 件装备`,
  );
  return logs;
}

export function getPlayerKingdom(ctx: ResolveContext, player: Player): string {
  return resolveGeneralByName(player.general).kingdom;
}

export function getKingdomRespondersInOrder(
  ctx: ResolveContext,
  requester: Player,
  kingdom: string,
): Player[] {
  const start = ctx.players.findIndex((item) => item.id === requester.id);
  const ordered: Player[] = [];
  for (let i = 1; i < ctx.players.length; i += 1) {
    const index = (start + i) % ctx.players.length;
    const candidate = ctx.players[index];
    if (!candidate || !candidate.alive || candidate.id === requester.id) {
      continue;
    }
    if (getPlayerKingdom(ctx, candidate) !== kingdom) {
      continue;
    }
    ordered.push(candidate);
  }
  return ordered;
}

export function getRescuersInOrder(ctx: ResolveContext, target: Player): Player[] {
  const start = ctx.players.findIndex((item) => item.id === target.id);
  const ordered: Player[] = [];
  for (let i = 1; i < ctx.players.length; i += 1) {
    const index = (start + i) % ctx.players.length;
    const candidate = ctx.players[index];
    if (!candidate || !candidate.alive || candidate.id === target.id) {
      continue;
    }
    ordered.push(candidate);
  }
  return ordered;
}

export function resolveWinner(ctx: ResolveContext): string[] {
  const alivePlayers = ctx.players.filter((player) => player.alive);
  if (alivePlayers.length === 0) {
    ctx.winner = "draw";
  } else {
    const lordAlive = alivePlayers.some((player) => player.role === PlayerRole.Lord);
    const rebelAlive = alivePlayers.some((player) => player.role === PlayerRole.Rebel);
    const traitorAlive = alivePlayers.some((player) => player.role === PlayerRole.Traitor);
    let winRole: PlayerRole | "lord-side" | null = null;
    if (!lordAlive) {
      winRole = traitorAlive && !rebelAlive ? PlayerRole.Traitor : PlayerRole.Rebel;
    } else if (!rebelAlive && !traitorAlive) {
      winRole = "lord-side";
    }
    if (winRole === null) {
      return [];
    }
    const human = ctx.players.find((player) => !player.isAI);
    const humanWin =
      human !== undefined &&
      (winRole === "lord-side"
        ? human.role === PlayerRole.Lord || human.role === PlayerRole.Loyalist
        : human.role === winRole);
    ctx.winner = humanWin ? "human" : "ai";
  }
  if (ctx.winner === null) {
    return [];
  }
  if (ctx.winner === "draw") {
    return ["全员阵亡，平局"];
  }
  const human = ctx.players.find((player) => !player.isAI);
  if (ctx.winner === "human") {
    if (human?.role === PlayerRole.Lord || human?.role === PlayerRole.Loyalist) {
      return ["主公阵营胜利"];
    }
    if (human?.role === PlayerRole.Rebel) {
      return ["反贼胜利"];
    }
    return ["内奸胜利"];
  }
  if (human?.role === PlayerRole.Lord || human?.role === PlayerRole.Loyalist) {
    return ["主公阵营失败"];
  }
  if (human?.role === PlayerRole.Rebel) {
    return ["反贼失败"];
  }
  return ["内奸失败"];
}

export function canReachForSlash(ctx: ResolveContext, attacker: Player, target: Player): boolean {
  const distance = computeDistance(ctx, attacker, target);
  return distance <= getAttackRange(attacker);
}

/**
 * 距离 1 锦囊（顺手牵羊 / 兵粮寸断）的目标合法性：目标须在距离 1 以内。
 * 奇才是锁定技（使用锦囊无距离限制），有奇才的使用者无视该限制。
 */
export function canReachForDistanceOneTrick(ctx: ResolveContext, user: Player, target: Player): boolean {
  if (getSkillRules(user).trickDistanceExempt) {
    return true;
  }
  return computeDistance(ctx, user, target) <= 1;
}

export function getAttackRange(player: Player): number {
  if (!player.weapon) {
    return 1;
  }
  if (
    player.weapon === CardType.FemaleSword ||
    player.weapon === CardType.QinggangSword ||
    player.weapon === CardType.IceSword ||
    player.weapon === CardType.GudingBlade
  ) {
    return 2;
  }
  if (
    player.weapon === CardType.SerpentSpear ||
    player.weapon === CardType.GreenDragonBlade ||
    player.weapon === CardType.RockCleavingAxe ||
    player.weapon === CardType.SilverMoonSpear
  ) {
    return 3;
  }
  if (player.weapon === CardType.Halberd || player.weapon === CardType.VermilionFan) {
    return 4;
  }
  if (player.weapon === CardType.KylinBow) {
    return 5;
  }
  return 1;
}

export function computeDistance(ctx: ResolveContext, attacker: Player, target: Player): number {
  return computeDistanceBetween(ctx.players, attacker, target);
}

// 纯快照版距离计算：仅依赖 players 数组（座位序）+ 攻防双方字段，供 UI/Go 客户端本地展示复用。
export function computeDistanceBetween(players: Player[], attacker: Player, target: Player): number {
  const alivePlayers = players.filter((player) => player.alive);
  const attackerIndex = alivePlayers.findIndex((item) => item.id === attacker.id);
  const targetIndex = alivePlayers.findIndex((item) => item.id === target.id);
  if (attackerIndex < 0 || targetIndex < 0) {
    return 99;
  }
  const gap = Math.abs(attackerIndex - targetIndex);
  const ringDistance = Math.min(gap, alivePlayers.length - gap);
  let distance = ringDistance;
  if (attacker.attackHorse !== null) {
    distance -= 1;
  }
  distance -= getSkillRules(attacker).distanceDelta;
  if (target.defenseHorse !== null) {
    distance += 1;
  }
  return Math.max(1, distance);
}

export function expandSlashTargets(ctx: ResolveContext, player: Player, primary: Player, isLastHandSlash: boolean): Promise<Player[]> {
  return (async () => {
    if (player.weapon !== CardType.Halberd || !await ctx.shouldActivateOptionalEffect(player, CardType.Halberd) || !isLastHandSlash) {
      return [primary];
    }
    const extras = ctx.players
      .filter(
        (item) =>
          item.alive &&
          item.id !== player.id &&
          item.id !== primary.id &&
          canReachForSlash(ctx, player, item) &&
          !ctx.isKongChengProtected(item, CardType.Slash),
      )
      .sort((a, b) => a.hp - b.hp || a.hand.length - b.hand.length)
      .slice(0, 2);
    return [primary, ...extras];
  })();
}

export function countDirectDodgeSources(ctx: ResolveContext, player: Player): number {
  let count = player.hand.filter((card) => card.type === CardType.Dodge).length;
  if (ctx.hasSkill(player, SkillName.QingGuo)) {
    count += player.hand.filter((card) => card.color === "black" && card.type !== CardType.Dodge).length;
  }
  if (ctx.hasSkill(player, SkillName.LongDan)) {
    count += player.hand.filter((card) => isSlashCard(card.type)).length;
  }
  return count;
}

export function countAvailableDodgeResponses(ctx: ResolveContext, player: Player): number {
  let count = countDirectDodgeSources(ctx, player);
  if (player.role === PlayerRole.Lord && ctx.hasSkill(player, SkillName.HuJia)) {
    for (const responder of getKingdomRespondersInOrder(ctx, player, KINGDOM.Wei)) {
      count += countDirectDodgeSources(ctx, responder);
    }
  }
  return count;
}

export function countDirectSlashSources(ctx: ResolveContext, player: Player): number {
  let count = player.hand.filter((card) => isSlashCard(card.type)).length;
  if (ctx.hasSkill(player, SkillName.WuSheng)) {
    count += player.hand.filter((card) => card.color === "red" && !isSlashCard(card.type)).length;
  }
  if (ctx.hasSkill(player, SkillName.LongDan)) {
    count += player.hand.filter((card) => card.type === CardType.Dodge).length;
  }
  return count;
}

export function countAvailableSlashResponses(ctx: ResolveContext, player: Player): number {
  let count = countDirectSlashSources(ctx, player);
  if (player.role === PlayerRole.Lord && ctx.hasSkill(player, SkillName.JiJiang)) {
    for (const responder of getKingdomRespondersInOrder(ctx, player, KINGDOM.Shu)) {
      count += countDirectSlashSources(ctx, responder);
    }
  }
  return count;
}

export function discardSelfCards(ctx: ResolveContext, player: Player, count: number): Promise<string[]> {
  return (async () => {
    const logs: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const removedLogs = await removeRandomCardFromPlayer(ctx, player, "弃置");
      logs.push(...removedLogs);
    }
    return logs;
  })();
}

export function removeHorseEquip(ctx: ResolveContext, player: Player): string[] {
  if (player.defenseHorse !== null) {
    const removed = player.defenseHorse;
    player.defenseHorse = null;
    ctx.discardPile.push(createCard(ctx, removed, `kylin-${ctx.turn}`));
    return [`麒麟弓生效，${player.name} 的 ${removed} 被弃置`];
  }
  if (player.attackHorse !== null) {
    const removed = player.attackHorse;
    player.attackHorse = null;
    ctx.discardPile.push(createCard(ctx, removed, `kylin-${ctx.turn}`));
    return [`麒麟弓生效，${player.name} 的 ${removed} 被弃置`];
  }
  return [];
}

export function consumeDodgeResponse(
  ctx: ResolveContext,
  player: Player,
  trigger: { cardName: string; actorId: string },
  logs: string[],
): Promise<boolean> {
  return (async () => {
    if (!ctx.canPlayerRespond(player.id, "dodge")) {
      ctx.setPlayerResponseSelection(player.id, "dodge", null);
      return false;
    }
    if (await ctx.requestCardResponse(player, "dodge", trigger, logs)) {
      return true;
    }
    if (player.role !== PlayerRole.Lord || !ctx.hasSkill(player, SkillName.HuJia)) {
      return false;
    }
    const responders = getKingdomRespondersInOrder(ctx, player, KINGDOM.Wei);
    for (const responder of responders) {
      if (await ctx.requestCardResponse(responder, "dodge", trigger, logs)) {
        logs.push(`${player.name} 的${SkillName.HuJia}生效，${responder.name}为其提供了${CardType.Dodge}`);
        return true;
      }
    }
    return false;
  })();
}

export function consumeSlashResponse(
  ctx: ResolveContext,
  player: Player,
  trigger: { cardName: string; actorId: string },
  logs: string[],
): Promise<boolean> {
  return (async () => {
    if (!ctx.canPlayerRespond(player.id, "slash")) {
      ctx.setPlayerResponseSelection(player.id, "slash", null);
      return false;
    }
    if (await ctx.requestCardResponse(player, "slash", trigger, logs)) {
      return true;
    }
    if (player.role !== PlayerRole.Lord || !ctx.hasSkill(player, SkillName.JiJiang)) {
      return false;
    }
    const responders = getKingdomRespondersInOrder(ctx, player, KINGDOM.Shu);
    for (const responder of responders) {
      if (await ctx.requestCardResponse(responder, "slash", trigger, logs)) {
        logs.push(`${player.name} 的${SkillName.JiJiang}生效，${responder.name}为其提供了${CardType.Slash}`);
        return true;
      }
    }
    return false;
  })();
}

export function onLoseEquip(ctx: ResolveContext, player: Player, equip: EquipCardType): Promise<string[]> {
  return (async () => {
    const logs: string[] = [];
    if (ctx.hasSkill(player, SkillName.XiaoJi) && await ctx.shouldActivateOptionalEffect(player, SkillName.XiaoJi)) {
      const drawn = ctx.drawCards(player.id, 2);
      if (drawn > 0) {
        logs.push(`${player.name} 的${SkillName.XiaoJi}生效，摸了 ${drawn} 张牌`);
      }
    }
    if (equip === CardType.SilverLion && player.hp < player.maxHp) {
      player.hp += 1;
      logs.push(`${player.name} 失去白银狮子，回复 1 点体力`);
    }
    return logs;
  })();
}

/**
 * 木牛流马离开装备区（被弃置/被获得/被替换）时，其内存的牌必须一并置入弃牌堆，
 * 否则这些牌会从对局中凭空消失。
 */
export function discardWoodenOxStoredCards(ctx: ResolveContext, player: Player, logs: string[]): void {
  if (player.treasureCards.length === 0) {
    return;
  }
  const stored = player.treasureCards.length;
  ctx.discardPile.push(...player.treasureCards);
  player.treasureCards = [];
  logs.push(`${player.name} 的${CardType.WoodenOx}内存的 ${stored} 张牌置入弃牌堆`);
}

export function createCard(ctx: ResolveContext, type: CardType, seed: string): Card {
  return { id: `${type}-${seed}-${ctx.turn}`, type, color: "colorless", suit: "none", rank: 0 };
}

export function tryNegate(ctx: ResolveContext, target: Player, trickType: CardType, logs: string[], actorId = ""): Promise<boolean> {
  return (async () => {
    if (!ctx.canPlayerRespond(target.id, "negate")) {
      return false;
    }
    const negated = await ctx.requestCardResponse(target, "negate", { cardName: trickType, actorId }, logs);
    if (negated) {
      logs.push(`${target.name} 打出无懈可击，抵消了 ${trickType}`);
    }
    return negated;
  })();
}

export function removeRandomCardFromPlayer(
  ctx: ResolveContext,
  player: Player,
  mode: "弃置" | "获得",
  receiver?: Player,
): Promise<string[]> {
  const options: string[] = [];
  for (let i = 0; i < player.hand.length; i += 1) {
    options.push("hand-random");
  }
  if (player.weapon !== null) {
    options.push("weapon");
  }
  if (player.armor !== null) {
    options.push("armor");
  }
  if (player.defenseHorse !== null) {
    options.push("defenseHorse");
  }
  if (player.attackHorse !== null) {
    options.push("attackHorse");
  }
  if (player.treasure !== null) {
    options.push("treasure");
  }
  if (options.length === 0) {
    return Promise.resolve([]);
  }
  const picked = options[ctx.randomIndex(options.length)];
  if (!picked) {
    return Promise.resolve([]);
  }
  return removeSelectedCardFromPlayer(ctx, player, mode, picked, receiver);
}

export function removeSelectedCardFromPlayer(
  ctx: ResolveContext,
  player: Player,
  mode: "弃置" | "获得",
  selectedCardId: string,
  receiver?: Player,
): Promise<string[]> {
  return (async () => {
    if (selectedCardId === "hand-random") {
      if (player.hand.length === 0) {
        return [];
      }
      const index = ctx.randomIndex(player.hand.length);
      const extraLogs: string[] = [];
      const removed = await ctx.removeHandCardAt(player, index, extraLogs);
      if (!removed) {
        return extraLogs;
      }
      if (mode === "获得" && receiver) {
        receiver.hand.push(removed);
        return [...extraLogs, `${receiver.name} 获得了 ${player.name} 的 1 张手牌`];
      }
      ctx.discardPile.push(removed);
      return [...extraLogs, `${player.name} 的 1 张手牌被弃置`];
    }
    if (selectedCardId.startsWith("hand:")) {
      const handCardId = selectedCardId.slice(5);
      const index = player.hand.findIndex((card) => card.id === handCardId);
      if (index < 0) {
        return [];
      }
      const extraLogs: string[] = [];
      const removed = await ctx.removeHandCardAt(player, index, extraLogs);
      if (!removed) {
        return extraLogs;
      }
      if (mode === "获得" && receiver) {
        receiver.hand.push(removed);
        // 从手牌获得时不公开牌型（与其他玩家视角的盲选一致），获得者自己能在手牌中看到
        return [...extraLogs, `${receiver.name} 获得了 ${player.name} 的 1 张手牌`];
      }
      ctx.discardPile.push(removed);
      return [...extraLogs, `${player.name} 的手牌 ${removed.type} 被弃置`];
    }
    if (selectedCardId === "weapon") {
      const removedWeapon = player.weapon;
      player.weapon = null;
      if (removedWeapon === null) {
        return [];
      }
      const logs: string[] = [];
      if (mode === "获得" && receiver) {
        receiver.hand.push(createCard(ctx, removedWeapon, `loot-${ctx.turn}`));
        logs.push(`${receiver.name} 获得了 ${player.name} 的装备 ${removedWeapon}`);
      } else {
        ctx.discardPile.push(createCard(ctx, removedWeapon, `discard-${ctx.turn}`));
        logs.push(`${player.name} 的装备 ${removedWeapon} 被弃置`);
      }
      return [...logs, ...(await onLoseEquip(ctx, player, removedWeapon))];
    }
    if (selectedCardId === "armor") {
      const removedArmor = player.armor;
      player.armor = null;
      if (removedArmor === null) {
        return [];
      }
      const logs: string[] = [];
      if (mode === "获得" && receiver) {
        receiver.hand.push(createCard(ctx, removedArmor, `loot-${ctx.turn}`));
        logs.push(`${receiver.name} 获得了 ${player.name} 的装备 ${removedArmor}`);
      } else {
        ctx.discardPile.push(createCard(ctx, removedArmor, `discard-${ctx.turn}`));
        logs.push(`${player.name} 的装备 ${removedArmor} 被弃置`);
      }
      return [...logs, ...(await onLoseEquip(ctx, player, removedArmor))];
    }
    if (selectedCardId === "defenseHorse") {
      const removed = player.defenseHorse;
      player.defenseHorse = null;
      if (removed === null) {
        return [];
      }
      const logs: string[] = [];
      if (mode === "获得" && receiver) {
        receiver.hand.push(createCard(ctx, removed, `loot-${ctx.turn}`));
        logs.push(`${receiver.name} 获得了 ${player.name} 的装备 ${removed}`);
      } else {
        ctx.discardPile.push(createCard(ctx, removed, `discard-${ctx.turn}`));
        logs.push(`${player.name} 的装备 ${removed} 被弃置`);
      }
      return [...logs, ...(await onLoseEquip(ctx, player, removed))];
    }
    if (selectedCardId === "attackHorse") {
      const removed = player.attackHorse;
      player.attackHorse = null;
      if (removed === null) {
        return [];
      }
      const logs: string[] = [];
      if (mode === "获得" && receiver) {
        receiver.hand.push(createCard(ctx, removed, `loot-${ctx.turn}`));
        logs.push(`${receiver.name} 获得了 ${player.name} 的装备 ${removed}`);
      } else {
        ctx.discardPile.push(createCard(ctx, removed, `discard-${ctx.turn}`));
        logs.push(`${player.name} 的装备 ${removed} 被弃置`);
      }
      return [...logs, ...(await onLoseEquip(ctx, player, removed))];
    }
    if (selectedCardId !== "treasure") {
      return [];
    }
    const removedTreasure = player.treasure;
    player.treasure = null;
    if (removedTreasure === null) {
      return [];
    }
    const treasureLogs: string[] = [];
    if (mode === "获得" && receiver) {
      receiver.hand.push(createCard(ctx, removedTreasure, `loot-${ctx.turn}`));
      treasureLogs.push(`${receiver.name} 获得了 ${player.name} 的装备 ${removedTreasure}`);
    } else {
      ctx.discardPile.push(createCard(ctx, removedTreasure, `discard-${ctx.turn}`));
      treasureLogs.push(`${player.name} 的装备 ${removedTreasure} 被弃置`);
    }
    discardWoodenOxStoredCards(ctx, player, treasureLogs);
    return [...treasureLogs, ...(await onLoseEquip(ctx, player, removedTreasure))];
  })();
}

export function triggerJiAng(ctx: ResolveContext, attacker: Player, target: Player, qualifies: boolean, logs: string[]): Promise<void> {
  return (async () => {
    if (!qualifies) {
      return;
    }
    if (ctx.hasSkill(attacker, SkillName.JiAng) && await ctx.shouldActivateOptionalEffect(attacker, SkillName.JiAng)) {
      const drawn = ctx.drawCards(attacker.id, 1);
      logs.push(`${attacker.name} 的${SkillName.JiAng}生效，摸了 ${drawn} 张牌`);
    }
    if (ctx.hasSkill(target, SkillName.JiAng) && await ctx.shouldActivateOptionalEffect(target, SkillName.JiAng)) {
      const drawn = ctx.drawCards(target.id, 1);
      logs.push(`${target.name} 的${SkillName.JiAng}生效，摸了 ${drawn} 张牌`);
    }
  })();
}
