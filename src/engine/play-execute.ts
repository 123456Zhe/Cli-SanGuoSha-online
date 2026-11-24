/**
 * 出牌阶段执行：`playAction` 的负下标分支（当牌转换/国色/龙胆/武圣/木牛/丈八蛇矛）
 * 与通用手牌使用，以及出牌后的卡牌结算分发 `resolveUsedCard`。
 *
 * 从 `game.ts` 拆出，遵循仓库既有的 context-interface 约定：首参是 `PlayExecuteContext`，
 * `game.ts` 以 `this as unknown as PlayExecuteContext` 传入；拆出模块之间不互相 import。
 */

import { Card, CardType } from "./cards.js";
import { isDistanceOneTrickCard, slashKindOf } from "./card-utils.js";
import { getSkillRules } from "./skill-rules.js";
import {
  CardSource,
  EquipCardType,
  GameAction,
  Player,
  SkillEventPayload,
  SkillId,
  SkillName,
  SkillTrigger,
  TurnPhase,
} from "./types.js";

export type PlayExecuteContext = {
  advanceIfCurrentPlayerDead(logs: string[]): Promise<void>;
  buildUsableSources(player: Player): Array<CardSource & { card: Card }>;
  canPlaySlashInTurn(player: Player): boolean;
  canReachForDistanceOneTrick(user: Player, target: Player): boolean;
  canReachForSlash(attacker: Player, target: Player): boolean;
  canTakeStoredCard(card: Card): boolean;
  cardNeedsTarget(cardType: CardType): boolean;
  createCard(type: CardType, seed: string): Card;
  readonly currentPlayer: Player;
  discardCards(cards: Card[], actor: Player, reason: "弃置" | "判定", logs: string[]): Promise<void>;
  discardPile: Card[];
  drawCards(playerId: string, count: number): number;
  emitSkillTrigger(trigger: SkillTrigger, payload: SkillEventPayload, logs: string[]): Promise<void>;
  endPlayPhase(playerId: string): Promise<string[]>;
  expandSlashTargets(player: Player, primary: Player, isLastHandSlash: boolean): Promise<Player[]>;
  hasSkill(player: Player, skill: SkillName): boolean;
  isDelayedTrickCard(cardType: CardType): boolean;
  isEquipCard(cardType: CardType): cardType is EquipCardType;
  isKongChengProtected(target: Player, cardType: CardType): boolean;
  isNonDelayedTrickCard(cardType: CardType): boolean;
  isSlashCard(cardType: CardType): boolean;
  mustGetPlayer(id: string): Player;
  oxStoredTurnMap(): Map<string, number>;
  phase: TurnPhase;
  players: Player[];
  removeHandCardAt(player: Player, index: number, logs?: string[]): Promise<Card | undefined>;
  requestDiscardSelection(player: Player, count: number, reason: string, providedSources?: CardSource[]): Promise<Card[]>;
  resolveArrowRain(user: Player, trickCard?: Card): Promise<string[]>;
  resolveBarbarian(user: Player, trickCard?: Card): Promise<string[]>;
  resolveCollateral(user: Player, target: Player): Promise<string[]>;
  resolveConversionUse(player: Player, source: { origin: "hand" | "treasure"; index: number }, viaSkillId: SkillId | undefined, convertTo: CardType | undefined, targetId: string | undefined): Promise<string[]>;
  resolveDeaths(): Promise<string[]>;
  resolveDelayedTrick(user: Player, usedCard: Card, targetId: string): Promise<string[]>;
  resolveDismantle(user: Player, target: Player, selectedCardId?: string): Promise<string[]>;
  resolveDuel(user: Player, target: Player, duelCard?: Card): Promise<string[]>;
  resolveEquip(user: Player, equipType: EquipCardType): Promise<string[]>;
  resolveFireAttack(user: Player, target: Player, usedCard: Card): Promise<string[]>;
  resolveHarvest(user: Player): string[];
  resolveIronChain(user: Player, target: Player): Promise<string[]>;
  resolvePeachGarden(user: Player): string[];
  resolveSlash(attacker: Player, target: Player, fromSerpent?: boolean, kind?: "normal" | "fire" | "thunder", damageCard?: Card): Promise<string[]>;
  resolveSnatch(user: Player, target: Player, selectedCardId?: string): Promise<string[]>;
  resolveUsedCard(player: Player, usedCard: Card, targetId: string | undefined, fromTreasure: boolean, selectedCardId?: string): Promise<string[]>;
  resolveWinner(): string[];
  shouldActivateOptionalEffect(player: Player, effect: SkillName | CardType): Promise<boolean>;
  slashUsedThisTurn: boolean;
  tryNegateGlobal(user: Player, trickType: CardType, logs: string[]): Promise<boolean>;
  turn: number;
  useSkillAction(playerId: string, action: Extract<GameAction, { type: "skill" }>, targetId?: string): Promise<string[]>;
  wineBuffPlayerIds: Set<string>;
  wineUsedPlayerIds: Set<string>;
  winner: "human" | "ai" | "draw" | null;
};

