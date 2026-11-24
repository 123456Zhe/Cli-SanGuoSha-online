import { Card, CardType, CARD_LIBRARY_SUMMARY, createDeck, shuffle } from "./cards.js";
import {
  attributeDamageKind,
  cardNeedsTarget as cardNeedsTargetImpl,
  DamageKind,
  describeCard,
  hasRemovableCard as cardUtilsHasRemovableCard,
  isDelayedTrickCard as isDelayedTrickCardImpl,
  isDistanceOneTrickCard,
  isEquipCard as isEquipCardImpl,
  isNonDelayedTrickCard as isNonDelayedTrickCardImpl,
  isSlashCard as isSlashCardImpl,
  matchesConversionFilter,
  responseKindToCardType,
  slashKindFromCardType,
  slashKindOf,
} from "./card-utils.js";
import {
  AiHeuristicsContext,
  pickBestAiAction,
  pickBestTarget,
} from "./ai-heuristics.js";
import {
  buildRoleList,
  getAiName,
  getRoleDistribution,
  GENERAL_LIBRARY,
  pickRandomUnusedGeneral,
  resolveGeneralByName,
} from "./generals.js";
import {
  canReachForDistanceOneTrick as canReachForDistanceOneTrickImpl,
  canReachForSlash as canReachForSlashImpl,
  createCard as createCardImpl,
  discardSelfCards as discardSelfCardsImpl,
  discardWoodenOxStoredCards as discardWoodenOxStoredCardsImpl,
  expandSlashTargets as expandSlashTargetsImpl,
  onLoseEquip as onLoseEquipImpl,
  removeRandomCardFromPlayer as removeRandomCardFromPlayerImpl,
  ResolveContext,
  resolveArrowRain as resolveArrowRainImpl,
  resolveBarbarian as resolveBarbarianImpl,
  resolveCollateral as resolveCollateralImpl,
  resolveDeaths as resolveDeathsImpl,
  resolveDelayedJudgments as resolveDelayedJudgmentsImpl,
  resolveDelayedTrick as resolveDelayedTrickImpl,
  resolveDismantle as resolveDismantleImpl,
  resolveDuel as resolveDuelImpl,
  resolveEquip as resolveEquipImpl,
  resolveFireAttack as resolveFireAttackImpl,
  resolveHarvest as resolveHarvestImpl,
  resolveIronChain as resolveIronChainImpl,
  resolvePeachGarden as resolvePeachGardenImpl,
  resolveSingleDelayedJudgment as resolveSingleDelayedJudgmentImpl,
  resolveSlash as resolveSlashImpl,
  resolveSnatch as resolveSnatchImpl,
  resolveWinner as resolveWinnerImpl,
  tryNegateGlobal as tryNegateGlobalImpl,
} from "./resolve.js";
import { createSkillHooks, SkillHooksContext } from "./skill-hooks.js";
import { getPackSkill, getPackSkills } from "./skill-module.js";
import type { SkillModuleCtx } from "./skill-module.js";
import { resolveSkillDescriptor } from "./skill-registry.js";
import type { SkillConversion } from "./skill-registry.js";
import type { SlashKind } from "./card-utils.js";
import { findSkillWithBooleanRule, getHandLimit, getSkillRules, isImmuneTo } from "./skill-rules.js";
import {
  canPlaySlashInTurn as canPlaySlashInTurnImpl,
  canUseAssault as canUseAssaultImpl,
  canUseFanJian as canUseFanJianImpl,
  canUseJieYin as canUseJieYinImpl,
  canUseKuRou as canUseKuRouImpl,
  canUseLiJian as canUseLiJianImpl,
  canUseQingNang as canUseQingNangImpl,
  canUseRenDe as canUseRenDeImpl,
  canUseZhiBa as canUseZhiBaImpl,
  canUseZhiHeng as canUseZhiHengImpl,
  getLordWithZhiBa as getLordWithZhiBaImpl,
  hasSkill as playerHasSkill,
  isSkillUsed as playerIsSkillUsed,
  isSkillUsedThisRound as playerIsSkillUsedThisRound,
  markSkillUsed as playerMarkSkillUsed,
  markSkillUsedThisRound as playerMarkSkillUsedThisRound,
  resetTurnSkillState as playerResetTurnSkillState,
  shouldActivateOptionalEffect as playerShouldActivateOptionalEffect,
  SkillUseContext,
  useSkillAction as useSkillActionImpl,
} from "./skills.js";
import {
  CardSource,
  DecisionHandler,
  DiscardOption,
  EquipCardType,
  GameAction,
  GameInitOptions,
  GameSnapshot,
  GeneralDefinition,
  InteractionDecision,
  InteractionRequest,
  NetworkPlayerConfig,
  Player,
  PlayerRole,
  RemovableCardOption,
  ResponseKind,
  ResponseOption,
  SkillEventPayload,
  SkillHook,
  SkillId,
  SkillName,
  SkillTrigger,
  TurnPhase,
} from "./types.js";

import {
  initDefaultGame as initDefaultGameImpl,
  initNetworkGame as initNetworkGameImpl,
  normalizeInitOptions as normalizeInitOptionsImpl,
  createPlayer as createPlayerImpl,
  applyLordBonus as applyLordBonusImpl,
} from "./game-setup.js";
import type { GameSetupContext } from "./game-setup.js";

import {
  startTurn as startTurnImpl,
  endPlayPhase as endPlayPhaseImpl,
  shouldSkipDiscardPhase as shouldSkipDiscardPhaseImpl,
  finishTurn as finishTurnImpl,
  moveToNextPlayer as moveToNextPlayerImpl,
  advanceIfCurrentPlayerDead as advanceIfCurrentPlayerDeadImpl,
} from "./turn-flow.js";
import type { TurnFlowContext } from "./turn-flow.js";

