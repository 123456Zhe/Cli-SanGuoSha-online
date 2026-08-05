import { Card, CardType } from "./cards.js";
import { resolveGeneralByName } from "./generals.js";
import {
  CardSource,
  GameAction,
  InteractionDecision,
  InteractionRequest,
  Player,
  PlayerRole,
  SkillName,
  TurnPhase,
} from "./types.js";

export type SkillUseContext = {
  players: Player[];
  discardPile: Card[];
  currentPlayer: Player;
  phase: TurnPhase;
  slashUsedThisTurn: boolean;
  skillUsedThisTurn: Map<string, Set<SkillName>>;
  skillCountsThisTurn: Map<string, Map<SkillName, number>>;
  skillFlagsThisTurn: Map<string, Set<SkillName>>;
  optionalEffectDecisions: Map<string, boolean>;
  mustGetPlayer(id: string): Player;
  randomIndex(length: number): number;
  decide(request: InteractionRequest): Promise<InteractionDecision>;
  nextInteractionId(): number;
  buildUsableSources(player: Player): CardSource[];
  requestDiscardSelection(player: Player, count: number, reason: string, providedSources?: CardSource[]): Promise<Card[]>;
  removeUsableCardBySourceId(player: Player, sourceId: string): Promise<Card | undefined>;
  removeHandCardAt(player: Player, index: number, logs?: string[]): Promise<Card | undefined>;
  drawCards(playerId: string, count: number): number;
  applyDamage(source: Player | null, target: Player, amount: number, reason: string, logs: string[]): Promise<void>;
  resolveDuel(user: Player, target: Player): Promise<string[]>;
  resolveDeaths(): Promise<string[]>;
  resolveWinner(): string[];
  advanceIfCurrentPlayerDead(logs: string[]): Promise<void>;
};

export function hasSkill(player: Player, skill: SkillName): boolean {
  return player.skills.includes(skill);
}

export function resetTurnSkillState(ctx: SkillUseContext, playerId: string): void {
  ctx.skillUsedThisTurn.set(playerId, new Set<SkillName>());
  ctx.skillCountsThisTurn.set(playerId, new Map<SkillName, number>());
  ctx.skillFlagsThisTurn.set(playerId, new Set<SkillName>());
}

export function markSkillUsed(ctx: SkillUseContext, playerId: string, skill: SkillName): void {
  const state = ctx.skillUsedThisTurn.get(playerId) ?? new Set<SkillName>();
  state.add(skill);
  ctx.skillUsedThisTurn.set(playerId, state);
}

export function isSkillUsed(ctx: SkillUseContext, playerId: string, skill: SkillName): boolean {
  const state = ctx.skillUsedThisTurn.get(playerId);
  if (!state) {
    return false;
  }
  return state.has(skill);
}

export function getTurnSkillCount(ctx: SkillUseContext, playerId: string, skill: SkillName): number {
  return ctx.skillCountsThisTurn.get(playerId)?.get(skill) ?? 0;
}

export function incrementTurnSkillCount(ctx: SkillUseContext, playerId: string, skill: SkillName): number {
  const counts = ctx.skillCountsThisTurn.get(playerId) ?? new Map<SkillName, number>();
  const next = (counts.get(skill) ?? 0) + 1;
  counts.set(skill, next);
  ctx.skillCountsThisTurn.set(playerId, counts);
  return next;
}

export function hasTurnSkillFlag(ctx: SkillUseContext, playerId: string, skill: SkillName): boolean {
  return ctx.skillFlagsThisTurn.get(playerId)?.has(skill) ?? false;
}

export function setTurnSkillFlag(ctx: SkillUseContext, playerId: string, skill: SkillName): void {
  const flags = ctx.skillFlagsThisTurn.get(playerId) ?? new Set<SkillName>();
  flags.add(skill);
  ctx.skillFlagsThisTurn.set(playerId, flags);
}