export async function playAction(ctx: PlayExecuteContext, playerId: string, action: GameAction, targetId?: string, selectedCardId?: string): Promise<string[]> {
  if (ctx.winner !== null) {
    return [];
  }
  if (action.type === "end") {
    return ctx.endPlayPhase(playerId);
  }
  if (action.type === "skill") {
    return ctx.useSkillAction(playerId, action, targetId);
  }
  const player = ctx.mustGetPlayer(playerId);
  if (!player.alive || player.id !== ctx.currentPlayer.id || ctx.phase !== TurnPhase.Play) {
    return [];
  }
  if (action.cardIndex <= -10000) {
    // 外部武将包当牌转换（Phase 7）：手牌 `cardIndex = -10000 - 手牌下标`，
    // 木牛流马内牌 `cardIndex = -20000 - 木牛下标`（与响应侧同口径）。
    // **必须排在所有内置负下标分支之前**（`<= -1000` 是木牛流马，否则会被它先吃掉）。
    // 不信任客户端：convertVia/convertTo 与源牌都由 resolveConversionUse 复算。
    const source =
      action.cardIndex <= -20000
        ? { origin: "treasure" as const, index: -20000 - action.cardIndex }
        : { origin: "hand" as const, index: -10000 - action.cardIndex };
    return ctx.resolveConversionUse(player, source, action.convertVia, action.convertTo, targetId);
  }
  if (action.cardIndex <= -100 && action.cardIndex > -200) {
    const index = -100 - action.cardIndex;
    const converted = player.hand[index];
    if (!converted || converted.suit !== "diamond" || !ctx.hasSkill(player, SkillName.GuoSe)) {
      return ["使用卡牌失败"];
    }
    if (!targetId) {
      return ["需要选择目标"];
    }
    const target = ctx.mustGetPlayer(targetId);
    if (!target.alive || target.id === player.id) {
      return ["目标无效"];
    }
    if (target.delayedTricks.some((t) => t.cardType === CardType.Indulgence)) {
      return ["目标判定区已有乐不思蜀"];
    }
    const used = await ctx.removeHandCardAt(player, index);
    if (!used) {
      return ["使用卡牌失败"];
    }
    ctx.discardPile.push(used);
    const convertedCard = ctx.createCard(CardType.Indulgence, `guose-${ctx.turn}`);
    const logs = [`${player.name} 发动${SkillName.GuoSe}，将方块牌 ${used.type} 当${CardType.Indulgence}使用`];
    logs.push(...(await ctx.resolveDelayedTrick(player, convertedCard, target.id)));
    logs.push(...(await ctx.resolveDeaths()));
    logs.push(...ctx.resolveWinner());
    await ctx.advanceIfCurrentPlayerDead(logs);
    return logs;
  }
  if (action.cardIndex <= -200 && action.cardIndex > -400) {
    const index = -200 - action.cardIndex;
    const converted = player.hand[index];
    if (!converted || converted.type !== CardType.Dodge || !ctx.hasSkill(player, SkillName.LongDan)) {
      return ["使用卡牌失败"];
    }
    if (!ctx.canPlaySlashInTurn(player)) {
      return [`${player.name} 本回合已使用过杀`];
    }
    if (!targetId) {
      return ["需要选择目标"];
    }
    const target = ctx.mustGetPlayer(targetId);
    if (
      !target.alive ||
      target.id === player.id ||
      !ctx.canReachForSlash(player, target) ||
      ctx.isKongChengProtected(target, CardType.Slash)
    ) {
      return ["目标无效"];
    }
    const used = await ctx.removeHandCardAt(player, index);
    if (!used) {
      return ["使用卡牌失败"];
    }
    ctx.discardPile.push(used);
    ctx.slashUsedThisTurn = true;
    const logs = [`${player.name} 发动${SkillName.LongDan}，将${CardType.Dodge}当${CardType.Slash}使用`];
    logs.push(...(await ctx.resolveSlash(player, target, false, slashKindOf(player, used.type), used)));
    logs.push(...(await ctx.resolveDeaths()));
    logs.push(...ctx.resolveWinner());
    await ctx.advanceIfCurrentPlayerDead(logs);
    return logs;
  }
  if (action.cardIndex <= -500 && action.cardIndex > -1000) {
    // 铁索连环重铸：弃置此牌并摸一张
    const index = -500 - action.cardIndex;
    const card = player.hand[index];
    if (!card || card.type !== CardType.IronChain) {
      return [`${player.name} 当前无法重铸${CardType.IronChain}`];
    }
    const removed = await ctx.removeHandCardAt(player, index);
    if (!removed) {
      return ["使用卡牌失败"];
    }
    const discardLogs: string[] = [];
    await ctx.discardCards([removed], player, "弃置", discardLogs);
    const drawn = ctx.drawCards(player.id, 1);
    const logs = [`${player.name} 重铸${CardType.IronChain}，摸了 ${drawn} 张牌`, ...discardLogs];
    logs.push(...(await ctx.resolveDeaths()));
    logs.push(...ctx.resolveWinner());
    await ctx.advanceIfCurrentPlayerDead(logs);
    return logs;
  }
  if (action.cardIndex <= -400 && action.cardIndex > -1000) {
    const index = -400 - action.cardIndex;
    const converted = player.hand[index];
    if (!converted || converted.type === CardType.Slash || converted.color !== "red" || !ctx.hasSkill(player, SkillName.WuSheng)) {
      return ["使用卡牌失败"];
    }
    if (!ctx.canPlaySlashInTurn(player)) {
      return [`${player.name} 本回合已使用过杀`];
    }
    if (!targetId) {
      return ["需要选择目标"];
    }
    const target = ctx.mustGetPlayer(targetId);
    if (
      !target.alive ||
      target.id === player.id ||
      !ctx.canReachForSlash(player, target) ||
      ctx.isKongChengProtected(target, CardType.Slash)
    ) {
      return ["目标无效"];
    }
    const used = await ctx.removeHandCardAt(player, index);
    if (!used) {
      return ["使用卡牌失败"];
    }
    ctx.discardPile.push(used);
    ctx.slashUsedThisTurn = true;
    const logs = [`${player.name} 发动${SkillName.WuSheng}，将红色${used.type}当${CardType.Slash}使用`];
    logs.push(...(await ctx.resolveSlash(player, target, false, slashKindOf(player, used.type), used)));
    logs.push(...(await ctx.resolveDeaths()));
    logs.push(...ctx.resolveWinner());
    await ctx.advanceIfCurrentPlayerDead(logs);
    return logs;
  }
  if (action.cardIndex === -11) {
    if (player.treasure !== CardType.WoodenOx || player.hand.length === 0) {
      return [`${player.name} 当前无法发动${CardType.WoodenOx}`];
    }
    const handSources = ctx.buildUsableSources(player).filter((source) => source.origin === "hand");
    const [moved] = await ctx.requestDiscardSelection(player, 1, "木牛流马：选择1张手牌置于其下", handSources);
    if (!moved) {
      return [`${player.name} 当前无法发动${CardType.WoodenOx}`];
    }
    player.treasureCards.push(moved);
    ctx.oxStoredTurnMap().set(moved.id, ctx.turn);
    return [`${player.name} 将 ${moved.type} 置于${CardType.WoodenOx}下方`];
  }
  if (action.cardIndex === -13) {
    if (player.treasure !== CardType.WoodenOx || player.treasureCards.length === 0) {
      return [`${player.name} 当前无法从${CardType.WoodenOx}取牌`];
    }
    const oxSources = ctx.buildUsableSources(player).filter(
      (source) => source.origin === "treasure" && ctx.canTakeStoredCard(source.card),
    );
    const [taken] = await ctx.requestDiscardSelection(player, 1, "木牛流马：选择取出1张牌", oxSources);
    if (!taken) {
      return [`${player.name} 当前无法从${CardType.WoodenOx}取牌`];
    }
    player.hand.push(taken);
    return [`${player.name} 从${CardType.WoodenOx}取出了 ${taken.type}`];
  }
  if (action.cardIndex === -12) {
    if (player.treasure !== CardType.WoodenOx || !targetId) {
      return ["目标无效"];
    }
    const target = ctx.mustGetPlayer(targetId);
    if (!target.alive || target.id === player.id) {
      return ["目标无效"];
    }
    const logs = [`${player.name} 将${CardType.WoodenOx}移动给${target.name}`];
    if (target.treasure !== null) {
      ctx.discardPile.push(ctx.createCard(target.treasure, `replace-${ctx.turn}`));
      logs.push(`${target.name} 的旧宝物 ${target.treasure} 被替换并弃置`);
    }
    target.treasure = CardType.WoodenOx;
    target.treasureCards.push(...player.treasureCards);
    player.treasureCards = [];
    player.treasure = null;
    return logs;
  }
  if (action.cardIndex <= -1000) {
    if (player.treasure !== CardType.WoodenOx) {
      return [`${player.name} 当前无法使用${CardType.WoodenOx}下的牌`];
    }
    const index = -1000 - action.cardIndex;
    const preview = player.treasureCards[index];
    // 木牛流马下的杀同样受每回合出杀次数限制（防客户端绕过可玩动作列表）
    if (preview && ctx.isSlashCard(preview.type) && !ctx.canPlaySlashInTurn(player)) {
      return [`${player.name} 本回合已使用过杀`];
    }
    const usedCard = player.treasureCards.splice(index, 1)[0];
    if (!usedCard) {
      return ["使用卡牌失败"];
    }
    return ctx.resolveUsedCard(player, usedCard, targetId, true, selectedCardId);
  }
  if (action.cardIndex === -1) {
    if (player.weapon !== CardType.SerpentSpear || player.hand.length < 2) {
      return [`${player.name} 当前无法发动丈八蛇矛`];
    }
    if (ctx.slashUsedThisTurn && !getSkillRules(player).slashLimitExempt) {
      return [`${player.name} 本回合已使用过杀`];
    }
    if (!targetId) {
      return ["需要选择目标"];
    }
    const target = ctx.mustGetPlayer(targetId);
    if (!target.alive || target.id === player.id || !ctx.canReachForSlash(player, target)) {
      return ["目标无效"];
    }
    const first = await ctx.removeHandCardAt(player, 0);
    const second = await ctx.removeHandCardAt(player, 0);
    if (!first || !second) {
      return [`${player.name} 手牌不足，无法发动丈八蛇矛`];
    }
    const discardLogs: string[] = [];
    await ctx.discardCards([first, second], player, "弃置", discardLogs);
    if (!getSkillRules(player).slashLimitExempt) {
      ctx.slashUsedThisTurn = true;
    }
    const logs = [
      `${player.name} 发动丈八蛇矛，弃置 ${first.type}、${second.type} 视为使用杀`,
      ...discardLogs,
      ...(await ctx.resolveSlash(player, target, true, slashKindOf(player, undefined))),
    ];
    return logs;
  }
  const card = player.hand[action.cardIndex];
  if (!card) {
    return [`${player.name} 选择了无效卡牌`];
  }
  if (
    ctx.isSlashCard(card.type) &&
    ctx.slashUsedThisTurn &&
    !getSkillRules(player).slashLimitExempt &&
    player.weapon !== CardType.Crossbow
  ) {
    return [`${player.name} 本回合已使用过杀`];
  }
  if (card.type === CardType.Peach && player.hp >= player.maxHp) {
    return [`${player.name} 当前体力已满`];
  }
  if (card.type === CardType.Negate) {
    return [`${player.name} 不能主动使用无懈可击`];
  }
  if (ctx.cardNeedsTarget(card.type)) {
    if (!targetId) {
      return ["需要选择目标"];
    }
    const target = ctx.mustGetPlayer(targetId);
    // 铁索连环是唯一可以指定**自己**的有目标牌（`findTargetsByCard` 就是按"含自己"枚举的，
    // 官方规则同样允许"横置/重置一名角色，包括你自己"）。此前这里一律拒绝自己，
    // 导致 UI/AI 能选到一个 playAction 必然拒绝的目标 → 联机实测出现"目标无效"死循环。
    if (!target.alive || (target.id === player.id && card.type !== CardType.IronChain)) {
      return ["目标无效"];
    }
    if ((ctx.isSlashCard(card.type) || card.type === CardType.Duel) && ctx.isKongChengProtected(target, card.type)) {
      return [`${target.name} 的${SkillName.KongCheng}生效，无法成为目标`];
    }
    if (ctx.isSlashCard(card.type) && !ctx.canReachForSlash(player, target)) {
      return ["目标超出攻击范围"];
    }
    if (isDistanceOneTrickCard(card.type) && !ctx.canReachForDistanceOneTrick(player, target)) {
      return [`目标超出距离，${card.type}只能对距离 1 以内的角色使用`];
    }
  }

  const usedCard = await ctx.removeHandCardAt(player, action.cardIndex);
  if (!usedCard) {
    return ["使用卡牌失败"];
  }
  return ctx.resolveUsedCard(player, usedCard, targetId, false, selectedCardId);
}