import {
  drawCards as drawCardsImpl,
  discardCards as discardCardsImpl,
  drawCard as drawCardImpl,
  drawJudgmentCard as drawJudgmentCardImpl,
  discardFromPlayerHand as discardFromPlayerHandImpl,
  removeHandCardAt as removeHandCardAtImpl,
  checkLianYing as checkLianYingImpl,
  takeRandomHandCard as takeRandomHandCardImpl,
  drawTopCards as drawTopCardsImpl,
  placeCardsOnTop as placeCardsOnTopImpl,
  placeCardsOnBottom as placeCardsOnBottomImpl,
  emitSkillTrigger as emitSkillTriggerImpl,
  applyDamage as applyDamageImpl,
  isKongChengProtected as isKongChengProtectedImpl,
  damageCreditMap as damageCreditMapImpl,
  removeCardFromAllZones as removeCardFromAllZonesImpl,
  oxStoredTurnMap as oxStoredTurnMapImpl,
  canTakeStoredCard as canTakeStoredCardImpl,
  noteDamageSource as noteDamageSourceImpl,
  takeDamageSource as takeDamageSourceImpl,
} from "./card-zones.js";
import type { CardZonesContext } from "./card-zones.js";

import {
  buildAnyDiscardSources as buildAnyDiscardSourcesImpl,
  takeEquipSlot as takeEquipSlotImpl,
  requestFlexibleDiscard as requestFlexibleDiscardImpl,
  buildUsableSources as buildUsableSourcesImpl,
  peekUsableCard as peekUsableCardImpl,
  removeUsableCardBySourceId as removeUsableCardBySourceIdImpl,
  buildDodgeSources as buildDodgeSourcesImpl,
  buildSlashSources as buildSlashSourcesImpl,
  appendConversionSources as appendConversionSourcesImpl,
  buildNegateSources as buildNegateSourcesImpl,
  buildPeachSources as buildPeachSourcesImpl,
  buildResponseSources as buildResponseSourcesImpl,
  requestDiscardSelection as requestDiscardSelectionImpl,
} from "./card-sources.js";
import type { CardSourcesContext } from "./card-sources.js";

import {
  decide as decideImpl,
  autoDecisionForDeadPlayer as autoDecisionForDeadPlayerImpl,
  autoDecision as autoDecisionImpl,
  consumeResponseCard as consumeResponseCardImpl,
  requestCardResponse as requestCardResponseImpl,
  canPlayerRespond as canPlayerRespondImpl,
  consumeSelectedResponse as consumeSelectedResponseImpl,
  consumePeachResponse as consumePeachResponseImpl,
  takePlayerResponseSelection as takePlayerResponseSelectionImpl,
  getPlayerResponseOptions as getPlayerResponseOptionsImpl,
  setPlayerResponseSelection as setPlayerResponseSelectionImpl,
  setPeachDecision as setPeachDecisionImpl,
  clearPeachDecisions as clearPeachDecisionsImpl,
} from "./response-pipeline.js";
import type { ResponsePipelineContext } from "./response-pipeline.js";

import {
  getPlayableActions as getPlayableActionsImpl,
  canUseConversionNow as canUseConversionNowImpl,
  notifyConversionUsed as notifyConversionUsedImpl,
  appendConversionActions as appendConversionActionsImpl,
  playerConversions as playerConversionsImpl,
  responseConversions as responseConversionsImpl,
  validateConversionTarget as validateConversionTargetImpl,
  resolveConversionUse as resolveConversionUseImpl,
  findTargetsByCard as findTargetsByCardImpl,
} from "./play-enumerate.js";
import type { PlayEnumerateContext } from "./play-enumerate.js";

import { playAction as playActionImpl, resolveUsedCard as resolveUsedCardImpl } from "./play-execute.js";
import type { PlayExecuteContext } from "./play-execute.js";

import {
  runAITurn as runAITurnImpl,
  getBestAiDecision as getBestAiDecisionImpl,
  aiTurnSeenStatesSet as aiTurnSeenStatesSetImpl,
  buildAiTurnProgressKey as buildAiTurnProgressKeyImpl,
  noteAiTurnProgress as noteAiTurnProgressImpl,
  beginAiTurnProgress as beginAiTurnProgressImpl,
} from "./ai-driver.js";
import type { AiDriverContext } from "./ai-driver.js";

export { TurnPhase, SkillName, PlayerRole } from "./types.js";
export type {
  Player,
  GameAction,
  GameSnapshot,
  GameInitOptions,
  NetworkPlayerConfig,
  GeneralDefinition,
  ResponseOption,
  DiscardOption,
  RemovableCardOption,
} from "./types.js";
export { GENERAL_LIBRARY } from "./generals.js";
export type { CardSource, DecisionHandler, InteractionDecision, InteractionRequest, ResponseKind } from "./interaction.js";



export class SanGuoGame {
  private players: Player[];

  private deck: Card[];

  private discardPile: Card[];

  private currentPlayerIndex: number;

  private turn: number;

  /** Phase 9：当前轮次（从 1 开始；一轮 = 从起始座位到回到该座位之前的所有回合）。 */
  private round: number;

  /** Phase 9：本轮起始座位的下标（轮次回到该座位时 round +1；起始玩家阵亡则锚点顺延到下一位存活者）。 */
  private roundStartIndex: number;

  private phase: TurnPhase;

  private slashUsedThisTurn: boolean;

  /** 本回合是否"打出"过杀（响应决斗/南蛮等），与 `slashUsedThisTurn`（使用）分开计数。 */
  private slashPlayedThisTurn: boolean;

  /** 本回合已获得"下一张杀伤害+1"的玩家（酒方法Ⅰ） */
  private wineBuffPlayerIds: Set<string>;
  /** 本回合已使用过酒（方法Ⅰ）的玩家，每回合限一次 */
  private wineUsedPlayerIds: Set<string>;

  private winner: "human" | "ai" | "draw" | null;

  private readonly rng: () => number;

  private skillUsedThisTurn: Map<string, Set<SkillName>>;

  /** Phase 9：本轮已用过的技能（轮次推进时清空）。 */
  private skillUsedThisRound: Map<string, Set<SkillName>>;

  private skillCountsThisTurn: Map<string, Map<SkillName, number>>;

  private skillFlagsThisTurn: Map<string, Set<SkillName>>;

  private readonly skillHooks: Record<SkillTrigger, SkillHook[]>;

  private responsePolicyByPlayer: Map<string, Partial<Record<ResponseKind, boolean>>>;