export function shouldActivateOptionalEffect(
  ctx: SkillUseContext,
  player: Player,
  effect: SkillName | CardType,
): Promise<boolean> {
  const key = `${player.id}:${effect}`;
  const decision = ctx.optionalEffectDecisions.get(key);
  ctx.optionalEffectDecisions.delete(key);
  if (decision !== undefined) {
    return Promise.resolve(decision);
  }
  return (async () => {
    const result = await ctx.decide({
      kind: "optional-effect",
      requestId: ctx.nextInteractionId(),
      playerId: player.id,
      effect: effect.toString(),
      reason: `是否发动${effect}？`,
    });
    return result.choice === "effect" ? result.enabled : false;
  })();
}

export function canPlaySlashInTurn(ctx: SkillUseContext, player: Player): boolean {
  if (hasSkill(player, SkillName.Roar)) {
    return true;
  }
  if (player.weapon === CardType.Crossbow) {
    return true;
  }
  return !ctx.slashUsedThisTurn;
}

export function canUseAssault(ctx: SkillUseContext, player: Player): boolean {
  if (!hasSkill(player, SkillName.Assault)) {
    return false;
  }
  if (player.hand.length === 0) {
    return false;
  }
  return !isSkillUsed(ctx, player.id, SkillName.Assault);
}

export function getLordWithZhiBa(ctx: SkillUseContext): Player | null {
  const lord = ctx.players.find((item) => item.alive && item.role === PlayerRole.Lord && hasSkill(item, SkillName.ZhiBa));
  return lord ?? null;
}

export function canUseZhiBa(ctx: SkillUseContext, player: Player): boolean {
  const lord = getLordWithZhiBa(ctx);
  if (!lord) {
    return false;
  }
  if (lord.id === player.id) {
    return false;
  }
  if (resolveGeneralByName(player.general).kingdom !== "吴") {
    return false;
  }
  if (player.hand.length === 0 || lord.hand.length === 0) {
    return false;
  }
  return !isSkillUsed(ctx, player.id, SkillName.ZhiBa);
}

export function canUseFanJian(ctx: SkillUseContext, player: Player): boolean {
  if (!hasSkill(player, SkillName.FanJian) || player.hand.length === 0) {
    return false;
  }
  return !isSkillUsed(ctx, player.id, SkillName.FanJian);
}

export function canUseZhiHeng(ctx: SkillUseContext, player: Player): boolean {
  if (!hasSkill(player, SkillName.ZhiHeng)) {
    return false;
  }
  if (player.hand.length === 0) {
    return false;
  }
  return !isSkillUsed(ctx, player.id, SkillName.ZhiHeng);
}

export function canUseQingNang(ctx: SkillUseContext, player: Player): boolean {
  if (!hasSkill(player, SkillName.QingNang)) {
    return false;
  }
  if (player.hand.length === 0) {
    return false;
  }
  return !isSkillUsed(ctx, player.id, SkillName.QingNang);
}

export function canUseKuRou(ctx: SkillUseContext, player: Player): boolean {
  if (!hasSkill(player, SkillName.KuRou)) {
    return false;
  }
  return player.hp > 0;
}

export function canUseRenDe(ctx: SkillUseContext, player: Player): boolean {
  if (!hasSkill(player, SkillName.RenDe) || player.hand.length === 0) {
    return false;
  }
  return ctx.players.some((item) => item.alive && item.id !== player.id);
}

export function canUseLiJian(ctx: SkillUseContext, player: Player): boolean {
  if (!hasSkill(player, SkillName.LiJian) || player.hand.length === 0) {
    return false;
  }
  const maleCount = ctx.players.filter((p) => p.alive && p.gender === "男").length;
  if (maleCount < 2) {
    return false;
  }
  return !isSkillUsed(ctx, player.id, SkillName.LiJian);
}

export function canUseJieYin(ctx: SkillUseContext, player: Player): boolean {
  if (!hasSkill(player, SkillName.JieYin) || player.hand.length < 2) {
    return false;
  }
  const hasMaleWounded = ctx.players.some(
    (p) => p.alive && p.gender === "男" && p.id !== player.id && p.hp < p.maxHp,
  );
  if (!hasMaleWounded) {
    return false;
  }
  return !isSkillUsed(ctx, player.id, SkillName.JieYin);
}

