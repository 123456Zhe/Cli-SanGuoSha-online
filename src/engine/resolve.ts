import { Card, CardType } from "./cards.js";
import {
  countRemovableSelfCards,
  hasRemovableCard,
  isArmorCard,
  isAttackHorseCard,
  isDefenseHorseCard,
  isSlashCard,
  isWeaponCard,
  usableCardCount,
} from "./card-utils.js";
import { resolveGeneralByName } from "./generals.js";
import {
  CardSource,
  EquipCardType,
  InteractionDecision,
  InteractionRequest,
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
  removeUsableCardBySourceId(player: Player, sourceId: string): Card | undefined;
  drawCards(playerId: string, count: number): number;
  drawJudgmentCard(reason: string, logs: string[]): Card | null;
  applyDamage(source: Player | null, target: Player, amount: number, reason: string, logs: string[]): Promise<void>;
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
};

export function resolveSlash(
  ctx: ResolveContext,
  attacker: Player,
  target: Player,
  fromSerpent = false,
  fire = false,
  redSlash = false,
): Promise<string[]> {
  return (async () => {
    const logs = [`${attacker.name} 对 ${target.name} 使用${fire ? CardType.FireSlash : CardType.Slash}`];
    await triggerJiAng(ctx, attacker, target, redSlash, logs);
    if (ctx.isKongChengProtected(target, CardType.Slash)) {
      logs.push(`${target.name} 的${SkillName.KongCheng}生效，无法成为杀的目标`);
      return logs;
    }
    if (fromSerpent) {
      logs.push("本次杀来自丈八蛇矛转化");
    }
    const ignoreArmor = attacker.weapon === CardType.QinggangSword && await ctx.shouldActivateOptionalEffect(attacker, CardType.QinggangSword);
    if (!fire && !ignoreArmor && target.armor === CardType.VineArmor) {
      logs.push(`${target.name} 的藤甲生效，抵消了杀`);
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
          const removed = ctx.removeUsableCardBySourceId(target, decision.sourceId);
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
      const judgment = ctx.drawJudgmentCard(`${target.name} 的八卦阵`, logs);
      if (judgment?.color === "red") {
        logs.push(`${target.name} 的八卦阵判定为红色，视为打出闪`);
        return logs;
      }
    }
    let requireDodgeCount = ctx.hasSkill(attacker, SkillName.WuShuang) ? 2 : 1;
    if (ctx.hasSkill(attacker, SkillName.TieQi) && await ctx.shouldActivateOptionalEffect(attacker, SkillName.TieQi)) {
      const judgment = ctx.drawJudgmentCard(`${attacker.name} 的${SkillName.TieQi}`, logs);
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
          if (!(await consumeDodgeResponse(ctx, target, { cardName: fire ? CardType.FireSlash : CardType.Slash, actorId: attacker.id }, logs))) {
            dodged = false;
            break;
          }
        }
      }
    } else {
      for (let i = 0; i < requireDodgeCount; i += 1) {
        if (!(await consumeDodgeResponse(ctx, target, { cardName: fire ? CardType.FireSlash : CardType.Slash, actorId: attacker.id }, logs))) {
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
          const slash = attacker.hand.splice(nextSlash, 1)[0];
          if (slash) {
            ctx.discardPile.push(slash);
            logs.push(`${attacker.name} 的青龙偃月刀生效，追加一张杀`);
            logs.push(...(await resolveSlash(ctx, attacker, target, false, slash.type === CardType.FireSlash, slash.color === "red")));
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
    if (fire && target.armor === CardType.VineArmor) {
      damage += 1;
      logs.push(`${target.name} 的藤甲受到火焰克制，伤害+1`);
    }
    if (attacker.weapon === CardType.GudingBlade && await ctx.shouldActivateOptionalEffect(attacker, CardType.GudingBlade) && target.hand.length === 0) {
      damage += 1;
      logs.push(`${attacker.name} 的古锭刀生效，伤害+1`);
    }
    if (ctx.isSkillUsed(attacker.id, SkillName.LuoYi)) {
      damage += 1;
      logs.push(`${attacker.name} 的${SkillName.LuoYi}生效，本次杀伤害+1`);
    }
    await ctx.applyDamage(attacker, target, damage, "杀", logs);
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

export function resolveDuel(ctx: ResolveContext, user: Player, target: Player): Promise<string[]> {
  return (async () => {
    const logs = [`${user.name} 对 ${target.name} 发起决斗`];
    await triggerJiAng(ctx, user, target, true, logs);
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
      const needCount = ctx.hasSkill(attacker, SkillName.WuShuang) ? 2 : 1;
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
        if (ctx.isSkillUsed(attacker.id, SkillName.LuoYi)) {
          damage += 1;
          logs.push(`${attacker.name} 的${SkillName.LuoYi}生效，本次决斗伤害+1`);
        }
        await ctx.applyDamage(attacker, defender, damage, "决斗", logs);
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

export function resolveBarbarian(ctx: ResolveContext, user: Player): Promise<string[]> {
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
        await ctx.applyDamage(user, target, 1, "南蛮入侵", logs);
      }
    }
    return logs;
  })();
}

export function resolveArrowRain(ctx: ResolveContext, user: Player): Promise<string[]> {
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
        await ctx.applyDamage(user, target, 1, "万箭齐发", logs);
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
      const slash = sourceId ? ctx.removeUsableCardBySourceId(target, sourceId) : undefined;
      if (slash) {
        ctx.discardPile.push(slash);
        logs.push(`${target.name} 对 ${chosenVictim.name} 使用杀`);
        logs.push(...(await resolveSlash(ctx, target, chosenVictim, false, slash.type === CardType.FireSlash, slash.color === "red")));
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

export function resolveDelayedTrick(ctx: ResolveContext, user: Player, usedCard: Card, targetId: string): Promise<string[]> {
  return (async () => {
    const logs = [`${user.name} 对 ${ctx.mustGetPlayer(targetId).name} 使用 ${usedCard.type}`];
    if (usedCard.type !== CardType.Lightning && await tryNegate(ctx, ctx.mustGetPlayer(targetId), usedCard.type, logs, user.id)) {
      return logs;
    }
    const target = ctx.mustGetPlayer(targetId);
    target.delayedTricks.push({ cardType: usedCard.type, sourcePlayerId: user.id });
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

    const judgment = ctx.drawJudgmentCard(`${player.name} 的 ${trick.cardType}`, logs);
    if (!judgment) return logs;

    if (trick.cardType === CardType.Lightning) {
      if (judgment.suit === "spade" && judgment.rank >= 2 && judgment.rank <= 9) {
        logs.push(`${player.name} 的闪电判定为黑桃${judgment.rank}，受到 3 点雷电伤害`);
        await ctx.applyDamage(player, player, 3, "闪电", logs);
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
      }
      logs.push(`${user.name} 装备了${equipType}`);
      return logs;
    }
    const previous = user.treasure;
    user.treasure = equipType;
    if (previous !== null) {
      ctx.discardPile.push(createCard(ctx, previous, `replace-${ctx.turn}`));
      logs.push(`${user.name} 的旧宝物 ${previous} 被替换并弃置`);
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
      if (await ctx.consumePeachResponse(player, player.id, logs)) {
        player.hp = 1;
        logs.push(`${player.name} 打出桃自救，体力恢复到 1`);
        continue;
      }
      let rescued = false;
      const rescuers = getRescuersInOrder(ctx, player);
      for (const rescuer of rescuers) {
        if (!(await ctx.consumePeachResponse(rescuer, player.id, logs))) continue;
        let recovered = 1;
        if (
          ctx.hasSkill(player, SkillName.JiuYuan) &&
          player.role === PlayerRole.Lord &&
          getPlayerKingdom(ctx, rescuer) === "吴"
        ) {
          recovered += 1;
          logs.push(`${player.name} 的${SkillName.JiuYuan}生效，额外回复 1 点体力`);
        }
        player.hp = Math.min(player.maxHp, player.hp + recovered);
        logs.push(`${rescuer.name} 对${player.name}使用${CardType.Peach}，其体力恢复到 ${player.hp}`);
        rescued = true;
        break;
      }
      if (!rescued && player.hp <= 0) {
        player.alive = false;
        player.delayedTricks = [];
        logs.push(`${player.name} 阵亡，身份：${player.role}`);
      }
    }
    return logs;
  })();
}

export function getPlayerKingdom(ctx: ResolveContext, player: Player): "魏" | "蜀" | "吴" | "群雄" {
  return resolveGeneralByName(player.general).kingdom;
}

export function getKingdomRespondersInOrder(
  ctx: ResolveContext,
  requester: Player,
  kingdom: "魏" | "蜀" | "吴" | "群雄",
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
    player.weapon === CardType.RockCleavingAxe
  ) {
    return 3;
  }
  if (player.weapon === CardType.Halberd) {
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
  if (attacker.skills.includes(SkillName.MaShu)) {
    distance -= 1;
  }
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
    for (const responder of getKingdomRespondersInOrder(ctx, player, "魏")) {
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
    for (const responder of getKingdomRespondersInOrder(ctx, player, "蜀")) {
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
    const responders = getKingdomRespondersInOrder(ctx, player, "魏");
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
    const responders = getKingdomRespondersInOrder(ctx, player, "蜀");
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
      const removed = player.hand.splice(index, 1)[0];
      if (!removed) {
        return [];
      }
      if (mode === "获得" && receiver) {
        receiver.hand.push(removed);
        return [`${receiver.name} 获得了 ${player.name} 的 1 张手牌`];
      }
      ctx.discardPile.push(removed);
      return [`${player.name} 的 1 张手牌被弃置`];
    }
    if (selectedCardId.startsWith("hand:")) {
      const handCardId = selectedCardId.slice(5);
      const index = player.hand.findIndex((card) => card.id === handCardId);
      if (index < 0) {
        return [];
      }
      const removed = player.hand.splice(index, 1)[0];
      if (!removed) {
        return [];
      }
      if (mode === "获得" && receiver) {
        receiver.hand.push(removed);
        return [`${receiver.name} 获得了 ${player.name} 的手牌 ${removed.type}`];
      }
      ctx.discardPile.push(removed);
      return [`${player.name} 的手牌 ${removed.type} 被弃置`];
    }
    if (selectedCardId === "weapon") {
      const removedWeapon = player.weapon;
      player.weapon = null;
      if (removedWeapon === null) {
        return [];
      }
      if (mode === "获得" && receiver) {
        receiver.hand.push(createCard(ctx, removedWeapon, `loot-${ctx.turn}`));
        return [`${receiver.name} 获得了 ${player.name} 的装备 ${removedWeapon}`];
      }
      ctx.discardPile.push(createCard(ctx, removedWeapon, `discard-${ctx.turn}`));
      return [`${player.name} 的装备 ${removedWeapon} 被弃置`];
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
      if (mode === "获得" && receiver) {
        receiver.hand.push(createCard(ctx, removed, `loot-${ctx.turn}`));
        return [`${receiver.name} 获得了 ${player.name} 的装备 ${removed}`];
      }
      ctx.discardPile.push(createCard(ctx, removed, `discard-${ctx.turn}`));
      return [`${player.name} 的装备 ${removed} 被弃置`];
    }
    if (selectedCardId === "attackHorse") {
      const removed = player.attackHorse;
      player.attackHorse = null;
      if (removed === null) {
        return [];
      }
      if (mode === "获得" && receiver) {
        receiver.hand.push(createCard(ctx, removed, `loot-${ctx.turn}`));
        return [`${receiver.name} 获得了 ${player.name} 的装备 ${removed}`];
      }
      ctx.discardPile.push(createCard(ctx, removed, `discard-${ctx.turn}`));
      return [`${player.name} 的装备 ${removed} 被弃置`];
    }
    if (selectedCardId !== "treasure") {
      return [];
    }
    const removedTreasure = player.treasure;
    player.treasure = null;
    if (removedTreasure === null) {
      return [];
    }
    if (mode === "获得" && receiver) {
      receiver.hand.push(createCard(ctx, removedTreasure, `loot-${ctx.turn}`));
      return [`${receiver.name} 获得了 ${player.name} 的装备 ${removedTreasure}`];
    }
    ctx.discardPile.push(createCard(ctx, removedTreasure, `discard-${ctx.turn}`));
    return [`${player.name} 的装备 ${removedTreasure} 被弃置`];
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