  private responseSelectionByPlayer: Map<string, Partial<Record<ResponseKind, string>>>;

  private decisionHandlers: Map<string, DecisionHandler>;

  private interactionSeq: number;

  private optionalEffectDecisions: Map<string, boolean>;

  private peachDecisions: Map<string, Map<string, string | null>>;

  private deferDyingResolution: boolean;
  private skipDrawPhase: string | null;
  private skipPlayPhase: string | null;
  private staged = false;
  private pendingNextTurn = false;
  private pendingTurnEndPlayer: string | null = null;
  /**
   * 最近一次伤害的来源（目标 playerId → 来源 playerId | null），用于死亡结算时的击杀奖惩。
   * 迟初始化：热重载会让已存活的实例缺少新字段，因此统一经 damageCreditMap() 访问。
   */
  private damageCredit: Map<string, string | null> | undefined;

  /**
   * 木牛流马存牌回合（存牌 id → 存入时的 `turn`）。本回合刚置入的牌本回合不许取出，
   * 掐掉"置入/取出"零收益 2-循环（跨回合取出不受影响）。迟初始化（见 damageCredit）。
   */
  private woodenOxStoredTurn: Map<string, number> | undefined;

  /**
   * AI 回合防空转：本回合已出现过的局面签名。局面重复出现即决策器在零收益打转，
   * 调用方（runAITurn / 联机 driveAiTurn）应强制结束出牌。迟初始化（见 damageCredit）。
   */
  private aiTurnSeenStates: Set<string> | undefined;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
    this.players = [];
    this.deck = [];
    this.discardPile = [];
    this.currentPlayerIndex = 0;
    this.turn = 1;
    this.round = 1;
    this.roundStartIndex = 0;
    this.phase = TurnPhase.Draw;
    this.slashUsedThisTurn = false;
    this.slashPlayedThisTurn = false;
    this.wineBuffPlayerIds = new Set();
    this.wineUsedPlayerIds = new Set();
    this.winner = null;
    this.skillUsedThisTurn = new Map();
    this.skillUsedThisRound = new Map();
    this.skillCountsThisTurn = new Map();
    this.skillFlagsThisTurn = new Map();
    this.skillHooks = createSkillHooks(this as unknown as SkillHooksContext);
    this.responsePolicyByPlayer = new Map();
    this.responseSelectionByPlayer = new Map();
    this.decisionHandlers = new Map();
    this.interactionSeq = 0;
    this.optionalEffectDecisions = new Map();
    this.peachDecisions = new Map();
    this.deferDyingResolution = false;
    this.skipDrawPhase = null;
    this.skipPlayPhase = null;
    this.staged = false;
    this.pendingNextTurn = false;
    this.pendingTurnEndPlayer = null;
  }

  async initDefaultGame(options: Partial<GameInitOptions> = {}): Promise<string[]> {
    return initDefaultGameImpl(this as unknown as GameSetupContext, options);
  }

  async initNetworkGame(playerConfigs: NetworkPlayerConfig[], openingHandCount = 4, startImmediately = true): Promise<string[]> {
    return initNetworkGameImpl(this as unknown as GameSetupContext, playerConfigs, openingHandCount, startImmediately);
  }

  getSnapshot(): GameSnapshot {
    return {
      turn: this.turn,
      currentPlayerId: this.players.length > 0 ? this.currentPlayer.id : "",
      phase: this.phase,
      players: this.players.map((player) => ({
        ...player,
        hand: [...player.hand],
      })),
      winner: this.winner,
      gameOver: this.winner !== null,
      slashUsed: this.slashUsedThisTurn,
      deckCount: this.deck.length,
      discardCount: this.discardPile.length,
    };
  }

  getCurrentPlayer(): Player {
    return this.currentPlayer;
  }

  async ensureTurnState(): Promise<string[]> {
    if (this.winner !== null) {
      return [];
    }
    const current = this.currentPlayer;
    if (current.alive) {
      return [];
    }
    const logs = [`${current.name} 已阵亡，跳过其回合`];
    this.moveToNextPlayer();
    if (this.winner !== null) {
      return logs;
    }
    if (this.staged) {
      this.pendingNextTurn = true;
      return logs;
    }
    logs.push(...(await this.startTurn()));
    return logs;
  }

  getCardLibrary() {
    return CARD_LIBRARY_SUMMARY.map((item) => ({ ...item }));
  }

  getGeneralLibrary(): GeneralDefinition[] {
    return GENERAL_LIBRARY.map((item) => ({
      kingdom: item.kingdom,
      name: item.name,
      gender: item.gender,
      maxHp: item.maxHp,
      skills: [...item.skills],
      ...(item.description !== undefined ? { description: item.description } : {}),
    }));
  }

  getPlayerSnapshotSummary(playerId: string): {
    id: string;
    name: string;
    hp: number;
    maxHp: number;
    handCount: number;
    alive: boolean;
    faceDown: boolean;
  } {
    const player = this.mustGetPlayer(playerId);
    return {
      id: player.id,
      name: player.name,
      hp: player.hp,
      maxHp: player.maxHp,
      handCount: player.hand.length,
      alive: player.alive,
      faceDown: player.faceDown,
    };
  }

  getPlayableActions(playerId: string): GameAction[] {
    return getPlayableActionsImpl(this as unknown as PlayEnumerateContext, playerId);
  }

  private canUseConversionNow(player: Player, skillId: SkillId, conversion: SkillConversion): boolean {
    return canUseConversionNowImpl(this as unknown as PlayEnumerateContext, player, skillId, conversion);
  }

  private async notifyConversionUsed(player: Player, skillId: SkillId, conversion: SkillConversion, logs: string[]): Promise<void> {
    return notifyConversionUsedImpl(this as unknown as PlayEnumerateContext, player, skillId, conversion, logs);
  }

  private appendConversionActions(player: Player, actions: GameAction[], canPlaySlash: boolean): void {
    return appendConversionActionsImpl(this as unknown as PlayEnumerateContext, player, actions, canPlaySlash);
  }

  private playerConversions(player: Player): { skillId: SkillId; conversion: SkillConversion }[] {
    return playerConversionsImpl(this as unknown as PlayEnumerateContext, player);
  }

  private responseConversions(player: Player, kind: ResponseKind): { skillId: SkillId; conversion: SkillConversion }[] {
    return responseConversionsImpl(this as unknown as PlayEnumerateContext, player, kind);
  }

  private validateConversionTarget(player: Player, convertTo: CardType, targetId: string | undefined): string | null {
    return validateConversionTargetImpl(this as unknown as PlayEnumerateContext, player, convertTo, targetId);
  }

  private async resolveConversionUse(player: Player, source: { origin: "hand" | "treasure"; index: number }, viaSkillId: SkillId | undefined, convertTo: CardType | undefined, targetId: string | undefined): Promise<string[]> {
    return resolveConversionUseImpl(this as unknown as PlayEnumerateContext, player, source, viaSkillId, convertTo, targetId);
  }

  getPendingDiscardCount(playerId: string): number {
    if (this.winner !== null) {
      return 0;
    }
    const player = this.mustGetPlayer(playerId);
    if (!player.alive || player.id !== this.currentPlayer.id || this.phase !== TurnPhase.Discard) {
      return 0;
    }
    return Math.max(0, player.hand.length - getHandLimit(player));
  }

  getDiscardOptions(playerId: string): DiscardOption[] {
    if (this.getPendingDiscardCount(playerId) <= 0) {
      return [];
    }
    const player = this.mustGetPlayer(playerId);
    return player.hand.map((card, handIndex) => ({
      handIndex,
      cardId: card.id,
      cardType: card.type,
    }));
  }

  getRemovableCardOptions(targetId: string): RemovableCardOption[] {
    const target = this.players.find((item) => item.id === targetId);
    if (!target || !target.alive) {
      return [];
    }
    const options: RemovableCardOption[] = [];
    if (target.hand.length > 0) {
      options.push({
        id: "hand-random",
        zone: "hand",
        cardType: null,
        label: `手牌（随机1张，当前${target.hand.length}张）`,
      });
    }
    if (target.weapon !== null) {
      options.push({
        id: "weapon",
        zone: "weapon",
        cardType: target.weapon,
        label: `武器 ${target.weapon}`,
      });
    }
    if (target.armor !== null) {
      options.push({
        id: "armor",
        zone: "armor",
        cardType: target.armor,
        label: `防具 ${target.armor}`,
      });
    }
    if (target.defenseHorse !== null) {
      options.push({
        id: "defenseHorse",
        zone: "defenseHorse",
        cardType: target.defenseHorse,
        label: `+1马 ${target.defenseHorse}`,
      });
    }
    if (target.attackHorse !== null) {
      options.push({
        id: "attackHorse",
        zone: "attackHorse",
        cardType: target.attackHorse,
        label: `-1马 ${target.attackHorse}`,
      });
    }
    if (target.treasure !== null) {
      options.push({
        id: "treasure",
        zone: "treasure",
        cardType: target.treasure,
        label: `宝物 ${target.treasure}`,
      });
    }
    return options;
  }

  async discardForCurrentPlayer(playerId: string, handIndex: number): Promise<string[]> {
    if (this.winner !== null) {
      return [];
    }
    const player = this.mustGetPlayer(playerId);
    if (!player.alive || player.id !== this.currentPlayer.id || this.phase !== TurnPhase.Discard) {
      return [];
    }
    if (!Number.isInteger(handIndex) || handIndex < 0 || handIndex >= player.hand.length) {
      return ["弃牌选择无效"];
    }
    const removed = await this.removeHandCardAt(player, handIndex);
    if (!removed) {
      return ["弃牌选择无效"];
    }
    const logs = [`${player.name} 弃置了 ${removed.type}`];
    await this.discardCards([removed], player, "弃置", logs);
    if (player.hand.length > getHandLimit(player)) {
      return logs;
    }
    if (this.staged) {
      this.pendingTurnEndPlayer = player.id;
    } else {
      logs.push(...(await this.finishTurn(player)));
    }
    return logs;
  }

  async playAction(playerId: string, action: GameAction, targetId?: string, selectedCardId?: string): Promise<string[]> {
    return playActionImpl(this as unknown as PlayExecuteContext, playerId, action, targetId, selectedCardId);
  }

  /**
   * 全体/无指向锦囊的无懈可击询问（无中生有/桃园结义/五谷丰登）：
   * 统一走 `resolve.ts` 的 `tryNegateGlobal`（与闪电自贴同口径）。
   */
  private async tryNegateGlobal(user: Player, trickType: CardType, logs: string[]): Promise<boolean> {
    return tryNegateGlobalImpl(this as unknown as ResolveContext, user, trickType, logs);
  }

  private async resolveUsedCard(player: Player, usedCard: Card, targetId: string | undefined, fromTreasure: boolean, selectedCardId?: string): Promise<string[]> {
    return resolveUsedCardImpl(this as unknown as PlayExecuteContext, player, usedCard, targetId, fromTreasure, selectedCardId);
  }

  async runAITurn(): Promise<string[]> {
    return runAITurnImpl(this as unknown as AiDriverContext);
  }

  getBestAiDecision(playerId: string): { action: GameAction; targetId?: string } | null {
    return getBestAiDecisionImpl(this as unknown as AiDriverContext, playerId);
  }

  setPlayerResponsePolicy(playerId: string, policy: Partial<Record<ResponseKind, boolean>> | null): void {
    if (policy === null) {
      this.responsePolicyByPlayer.delete(playerId);
      return;
    }
    this.responsePolicyByPlayer.set(playerId, { ...(this.responsePolicyByPlayer.get(playerId) ?? {}), ...policy });
  }

  setDecisionHandler(playerId: string, handler: DecisionHandler | null): void {
    if (handler === null) {
      this.decisionHandlers.delete(playerId);
      return;
    }
    this.decisionHandlers.set(playerId, handler);
  }

  getUsableCardSources(playerId: string): CardSource[] {
    return this.buildUsableSources(this.mustGetPlayer(playerId));
  }

  private nextInteractionId(): number {
    this.interactionSeq += 1;
    return this.interactionSeq;
  }

  private async decide(request: InteractionRequest): Promise<InteractionDecision> {
    return decideImpl(this as unknown as ResponsePipelineContext, request);
  }

  private autoDecisionForDeadPlayer(request: InteractionRequest): InteractionDecision {
    return autoDecisionForDeadPlayerImpl(this as unknown as ResponsePipelineContext, request);
  }

  private autoDecision(request: InteractionRequest): InteractionDecision {
    return autoDecisionImpl(this as unknown as ResponsePipelineContext, request);
  }

  private buildAnyDiscardSources(player: Player): Array<CardSource & { card: Card }> {
    return buildAnyDiscardSourcesImpl(this as unknown as CardSourcesContext, player);
  }

  private takeEquipSlot(player: Player, slot: string): EquipCardType | null {
    return takeEquipSlotImpl(this as unknown as CardSourcesContext, player, slot);
  }

  private async requestFlexibleDiscard(player: Player, reason: string, logs: string[]): Promise<number> {
    return requestFlexibleDiscardImpl(this as unknown as CardSourcesContext, player, reason, logs);
  }

  private buildUsableSources(player: Player): Array<CardSource & { card: Card }> {
    return buildUsableSourcesImpl(this as unknown as CardSourcesContext, player);
  }

  private peekUsableCard(player: Player, sourceId: string): (CardSource & { card: Card })| undefined {
    return peekUsableCardImpl(this as unknown as CardSourcesContext, player, sourceId);
  }

  private async removeUsableCardBySourceId(player: Player, sourceId: string): Promise<Card | undefined> {
    return removeUsableCardBySourceIdImpl(this as unknown as CardSourcesContext, player, sourceId);
  }

  private buildDodgeSources(player: Player): CardSource[] {
    return buildDodgeSourcesImpl(this as unknown as CardSourcesContext, player);
  }

  private buildSlashSources(player: Player): CardSource[] {
    return buildSlashSourcesImpl(this as unknown as CardSourcesContext, player);
  }

  private appendConversionSources(player: Player, kind: ResponseKind, sources: CardSource[]): void {
    return appendConversionSourcesImpl(this as unknown as CardSourcesContext, player, kind, sources);
  }

  private buildNegateSources(player: Player): CardSource[] {
    return buildNegateSourcesImpl(this as unknown as CardSourcesContext, player);
  }

  private buildPeachSources(player: Player, selfRescue = false): CardSource[] {
    return buildPeachSourcesImpl(this as unknown as CardSourcesContext, player, selfRescue);
  }

  private buildResponseSources(player: Player, kind: ResponseKind, selfRescue = false): CardSource[] {
    return buildResponseSourcesImpl(this as unknown as CardSourcesContext, player, kind, selfRescue);
  }

  private async consumeResponseCard(player: Player, kind: ResponseKind, sourceId: string, logs: string[]): Promise<boolean> {
    return consumeResponseCardImpl(this as unknown as ResponsePipelineContext, player, kind, sourceId, logs);
  }

  private async requestCardResponse(player: Player, kind: ResponseKind, trigger: { cardName: string; actorId: string }, logs: string[]): Promise<boolean> {
    return requestCardResponseImpl(this as unknown as ResponsePipelineContext, player, kind, trigger, logs);
  }

  private async requestDiscardSelection(player: Player, count: number, reason: string, providedSources?: CardSource[]): Promise<Card[]> {
    return requestDiscardSelectionImpl(this as unknown as CardSourcesContext, player, count, reason, providedSources);
  }

  private canPlayerRespond(playerId: string, kind: ResponseKind): boolean {
    return canPlayerRespondImpl(this as unknown as ResponsePipelineContext, playerId, kind);
  }

  private async consumeSelectedResponse(player: Player, kind: ResponseKind, optionId: string, logs: string[]): Promise<boolean> {
    return consumeSelectedResponseImpl(this as unknown as ResponsePipelineContext, player, kind, optionId, logs);
  }

  private async consumePeachResponse(player: Player, dyingPlayerId: string, logs: string[]): Promise<boolean> {
    return consumePeachResponseImpl(this as unknown as ResponsePipelineContext, player, dyingPlayerId, logs);
  }

  private takePlayerResponseSelection(playerId: string, kind: ResponseKind): string | undefined {
    return takePlayerResponseSelectionImpl(this as unknown as ResponsePipelineContext, playerId, kind);
  }

  setOptionalEffectDecision(playerId: string, effect: SkillName | CardType, enabled: boolean | null): void {
    const key = `${playerId}:${effect}`;
    if (enabled === null) this.optionalEffectDecisions.delete(key);
    else this.optionalEffectDecisions.set(key, enabled);
  }

  getPlayerResponseOptions(playerId: string, kind: ResponseKind): ResponseOption[] {
    return getPlayerResponseOptionsImpl(this as unknown as ResponsePipelineContext, playerId, kind);
  }

  setPlayerResponseSelection(playerId: string, kind: ResponseKind, optionId: string | null): void {
    return setPlayerResponseSelectionImpl(this as unknown as ResponsePipelineContext, playerId, kind, optionId);
  }

  setPeachDecision(dyingPlayerId: string, rescuerId: string, optionId: string | null): void {
    return setPeachDecisionImpl(this as unknown as ResponsePipelineContext, dyingPlayerId, rescuerId, optionId);
  }

  clearPeachDecisions(): void {
    return clearPeachDecisionsImpl(this as unknown as ResponsePipelineContext);
  }

  setDeferDyingResolution(enabled: boolean): void {
    this.deferDyingResolution = enabled;
  }

  consumePendingNextTurn(): boolean {
    const value = this.pendingNextTurn;
    this.pendingNextTurn = false;
    return value;
  }

  consumePendingTurnEnd(): string | null {
    const value = this.pendingTurnEndPlayer;
    this.pendingTurnEndPlayer = null;
    return value;
  }

  isGameOver(): boolean {
    return this.winner !== null;
  }

  getTurnStartOptionalEffects(playerId: string): (SkillName | CardType)[] {
    const player = this.mustGetPlayer(playerId);
    if (player.faceDown) {
      return this.hasSkill(player, SkillName.JieWei) ? [SkillName.JieWei] : [];
    }
    const effects: (SkillName | CardType)[] = [];
    if (this.hasSkill(player, SkillName.GuanXing)) effects.push(SkillName.GuanXing);
    if (this.hasSkill(player, SkillName.LuoShen)) effects.push(SkillName.LuoShen);
    if (this.hasSkill(player, SkillName.YingHun) && Math.max(0, player.maxHp - player.hp) > 0) {
      const others = this.players.filter((item) => item.alive && item.id !== player.id);
      if (others.length > 0) effects.push(SkillName.YingHun);
    }
    if (this.hasSkill(player, SkillName.Heroic)) effects.push(SkillName.Heroic);
    if (this.hasSkill(player, SkillName.LuoYi)) effects.push(SkillName.LuoYi);
    if (this.hasSkill(player, SkillName.TuXi)) effects.push(SkillName.TuXi);
    return effects;
  }

  getTurnEndOptionalEffects(playerId: string): (SkillName | CardType)[] {
    const player = this.mustGetPlayer(playerId);
    const effects: (SkillName | CardType)[] = [];
    if (this.hasSkill(player, SkillName.BiYue)) effects.push(SkillName.BiYue);
    if (this.hasSkill(player, SkillName.JuShou)) effects.push(SkillName.JuShou);
    return effects;
  }

  async resolvePendingDeaths(): Promise<string[]> {
    const deferred = this.deferDyingResolution;
    this.deferDyingResolution = false;
    const logs = [...(await this.resolveDeaths()), ...this.resolveWinner()];
    this.deferDyingResolution = deferred;
    return logs;
  }

  async startTurn(): Promise<string[]> {
    return startTurnImpl(this as unknown as TurnFlowContext);
  }

  private async endPlayPhase(playerId: string): Promise<string[]> {
    return endPlayPhaseImpl(this as unknown as TurnFlowContext, playerId);
  }

  private async shouldSkipDiscardPhase(player: Player, logs: string[]): Promise<boolean> {
    return shouldSkipDiscardPhaseImpl(this as unknown as TurnFlowContext, player, logs);
  }

  async finishTurn(player: Player): Promise<string[]> {
    return finishTurnImpl(this as unknown as TurnFlowContext, player);
  }

  private findTargetsByCard(playerId: string, cardType: CardType): string[] {
    return findTargetsByCardImpl(this as unknown as PlayEnumerateContext, playerId, cardType);
  }

  private drawCards(playerId: string, count: number): number {
    return drawCardsImpl(this as unknown as CardZonesContext, playerId, count);
  }

  private async discardCards(cards: Card[], actor: Player, reason: "弃置" | "判定", logs: string[]): Promise<void> {
    return discardCardsImpl(this as unknown as CardZonesContext, cards, actor, reason, logs);
  }

  private drawCard(): Card | null {
    return drawCardImpl(this as unknown as CardZonesContext);
  }

  private async drawJudgmentCard(reason: string, logs: string[], owner?: Player): Promise<Card | null> {
    return drawJudgmentCardImpl(this as unknown as CardZonesContext, reason, logs, owner);
  }

  private moveToNextPlayer(): void {
    return moveToNextPlayerImpl(this as unknown as TurnFlowContext);
  }

  private async advanceIfCurrentPlayerDead(logs: string[]): Promise<void> {
    return advanceIfCurrentPlayerDeadImpl(this as unknown as TurnFlowContext, logs);
  }

  private normalizeInitOptions(options: Partial<GameInitOptions>): GameInitOptions {
    return normalizeInitOptionsImpl(this as unknown as GameSetupContext, options);
  }

  private createPlayer(id: string, name: string, isAI: boolean, general: GeneralDefinition, role: PlayerRole,): Player {
    return createPlayerImpl(this as unknown as GameSetupContext, id, name, isAI, general, role);
  }

  private mustGetPlayer(id: string): Player {
    const player = this.players.find((item) => item.id === id);
    if (!player) {
      throw new Error(`player not found: ${id}`);
    }
    return player;
  }

  private randomIndex(length: number): number {
    return Math.floor(this.rng() * length);
  }

  private async discardFromPlayerHand(player: Player, count: number, logs: string[]): Promise<number> {
    return discardFromPlayerHandImpl(this as unknown as CardZonesContext, player, count, logs);
  }

  // 集中式手牌移除：所有“失去手牌”的路径统一走这里，便于触发连营。
  private async removeHandCardAt(player: Player, index: number, logs?: string[]): Promise<Card | undefined> {
    return removeHandCardAtImpl(this as unknown as CardZonesContext, player, index, logs);
  }

  // 连营：失去最后一张手牌时可摸一张牌。
  private async checkLianYing(player: Player, logs?: string[]): Promise<void> {
    return checkLianYingImpl(this as unknown as CardZonesContext, player, logs);
  }

  // 突袭/其他技能用：从目标获得 1 张随机手牌（不取装备）。
  private async takeRandomHandCard(player: Player, receiver: Player): Promise<Card | undefined> {
    return takeRandomHandCardImpl(this as unknown as CardZonesContext, player, receiver);
  }

  private drawTopCards(count: number): Card[] {
    return drawTopCardsImpl(this as unknown as CardZonesContext, count);
  }

  private placeCardsOnTop(cards: Card[]): void {
    return placeCardsOnTopImpl(this as unknown as CardZonesContext, cards);
  }

  private placeCardsOnBottom(cards: Card[]): void {
    return placeCardsOnBottomImpl(this as unknown as CardZonesContext, cards);
  }

  private async emitSkillTrigger(trigger: SkillTrigger, payload: SkillEventPayload, logs: string[]): Promise<void> {
    return emitSkillTriggerImpl(this as unknown as CardZonesContext, trigger, payload, logs);
  }

  private async applyDamage(source: Player | null, target: Player, amount: number, reason: string, logs: string[], damageCard?: Card, damageKind?: DamageKind | null, isChainSpread = false): Promise<void> {
    return applyDamageImpl(this as unknown as CardZonesContext, source, target, amount, reason, logs, damageCard, damageKind, isChainSpread);
  }

  private isKongChengProtected(target: Player, cardType: CardType): boolean {
    return isKongChengProtectedImpl(this as unknown as CardZonesContext, target, cardType);
  }

  // ===== 以下为从本类拆出到独立模块的方法的薄封装（行为不变） =====

  private buildRoleList(playerCount: number): PlayerRole[] {
    return buildRoleList(playerCount);
  }

  private getRoleDistribution(roles: PlayerRole[]): { rebel: number; loyalist: number; traitor: number } {
    return getRoleDistribution(roles);
  }

  private resolveGeneralByName(generalName: string): GeneralDefinition {
    return resolveGeneralByName(generalName);
  }

  private pickRandomUnusedGeneral(usedGeneralNames: Set<string>): GeneralDefinition {
    return pickRandomUnusedGeneral(usedGeneralNames, this.rng);
  }

  private getAiName(index: number): string {
    return getAiName(index);
  }

  private hasSkill(player: Player, skill: SkillName): boolean {
    return playerHasSkill(player, skill);
  }

  /**
   * 该玩家有没有"可被拿走/弃置"的牌（手牌或装备区）。
   *
   * 这是 `SkillHooksContext.hasRemovableCard` 的运行时实现——它此前只出现在类型与文档里、
   * 没挂到实例上，导致内置「反馈」在玩家确认发动后抛 `ctx.hasRemovableCard is not a function`
   * （测试里 `autoDecision` 默认不发动可选效果，所以长期被掩盖）。
   * 回归守卫：`src/tools/generals-pack-types.test.ts` 会逐项断言 d.ts 里的 ctx 成员在真实实例上存在。
   */
  private hasRemovableCard(player: Player): boolean {
    return cardUtilsHasRemovableCard(player);
  }

  private applyLordBonus(): void {
    return applyLordBonusImpl(this as unknown as GameSetupContext);
  }

  private shouldActivateOptionalEffect(player: Player, effect: SkillName | CardType): Promise<boolean> {
    return playerShouldActivateOptionalEffect(this as unknown as SkillUseContext, player, effect);
  }

  private resetTurnSkillState(playerId: string): void {
    playerResetTurnSkillState(this as unknown as SkillUseContext, playerId);
  }

  private markSkillUsed(playerId: string, skill: SkillName): void {
    playerMarkSkillUsed(this as unknown as SkillUseContext, playerId, skill);
  }

  private isSkillUsed(playerId: string, skill: SkillName): boolean {
    return playerIsSkillUsed(this as unknown as SkillUseContext, playerId, skill);
  }

  /** Phase 9：记一次"本轮已用过该技能"（供外部技能 ctx 调用）。 */
  private markSkillUsedThisRound(playerId: string, skill: SkillName): void {
    playerMarkSkillUsedThisRound(this as unknown as SkillUseContext, playerId, skill);
  }

  /** Phase 9：查"本轮是否已用过该技能"（供外部技能 ctx 调用）。 */
  private isSkillUsedThisRound(playerId: string, skill: SkillName): boolean {
    return playerIsSkillUsedThisRound(this as unknown as SkillUseContext, playerId, skill);
  }

  private canPlaySlashInTurn(player: Player): boolean {
    return canPlaySlashInTurnImpl(this as unknown as SkillUseContext, player);
  }

  /** 酒方法Ⅰ：若玩家有"下一张杀伤害+1"增益则消耗并返回 true */
  consumeWineBuff(player: Player): boolean {
    if (this.wineBuffPlayerIds.has(player.id)) {
      this.wineBuffPlayerIds.delete(player.id);
      return true;
    }
    return false;
  }

  private canUseAssault(player: Player): boolean {
    return canUseAssaultImpl(this as unknown as SkillUseContext, player);
  }

  private getLordWithZhiBa(): Player | null {
    return getLordWithZhiBaImpl(this as unknown as SkillUseContext);
  }

  private canUseZhiBa(player: Player): boolean {
    return canUseZhiBaImpl(this as unknown as SkillUseContext, player);
  }

  private canUseFanJian(player: Player): boolean {
    return canUseFanJianImpl(this as unknown as SkillUseContext, player);
  }

  private canUseZhiHeng(player: Player): boolean {
    return canUseZhiHengImpl(this as unknown as SkillUseContext, player);
  }

  private canUseQingNang(player: Player): boolean {
    return canUseQingNangImpl(this as unknown as SkillUseContext, player);
  }

  private canUseKuRou(player: Player): boolean {
    return canUseKuRouImpl(this as unknown as SkillUseContext, player);
  }

  private canUseRenDe(player: Player): boolean {
    return canUseRenDeImpl(this as unknown as SkillUseContext, player);
  }

  private canUseLiJian(player: Player): boolean {
    return canUseLiJianImpl(this as unknown as SkillUseContext, player);
  }

  private canUseJieYin(player: Player): boolean {
    return canUseJieYinImpl(this as unknown as SkillUseContext, player);
  }

  private async useSkillAction(
    playerId: string,
    action: Extract<GameAction, { type: "skill" }>,
    targetId?: string,
  ): Promise<string[]> {
    return useSkillActionImpl(this as unknown as SkillUseContext, playerId, action, targetId);
  }

  private isSlashCard(cardType: CardType): boolean {
    return isSlashCardImpl(cardType);
  }

  isEquipCard(cardType: CardType): cardType is EquipCardType {
    return isEquipCardImpl(cardType);
  }

  private isDelayedTrickCard(cardType: CardType): boolean {
    return isDelayedTrickCardImpl(cardType);
  }

  private isNonDelayedTrickCard(cardType: CardType): boolean {
    return isNonDelayedTrickCardImpl(cardType);
  }

  private cardNeedsTarget(cardType: CardType): boolean {
    return cardNeedsTargetImpl(cardType);
  }

  private canReachForSlash(attacker: Player, target: Player): boolean {
    return canReachForSlashImpl(this as unknown as ResolveContext, attacker, target);
  }

  private canReachForDistanceOneTrick(user: Player, target: Player): boolean {
    return canReachForDistanceOneTrickImpl(this as unknown as ResolveContext, user, target);
  }

  private createCard(type: CardType, seed: string): Card {
    return createCardImpl(this as unknown as ResolveContext, type, seed);
  }

  private async discardSelfCards(player: Player, count: number): Promise<string[]> {
    return discardSelfCardsImpl(this as unknown as ResolveContext, player, count);
  }

  private async removeRandomCardFromPlayer(player: Player, mode: "弃置" | "获得", receiver?: Player): Promise<string[]> {
    return removeRandomCardFromPlayerImpl(this as unknown as ResolveContext, player, mode, receiver);
  }

  private async expandSlashTargets(player: Player, primary: Player, isLastHandSlash: boolean): Promise<Player[]> {
    return expandSlashTargetsImpl(this as unknown as ResolveContext, player, primary, isLastHandSlash);
  }

  /**
   * 外部代码技能的"使用一张杀"入口（Phase 7 / ③）。
   *
   * 与内置武圣/龙胆分支同构：结算 + 濒死 + 胜负 + 阵亡者回合推进一条龙。
   * 源牌的花色/类型由调用方负责（移出手牌、进弃牌堆），这里只负责"当成杀打出去"。
   */
  async useSlash(
    attacker: Player,
    target: Player,
    options: { kind?: SlashKind; card?: Card; fromSerpent?: boolean } = {},
  ): Promise<string[]> {
    const logs = await this.resolveSlash(attacker, target, options.fromSerpent ?? false, options.kind ?? "normal", options.card);
    logs.push(...(await this.resolveDeaths()));
    logs.push(...this.resolveWinner());
    await this.advanceIfCurrentPlayerDead(logs);
    return logs;
  }

  private resolveSlash(
    attacker: Player,
    target: Player,
    fromSerpent = false,
    kind: "normal" | "fire" | "thunder" = "normal",
    damageCard?: Card,
  ): Promise<string[]> {
    return resolveSlashImpl(this as unknown as ResolveContext, attacker, target, fromSerpent, kind, damageCard);
  }

  private resolveDismantle(user: Player, target: Player, selectedCardId?: string): Promise<string[]> {
    return resolveDismantleImpl(this as unknown as ResolveContext, user, target, selectedCardId);
  }

  private resolveSnatch(user: Player, target: Player, selectedCardId?: string): Promise<string[]> {
    return resolveSnatchImpl(this as unknown as ResolveContext, user, target, selectedCardId);
  }

  private resolveDuel(user: Player, target: Player, duelCard?: Card): Promise<string[]> {
    return resolveDuelImpl(this as unknown as ResolveContext, user, target, duelCard);
  }

  private resolveBarbarian(user: Player, trickCard?: Card): Promise<string[]> {
    return resolveBarbarianImpl(this as unknown as ResolveContext, user, trickCard);
  }

  private resolveArrowRain(user: Player, trickCard?: Card): Promise<string[]> {
    return resolveArrowRainImpl(this as unknown as ResolveContext, user, trickCard);
  }

  private resolveFireAttack(user: Player, target: Player, usedCard: Card): Promise<string[]> {
    return resolveFireAttackImpl(this as unknown as ResolveContext, user, target, usedCard);
  }

  private resolveIronChain(user: Player, target: Player): Promise<string[]> {
    return resolveIronChainImpl(this as unknown as ResolveContext, user, target);
  }

  private resolveCollateral(user: Player, target: Player): Promise<string[]> {
    return resolveCollateralImpl(this as unknown as ResolveContext, user, target);
  }

  private resolveDelayedTrick(user: Player, usedCard: Card, targetId: string): Promise<string[]> {
    return resolveDelayedTrickImpl(this as unknown as ResolveContext, user, usedCard, targetId);
  }

  private resolveDelayedJudgments(player: Player): Promise<string[]> {
    return resolveDelayedJudgmentsImpl(this as unknown as ResolveContext, player);
  }

  private resolveSingleDelayedJudgment(player: Player, index: number): Promise<string[]> {
    return resolveSingleDelayedJudgmentImpl(this as unknown as ResolveContext, player, index);
  }

  private resolvePeachGarden(user: Player): string[] {
    return resolvePeachGardenImpl(this as unknown as ResolveContext, user);
  }

  private resolveHarvest(user: Player): string[] {
    return resolveHarvestImpl(this as unknown as ResolveContext, user);
  }

  private resolveEquip(user: Player, equipType: EquipCardType): Promise<string[]> {
    return resolveEquipImpl(this as unknown as ResolveContext, user, equipType);
  }

  private resolveDeaths(): Promise<string[]> {
    return resolveDeathsImpl(this as unknown as ResolveContext);
  }

  private damageCreditMap(): Map<string, string | null> {
    return damageCreditMapImpl(this as unknown as CardZonesContext);
  }

  private removeCardFromAllZones(cardId: string): number {
    return removeCardFromAllZonesImpl(this as unknown as CardZonesContext, cardId);
  }

  private oxStoredTurnMap(): Map<string, number> {
    return oxStoredTurnMapImpl(this as unknown as CardZonesContext);
  }

  private aiTurnSeenStatesSet(): Set<string> {
    return aiTurnSeenStatesSetImpl(this as unknown as AiDriverContext);
  }

  private canTakeStoredCard(card: Card): boolean {
    return canTakeStoredCardImpl(this as unknown as CardZonesContext, card);
  }

  private buildAiTurnProgressKey(): string {
    return buildAiTurnProgressKeyImpl(this as unknown as AiDriverContext);
  }

  public noteAiTurnProgress(): boolean {
    return noteAiTurnProgressImpl(this as unknown as AiDriverContext);
  }

  public beginAiTurnProgress(): void {
    return beginAiTurnProgressImpl(this as unknown as AiDriverContext);
  }

  private noteDamageSource(sourceId: string | null, targetId: string): void {
    return noteDamageSourceImpl(this as unknown as CardZonesContext, sourceId, targetId);
  }

  private takeDamageSource(targetId: string): string | null {
    return takeDamageSourceImpl(this as unknown as CardZonesContext, targetId);
  }

  private resolveWinner(): string[] {
    return resolveWinnerImpl(this as unknown as ResolveContext);
  }

  private get currentPlayer(): Player {
    const player = this.players[this.currentPlayerIndex];
    if (!player) {
      throw new Error("current player missing");
    }
    return player;
  }
}