export async function useSkillAction(
  ctx: SkillUseContext,
  playerId: string,
  action: Extract<GameAction, { type: "skill" }>,
  targetId?: string,
): Promise<string[]> {
  const player = ctx.mustGetPlayer(playerId);
  if (!player.alive || player.id !== ctx.currentPlayer.id || ctx.phase !== TurnPhase.Play) {
    return [];
  }
  if (action.skill === SkillName.Assault) {
    if (!canUseAssault(ctx, player)) {
      return [`${player.name} 当前无法发动${SkillName.Assault}`];
    }
    if (!targetId) {
      return ["需要选择目标"];
    }
    const target = ctx.mustGetPlayer(targetId);
    if (!target.alive || target.id === player.id) {
      return ["目标无效"];
    }
    const [discarded] = await ctx.requestDiscardSelection(player, 1, `发动：选择弃置1张牌`);
    if (!discarded) {
      return [` 没有可弃置手牌`];
    }
    ctx.discardPile.push(discarded);
    markSkillUsed(ctx, player.id, SkillName.Assault);
    const logs = [` 发动，弃置 `];
    await ctx.applyDamage(player, target, 1, SkillName.Assault, logs);
    logs.push(...(await ctx.resolveDeaths()));
    logs.push(...ctx.resolveWinner());
    await ctx.advanceIfCurrentPlayerDead(logs);
    return logs;
  }
  if (action.skill === SkillName.ZhiHeng) {
    if (!canUseZhiHeng(ctx, player)) {
      return [`${player.name} 当前无法发动${SkillName.ZhiHeng}`];
    }
    const discardCount = player.hand.length;
    if (discardCount <= 0) {
      return [`${player.name} 没有可弃置手牌`];
    }
    const discarded: Card[] = [];
    while (discarded.length < discardCount && player.hand.length > 0) {
      const card = await ctx.removeHandCardAt(player, 0);
      if (card) {
        discarded.push(card);
      }
    }
    ctx.discardPile.push(...discarded);
    const drawn = ctx.drawCards(player.id, discardCount);
    markSkillUsed(ctx, player.id, SkillName.ZhiHeng);
    return [`${player.name} 发动${SkillName.ZhiHeng}，弃置 ${discardCount} 张并摸了 ${drawn} 张牌`];
  }
  if (action.skill === SkillName.QingNang) {
    if (!canUseQingNang(ctx, player)) {
      return [`${player.name} 当前无法发动${SkillName.QingNang}`];
    }
    if (!targetId) {
      return ["需要选择目标"];
    }
    const target = ctx.mustGetPlayer(targetId);
    if (!target.alive || target.hp >= target.maxHp) {
      return ["目标无效"];
    }
    const [discarded] = await ctx.requestDiscardSelection(player, 1, `发动：选择弃置1张手牌`);
    if (!discarded) {
      return [` 没有可弃置手牌`];
    }
    ctx.discardPile.push(discarded);
    target.hp = Math.min(target.maxHp, target.hp + 1);
    markSkillUsed(ctx, player.id, SkillName.QingNang);
    return [` 发动，弃置 ，令回复 1 点体力`];
  }
  if (action.skill === SkillName.KuRou) {
    if (!canUseKuRou(ctx, player)) {
      return [`${player.name} 当前无法发动${SkillName.KuRou}`];
    }
    player.hp -= 1;
    const drawn = ctx.drawCards(player.id, 2);
    const logs = [`${player.name} 发动${SkillName.KuRou}，失去 1 点体力并摸了 ${drawn} 张牌`];
    logs.push(...(await ctx.resolveDeaths()));
    logs.push(...ctx.resolveWinner());
    await ctx.advanceIfCurrentPlayerDead(logs);
    return logs;
  }
  if (action.skill === SkillName.RenDe) {
    if (!canUseRenDe(ctx, player)) {
      return [`${player.name} 当前无法发动${SkillName.RenDe}`];
    }
    if (!targetId) {
      return ["需要选择目标"];
    }
    const target = ctx.mustGetPlayer(targetId);
    if (!target.alive || target.id === player.id) {
      return ["目标无效"];
    }
    const logs: string[] = [];
    let given = 0;
    while (player.hand.length > 0) {
      const sources = ctx.buildUsableSources(player);
      if (sources.length === 0) {
        break;
      }
      const decision = await ctx.decide({
        kind: "choose-discard",
        requestId: ctx.nextInteractionId(),
        playerId: player.id,
        reason: `${SkillName.RenDe}：将手牌交给 ${target.name}（每张一次，放弃则停止）`,
        sources,
        count: 1,
        allowPass: true,
        passLabel: `停止${SkillName.RenDe}`,
      });
      if (decision.choice !== "card") {
        break;
      }
      const card =
        (await ctx.removeUsableCardBySourceId(player, decision.sourceId)) ??
        (await ctx.removeHandCardAt(player, ctx.randomIndex(player.hand.length)));
      if (!card) {
        break;
      }
      target.hand.push(card);
      given += 1;
      logs.push(`${player.name} 发动${SkillName.RenDe}，将 ${card.type} 交给 ${target.name}`);
    }
    if (given === 0) {
      return ["未给出任何手牌"];
    }
    let total = getTurnSkillCount(ctx, player.id, SkillName.RenDe);
    for (let i = 0; i < given; i += 1) {
      total = incrementTurnSkillCount(ctx, player.id, SkillName.RenDe);
    }
    if (total >= 2 && !hasTurnSkillFlag(ctx, player.id, SkillName.RenDe)) {
      setTurnSkillFlag(ctx, player.id, SkillName.RenDe);
      player.hp = Math.min(player.maxHp, player.hp + 1);
      logs.push(`${player.name} 发动${SkillName.RenDe}累计给出 ${total} 张，回复 1 点体力`);
    }
    return logs;
  }
  if (action.skill === SkillName.FanJian) {
    if (!canUseFanJian(ctx, player)) {
      return [`${player.name} 当前无法发动${SkillName.FanJian}`];
    }
    if (!targetId) {
      return ["需要选择目标"];
    }
    const target = ctx.mustGetPlayer(targetId);
    if (!target.alive || target.id === player.id) {
      return ["目标无效"];
    }
    const suitOptions: Card["suit"][] = ["heart", "diamond", "club", "spade"];
    const suitDecision = await ctx.decide({
      kind: "choose-suit",
      requestId: ctx.nextInteractionId(),
      playerId: target.id,
      reason: `${player.name} 对你发动${SkillName.FanJian}：请声明1种花色`,
      suits: suitOptions,
    });
    const declaredSuit =
      suitDecision.choice === "suit" && suitOptions.includes(suitDecision.suit)
        ? suitDecision.suit
        : suitOptions[ctx.randomIndex(suitOptions.length)] ?? "heart";
    const pickDecision = await ctx.decide({
      kind: "choose-discard",
      requestId: ctx.nextInteractionId(),
      playerId: target.id,
      reason: `${SkillName.FanJian}：从 ${player.name} 的手牌中选择1张获得`,
      sources: player.hand.map((handCard, index) => ({
        sourceId: `hand:${handCard.id}`,
        origin: "hand" as const,
        card: handCard,
        label: `${player.name} 的手牌 ${index + 1}`,
      })),
      count: 1,
      allowPass: false,
    });
    const card =
      pickDecision.choice === "card"
        ? (await ctx.removeUsableCardBySourceId(player, pickDecision.sourceId)) ??
          (await ctx.removeHandCardAt(player, ctx.randomIndex(player.hand.length)))
        : await ctx.removeHandCardAt(player, ctx.randomIndex(player.hand.length));
    if (!card) {
      return [`${player.name} 没有可交给目标的手牌`];
    }
    target.hand.push(card);
    markSkillUsed(ctx, player.id, SkillName.FanJian);
    const suitNames = { heart: "红桃", diamond: "方片", club: "梅花", spade: "黑桃", none: "无花色" } as const;
    const logs = [
      `${player.name} 发动${SkillName.FanJian}，${target.name} 声明${suitNames[declaredSuit]}并获得 ${card.type}`,
    ];
    if (card.suit !== declaredSuit) {
      await ctx.applyDamage(player, target, 1, SkillName.FanJian, logs);
      logs.push(...(await ctx.resolveDeaths()));
      logs.push(...ctx.resolveWinner());
      await ctx.advanceIfCurrentPlayerDead(logs);
    } else {
      logs.push(`${card.type} 的花色与声明相同，${target.name} 未受到伤害`);
    }
    return logs;
  }
  if (action.skill === SkillName.ZhiBa) {
    const lord = getLordWithZhiBa(ctx);
    if (!lord || !canUseZhiBa(ctx, player)) {
      return [`${player.name} 当前无法发动${SkillName.ZhiBa}`];
    }
    if (lord.skills.includes(SkillName.YingHun)) {
      markSkillUsed(ctx, player.id, SkillName.ZhiBa);
      return [`${lord.name} 已觉醒，拒绝${player.name} 的${SkillName.ZhiBa}拼点`];
    }
    const attackerIndex = ctx.randomIndex(player.hand.length);
    const attackerCard = await ctx.removeHandCardAt(player, attackerIndex);
    const lordIndex = ctx.randomIndex(lord.hand.length);
    const lordCard = await ctx.removeHandCardAt(lord, lordIndex);
    markSkillUsed(ctx, player.id, SkillName.ZhiBa);
    const logs = [
      `${player.name} 发动${SkillName.ZhiBa}，与${lord.name}拼点`,
      `${player.name} 拼点牌：${attackerCard?.type}（点数 ${attackerCard?.rank}）`,
      `${lord.name} 拼点牌：${lordCard?.type}（点数 ${lordCard?.rank}）`,
    ];
    const attackerWon = attackerCard && lordCard && attackerCard.rank > lordCard.rank;
    if (attackerWon) {
      if (attackerCard) ctx.discardPile.push(attackerCard);
      if (lordCard) ctx.discardPile.push(lordCard);
      logs.push(`${player.name} 拼点获胜，两张拼点牌置入弃牌堆`);
    } else {
      if (attackerCard) lord.hand.push(attackerCard);
      if (lordCard) lord.hand.push(lordCard);
      logs.push(`${player.name} 拼点未胜，${lord.name} 获得${SkillName.ZhiBa}两张拼点牌`);
    }
    return logs;
  }
  if (action.skill === SkillName.LiJian) {
    if (!canUseLiJian(ctx, player)) {
      return [`${player.name} 当前无法发动${SkillName.LiJian}`];
    }
    if (!targetId) {
      return ["需要选择目标"];
    }
    const firstMale = ctx.mustGetPlayer(targetId);
    if (!firstMale.alive || firstMale.id === player.id || firstMale.gender !== "男") {
      return ["目标无效"];
    }
    const secondMale = ctx.players
      .filter((p) => p.alive && p.gender === "男" && p.id !== firstMale.id && p.id !== player.id)
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    if (!secondMale) {
      return ["没有足够的男性角色"];
    }
    const [discarded] = await ctx.requestDiscardSelection(player, 1, `发动：选择弃置1张牌`);
    if (!discarded) {
      return [` 没有可弃置手牌`];
    }
    ctx.discardPile.push(discarded);
    markSkillUsed(ctx, player.id, SkillName.LiJian);
    const logs = [` 发动，弃置 ，令  与  决斗`];
    logs.push(...(await ctx.resolveDuel(firstMale, secondMale)));
    logs.push(...(await ctx.resolveDeaths()));
    logs.push(...ctx.resolveWinner());
    await ctx.advanceIfCurrentPlayerDead(logs);
    return logs;
  }
  if (action.skill === SkillName.JieYin) {
    if (!canUseJieYin(ctx, player)) {
      return [`${player.name} 当前无法发动${SkillName.JieYin}`];
    }
    if (!targetId) {
      return ["需要选择目标"];
    }
    const target = ctx.mustGetPlayer(targetId);
    if (!target.alive || target.id === player.id || target.gender !== "男" || target.hp >= target.maxHp) {
      return ["目标无效"];
    }
    const discarded = await ctx.requestDiscardSelection(player, 2, `发动：选择弃置2张手牌`);
    if (discarded.length < 2) {
      return [` 手牌不足 2 张`];
    }
    ctx.discardPile.push(...discarded);
    target.hp = Math.min(target.maxHp, target.hp + 1);
    player.hp = Math.min(player.maxHp, player.hp + 1);
    markSkillUsed(ctx, player.id, SkillName.JieYin);
    return [` 发动，弃置 2 张手牌， 与  各回复 1 点体力`];
  }
  return [`${player.name} 发动了未知技能`];
}