export async function resolveUsedCard(ctx: PlayExecuteContext, player: Player, usedCard: Card, targetId: string | undefined, fromTreasure: boolean, selectedCardId?: string): Promise<string[]> {
  ctx.discardPile.push(usedCard);
  const logs: string[] = [];
  // 拦截点 card_used：使用一张牌时（结算前）通知，reason="使用"。
  // targets 按"指定目标"口径填入：有 targetId 的牌取该角色（杀的丈八蛇矛追加目标在结算时展开，不在此列）；
  // 全体锦囊按实际影响范围展开；无目标的牌（无中生有/桃/酒/装备）为空数组。
  const usedTargets: Player[] = targetId
    ? [ctx.mustGetPlayer(targetId)]
    : usedCard.type === CardType.Barbarian || usedCard.type === CardType.ArrowRain
      ? ctx.players.filter((p) => p.alive && p.id !== player.id)
      : usedCard.type === CardType.PeachGarden || usedCard.type === CardType.Harvest
        ? ctx.players.filter((p) => p.alive)
        : usedCard.type === CardType.Lightning
          ? [player]
          : [];
  await ctx.emitSkillTrigger(
    "card_used",
    { actor: player, card: usedCard, reason: "使用", targets: usedTargets },
    logs,
  );
  if (fromTreasure) {
    logs.push(`${player.name} 从${CardType.WoodenOx}下使用了 ${usedCard.type}`);
  }
  if (ctx.hasSkill(player, SkillName.JiZhi) && await ctx.shouldActivateOptionalEffect(player, SkillName.JiZhi) && ctx.isNonDelayedTrickCard(usedCard.type)) {
    const drawn = ctx.drawCards(player.id, 1);
    logs.push(`${player.name} 的${SkillName.JiZhi}生效，摸了 ${drawn} 张牌`);
  }
  if (ctx.isSlashCard(usedCard.type) && targetId) {
    if (!getSkillRules(player).slashLimitExempt) {
      ctx.slashUsedThisTurn = true;
    }
    const slashTargets = await ctx.expandSlashTargets(player, ctx.mustGetPlayer(targetId), player.hand.length === 0);
    for (const slashTarget of slashTargets) {
      logs.push(...(await ctx.resolveSlash(player, slashTarget, false, slashKindOf(player, usedCard.type), usedCard)));
    }
  } else if (usedCard.type === CardType.Peach) {
    player.hp = Math.min(player.maxHp, player.hp + 1);
    logs.push(`${player.name} 使用桃，回复 1 点体力`);
  } else if (usedCard.type === CardType.Wine) {
    // 方法Ⅰ：出牌阶段对自己使用，本回合下一张杀伤害+1（每回合限一次，由可玩动作列表保证）
    ctx.wineUsedPlayerIds.add(player.id);
    ctx.wineBuffPlayerIds.add(player.id);
    logs.push(`${player.name} 使用酒，本回合下一张杀伤害+1`);
  } else if (usedCard.type === CardType.Dismantle && targetId) {
    logs.push(...(await ctx.resolveDismantle(player, ctx.mustGetPlayer(targetId), selectedCardId)));
  } else if (usedCard.type === CardType.Snatch && targetId) {
    logs.push(...(await ctx.resolveSnatch(player, ctx.mustGetPlayer(targetId), selectedCardId)));
  } else if (usedCard.type === CardType.Duel && targetId) {
    logs.push(...(await ctx.resolveDuel(player, ctx.mustGetPlayer(targetId), usedCard)));
  } else if (usedCard.type === CardType.ExNihilo) {
    if (await ctx.tryNegateGlobal(player, usedCard.type, logs)) {
      logs.push(`${player.name} 的${usedCard.type}被无懈可击抵消`);
    } else {
      const drawn = ctx.drawCards(player.id, 2);
      logs.push(`${player.name} 使用无中生有，摸了 ${drawn} 张牌`);
    }
  } else if (usedCard.type === CardType.Barbarian) {
    logs.push(...(await ctx.resolveBarbarian(player, usedCard)));
  } else if (usedCard.type === CardType.ArrowRain) {
    logs.push(...(await ctx.resolveArrowRain(player, usedCard)));
  } else if (usedCard.type === CardType.FireAttack && targetId) {
    logs.push(...(await ctx.resolveFireAttack(player, ctx.mustGetPlayer(targetId), usedCard)));
  } else if (usedCard.type === CardType.IronChain && targetId) {
    logs.push(...(await ctx.resolveIronChain(player, ctx.mustGetPlayer(targetId))));
  } else if (usedCard.type === CardType.Collateral && targetId) {
    logs.push(...(await ctx.resolveCollateral(player, ctx.mustGetPlayer(targetId))));
  } else if (usedCard.type === CardType.PeachGarden) {
    if (await ctx.tryNegateGlobal(player, usedCard.type, logs)) {
      logs.push(`${player.name} 的${usedCard.type}被无懈可击抵消`);
    } else {
      logs.push(...ctx.resolvePeachGarden(player));
    }
  } else if (usedCard.type === CardType.Harvest) {
    if (await ctx.tryNegateGlobal(player, usedCard.type, logs)) {
      logs.push(`${player.name} 的${usedCard.type}被无懈可击抵消`);
    } else {
      logs.push(...ctx.resolveHarvest(player));
    }
  } else if (usedCard.type === CardType.Lightning) {
    logs.push(...(await ctx.resolveDelayedTrick(player, usedCard, player.id)));
  } else if (ctx.isDelayedTrickCard(usedCard.type) && targetId) {
    logs.push(...(await ctx.resolveDelayedTrick(player, usedCard, targetId)));
  } else if (ctx.isEquipCard(usedCard.type)) {
    logs.push(...(await ctx.resolveEquip(player, usedCard.type)));
  }
  logs.push(...(await ctx.resolveDeaths()));
  logs.push(...ctx.resolveWinner());
  await ctx.advanceIfCurrentPlayerDead(logs);
  return logs;
}
