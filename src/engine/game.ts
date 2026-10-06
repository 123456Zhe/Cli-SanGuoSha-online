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
import { getPackSkills } from "./skill-module.js";
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
  markSkillUsed as playerMarkSkillUsed,
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

const drawCountPerTurn = 2;

const defaultInitOptions: GameInitOptions = {
  playerCount: 3,
  aiCount: 2,
  openingHandCount: 4,
  humanName: "主公",
  humanRole: PlayerRole.Lord,
  humanGeneral: "孙策",
};

export class SanGuoGame {
  private players: Player[];

  private deck: Card[];

  private discardPile: Card[];

  private currentPlayerIndex: number;

  private turn: number;

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
    this.phase = TurnPhase.Draw;
    this.slashUsedThisTurn = false;
    this.slashPlayedThisTurn = false;
    this.wineBuffPlayerIds = new Set();
    this.wineUsedPlayerIds = new Set();
    this.winner = null;
    this.skillUsedThisTurn = new Map();
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
    const initOptions = this.normalizeInitOptions(options);
    const roleList = this.buildRoleList(initOptions.playerCount);
    const distribution = this.getRoleDistribution(roleList);
    const humanRole = roleList.includes(initOptions.humanRole) ? initOptions.humanRole : PlayerRole.Lord;
    const humanGeneralDefinition = this.resolveGeneralByName(initOptions.humanGeneral);
    const rolePool = [...roleList];
    const humanRoleIndex = rolePool.indexOf(humanRole);
    if (humanRoleIndex >= 0) {
      rolePool.splice(humanRoleIndex, 1);
    }

    this.players = [this.createPlayer("human", initOptions.humanName, false, humanGeneralDefinition, humanRole)];
    const usedGeneralNames = new Set<string>([humanGeneralDefinition.name]);
    for (let i = 0; i < rolePool.length; i += 1) {
      const role = rolePool[i] ?? PlayerRole.Rebel;
      const general = this.pickRandomUnusedGeneral(usedGeneralNames);
      usedGeneralNames.add(general.name);
      this.players.push(this.createPlayer(`ai-${i + 1}`, `玩家${this.getAiName(i)}`, true, general, role));
    }
    this.applyLordBonus();
    this.deck = shuffle(createDeck(), this.rng);
    this.discardPile = [];
    this.currentPlayerIndex = this.players.findIndex((player) => player.role === PlayerRole.Lord && player.alive);
    if (this.currentPlayerIndex < 0) {
      this.currentPlayerIndex = 0;
    }
    this.turn = 1;
    this.phase = TurnPhase.Draw;
    this.winner = null;
    this.slashUsedThisTurn = false;
    this.slashPlayedThisTurn = false;
    this.wineBuffPlayerIds = new Set();
    this.wineUsedPlayerIds = new Set();
    this.skillUsedThisTurn = new Map();
    this.skillCountsThisTurn = new Map();
    this.skillFlagsThisTurn = new Map();
    this.responsePolicyByPlayer.clear();
    this.responseSelectionByPlayer.clear();
    this.optionalEffectDecisions.clear();

    const logs = [
      `对局开始：${initOptions.playerCount} 人局`,
      `身份配比：反贼${distribution.rebel} 忠臣${distribution.loyalist} 内奸${distribution.traitor}`,
      `你的身份：${humanRole}`,
      `你的武将：${humanGeneralDefinition.name}`,
      `初始手牌：每人 ${initOptions.openingHandCount} 张`,
      "发牌中...",
    ];
    for (const player of this.players) {
      const drawn = this.drawCards(player.id, initOptions.openingHandCount);
      logs.push(`${player.name}[${player.general}] 获得 ${drawn} 张手牌`);
    }
    logs.push(...(await this.startTurn()));
    return logs;
  }

  async initNetworkGame(playerConfigs: NetworkPlayerConfig[], openingHandCount = 4, startImmediately = true): Promise<string[]> {
    if (playerConfigs.length < 2 || playerConfigs.length > 6) {
      throw new Error("联机人数必须在 2 到 6 人之间");
    }
    const ids = new Set(playerConfigs.map((player) => player.id));
    if (ids.size !== playerConfigs.length) {
      throw new Error("联机玩家 ID 不能重复");
    }
    const roles = this.buildRoleList(playerConfigs.length);
    const shuffledRoles = shuffle(roles, this.rng);
    const usedGeneralNames = new Set<string>();
    // 调试指定武将：按座位顺序先到先得，随机分配永远优先让位于显式指定；
    // 未知武将/被重复指定一律报错，绝不静默换人（否则玩家以为选上了实际没生效）。
    const pickGeneralFor = (config: NetworkPlayerConfig, index: number): GeneralDefinition => {
      if (config.general === undefined) {
        return this.pickRandomUnusedGeneral(usedGeneralNames);
      }
      const general = this.resolveGeneralByName(config.general);
      if (usedGeneralNames.has(general.name)) {
        throw new Error(`联机建局失败：武将「${general.name}」被指定了多次（座位 ${index + 1}：${config.name}）`);
      }
      return general;
    };
    this.players = playerConfigs.map((config, index) => {
      const general = pickGeneralFor(config, index);
      usedGeneralNames.add(general.name);
      return this.createPlayer(config.id, config.name, config.isAI ?? false, general, shuffledRoles[index] ?? PlayerRole.Rebel);
    });
    this.applyLordBonus();
    this.deck = shuffle(createDeck(), this.rng);
    this.discardPile = [];
    this.currentPlayerIndex = this.players.findIndex((player) => player.role === PlayerRole.Lord);
    this.currentPlayerIndex = Math.max(0, this.currentPlayerIndex);
    this.turn = 1;
    this.phase = TurnPhase.Draw;
    this.winner = null;
    this.slashUsedThisTurn = false;
    this.slashPlayedThisTurn = false;
    this.wineBuffPlayerIds = new Set();
    this.wineUsedPlayerIds = new Set();
    this.skillUsedThisTurn = new Map();
    this.skillCountsThisTurn = new Map();
    this.skillFlagsThisTurn = new Map();
    this.responsePolicyByPlayer.clear();
    this.responseSelectionByPlayer.clear();
    this.optionalEffectDecisions.clear();

    const handCount = Math.min(6, Math.max(3, Math.floor(openingHandCount)));
    const logs = [`联机对局开始：${playerConfigs.length} 人局`, `初始手牌：每人 ${handCount} 张`];
    this.staged = true;
    this.pendingNextTurn = false;
    this.pendingTurnEndPlayer = null;
    for (const player of this.players) {
      const drawn = this.drawCards(player.id, handCount);
      logs.push(`${player.name}[${player.general}] 获得 ${drawn} 张手牌`);
    }
    if (startImmediately) logs.push(...(await this.startTurn()));
    return logs;
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
    if (this.winner !== null) {
      return [];
    }
    const player = this.mustGetPlayer(playerId);
    if (!player.alive || player.id !== this.currentPlayer.id || this.phase !== TurnPhase.Play) {
      return [];
    }
    const actions: GameAction[] = [];
    const canPlaySlash = this.canPlaySlashInTurn(player);

    player.hand.forEach((card, cardIndex) => {
      if (card.type === CardType.Dodge || card.type === CardType.Negate) {
        return;
      }
      if (this.isSlashCard(card.type) && !canPlaySlash) {
        return;
      }
      if (card.type === CardType.Peach && player.hp >= player.maxHp) {
        return;
      }
      if (card.type === CardType.Lightning && player.delayedTricks.some((t) => t.cardType === CardType.Lightning)) {
        return;
      }
      // 酒方法Ⅰ：每回合限用一次
      if (card.type === CardType.Wine && this.wineUsedPlayerIds.has(player.id)) {
        return;
      }
      const targets = this.findTargetsByCard(player.id, card.type);
      if (this.cardNeedsTarget(card.type) && targets.length === 0) {
        return;
      }
      actions.push({
        type: "play",
        cardIndex,
        label: `使用 ${card.type}`,
        requiresTarget: this.cardNeedsTarget(card.type),
        targets,
        // 顺手牵羊/过河拆桥结算时需要从目标处选一张牌，其他牌不需要
        needsTargetCard: card.type === CardType.Snatch || card.type === CardType.Dismantle,
      });
      // 铁索连环可重铸：弃置并摸一张
      if (card.type === CardType.IronChain) {
        actions.push({
          type: "play",
          cardIndex: -500 - cardIndex,
          label: `重铸 ${card.type}（弃置并摸1张牌）`,
          requiresTarget: false,
          targets: [],
          needsTargetCard: false,
        });
      }
    });
    if (canPlaySlash && this.hasSkill(player, SkillName.LongDan)) {
      player.hand.forEach((card, cardIndex) => {
        if (card.type !== CardType.Dodge) {
          return;
        }
        const targets = this.findTargetsByCard(player.id, CardType.Slash);
        if (targets.length === 0) {
          return;
        }
        actions.push({
          type: "play",
          cardIndex: -200 - cardIndex,
          label: `使用 龙胆（将${CardType.Dodge}当${CardType.Slash}）`,
          requiresTarget: true,
          targets,
        });
      });
    }
    if (canPlaySlash && this.hasSkill(player, SkillName.WuSheng)) {
      player.hand.forEach((card, cardIndex) => {
        if (this.isSlashCard(card.type) || card.color !== "red") {
          return;
        }
        const targets = this.findTargetsByCard(player.id, CardType.Slash);
        if (targets.length === 0) {
          return;
        }
        actions.push({
          type: "play",
          cardIndex: -400 - cardIndex,
          label: `使用 武圣（将红牌${card.type}当${CardType.Slash}）`,
          requiresTarget: true,
          targets,
        });
      });
    }
    if (this.hasSkill(player, SkillName.GuoSe)) {
      player.hand.forEach((card, cardIndex) => {
        if (card.suit !== "diamond") {
          return;
        }
        const targets = this.findTargetsByCard(player.id, CardType.Indulgence);
        if (targets.length === 0) {
          return;
        }
        actions.push({
          type: "play",
          cardIndex: -100 - cardIndex,
          label: `使用 国色（将方块牌${card.type}当${CardType.Indulgence}）`,
          requiresTarget: true,
          targets,
        });
      });
    }
    if (
      player.weapon === CardType.SerpentSpear &&
      player.hand.length >= 2 &&
      (!this.slashUsedThisTurn || getSkillRules(player).slashLimitExempt)
    ) {
      const targets = this.findTargetsByCard(player.id, CardType.Slash);
      if (targets.length > 0) {
        actions.push({
          type: "play",
          cardIndex: -1,
          label: "使用 丈八蛇矛（弃2张手牌当杀）",
          requiresTarget: true,
          targets,
        });
      }
    }
    if (player.treasure === CardType.WoodenOx) {
      if (player.hand.length > 0) {
        actions.push({
          type: "play",
          cardIndex: -11,
          label: `使用 ${CardType.WoodenOx}（置入1张手牌）`,
          requiresTarget: false,
          targets: [],
        });
      }
      const moveTargets = this.players
        .filter((item) => item.alive && item.id !== player.id)
        .map((item) => item.id);
      if (moveTargets.length > 0) {
        actions.push({
          type: "play",
          cardIndex: -12,
          label: `使用 ${CardType.WoodenOx}（移动给其他角色）`,
          requiresTarget: true,
          targets: moveTargets,
        });
      }
      player.treasureCards.forEach((card, index) => {
        // 木牛流马下的杀同样受每回合出杀次数限制
        if (this.isSlashCard(card.type) && !this.canPlaySlashInTurn(player)) {
          return;
        }
        const targets = this.findTargetsByCard(player.id, card.type);
        if (this.cardNeedsTarget(card.type) && targets.length === 0) {
          return;
        }
        actions.push({
          type: "play",
          cardIndex: -1000 - index,
          label: `使用 木牛流马下的 ${card.type}`,
          requiresTarget: this.cardNeedsTarget(card.type),
          targets,
          needsTargetCard: card.type === CardType.Snatch || card.type === CardType.Dismantle,
        });
      });
      // 取出：本回合刚置入的牌不能本回合就取出（防置入/取出无收益空转），跨回合取出不受影响
      if (player.treasureCards.some((card) => this.canTakeStoredCard(card))) {
        actions.push({
          type: "play",
          cardIndex: -13,
          label: `使用 ${CardType.WoodenOx}（取出1张牌）`,
          requiresTarget: false,
          targets: [],
        });
      }
    }

    if (this.canUseAssault(player)) {
      const targets = this.findTargetsByCard(player.id, CardType.Slash);
      if (targets.length > 0) {
        actions.push({
          type: "skill",
          skill: SkillName.Assault,
          label: `发动${SkillName.Assault}（弃1牌对1名角色造成1伤害）`,
          requiresTarget: true,
          targets,
        });
      }
    }
    if (this.canUseZhiHeng(player)) {
      actions.push({
        type: "skill",
        skill: SkillName.ZhiHeng,
        label: `发动${SkillName.ZhiHeng}（弃任意张并摸等量，限一次）`,
        requiresTarget: false,
        targets: [],
      });
    }
    if (this.canUseQingNang(player)) {
      const targets = this.players.filter((item) => item.alive && item.hp < item.maxHp).map((item) => item.id);
      if (targets.length > 0) {
        actions.push({
          type: "skill",
          skill: SkillName.QingNang,
          label: `发动${SkillName.QingNang}（弃1手牌令1名角色回复1点）`,
          requiresTarget: true,
          targets,
        });
      }
    }
    if (this.canUseKuRou(player)) {
      actions.push({
        type: "skill",
        skill: SkillName.KuRou,
        label: `发动${SkillName.KuRou}（失去1点体力并摸2张牌）`,
        requiresTarget: false,
        targets: [],
      });
    }
    if (this.canUseRenDe(player)) {
      const renDeTargets = this.players
        .filter((item) => item.alive && item.id !== player.id)
        .map((item) => item.id);
      if (renDeTargets.length > 0) {
        actions.push({
          type: "skill",
          skill: SkillName.RenDe,
          label: `发动${SkillName.RenDe}（将手牌交给1名角色，本回合累计给出2张回复1点）`,
          requiresTarget: true,
          targets: renDeTargets,
        });
      }
    }
    if (this.canUseFanJian(player)) {
      const targets = this.players.filter((item) => item.alive && item.id !== player.id).map((item) => item.id);
      if (targets.length > 0) {
        actions.push({
          type: "skill",
          skill: SkillName.FanJian,
          label: `发动${SkillName.FanJian}（令目标声明花色并获得一张手牌）`,
          requiresTarget: true,
          targets,
        });
      }
    }

    if (this.canUseZhiBa(player)) {
      const lord = this.getLordWithZhiBa();
      if (lord && lord.id !== player.id && lord.hand.length > 0 && player.hand.length > 0) {
        actions.push({
          type: "skill",
          skill: SkillName.ZhiBa,
          label: `发动${SkillName.ZhiBa}（与主公拼点，未赢则主公得两张拼点牌）`,
          requiresTarget: false,
          targets: [lord.id],
        });
      }
    }
    if (this.canUseLiJian(player)) {
      const maleTargets = this.players
        .filter((p) => p.alive && p.gender === "男")
        .map((p) => p.id);
      if (maleTargets.length >= 2) {
        actions.push({
          type: "skill",
          skill: SkillName.LiJian,
          label: `发动${SkillName.LiJian}（弃1牌令两名男性角色决斗）`,
          requiresTarget: true,
          targets: maleTargets,
        });
      }
    }
    if (this.canUseJieYin(player)) {
      const maleWounded = this.players
        .filter((p) => p.alive && p.gender === "男" && p.id !== player.id && p.hp < p.maxHp)
        .map((p) => p.id);
      if (player.hand.length >= 2 && maleWounded.length > 0) {
        actions.push({
          type: "skill",
          skill: SkillName.JieYin,
          label: `发动${SkillName.JieYin}（弃2牌令自己与一名男性角色各回复1点体力）`,
          requiresTarget: true,
          targets: maleWounded,
        });
      }
    }
    // 外部武将包主动技能（阶段 2）：按玩家已拥有的命名空间技能 id 枚举。
    const packCtx = this as unknown as SkillModuleCtx;
    for (const entry of getPackSkills()) {
      if (entry.kind !== "active" || !player.skills.includes(entry.id)) {
        continue;
      }
      if (entry.canUse && !entry.canUse(packCtx, player)) {
        continue;
      }
      const requiresTarget = entry.requiresTarget ?? false;
      const targets = requiresTarget ? (entry.getTargets?.(packCtx, player) ?? []) : [];
      if (requiresTarget && targets.length === 0) {
        continue;
      }
      actions.push({
        type: "skill",
        skill: entry.id,
        label: entry.label ?? `发动${entry.displayName}`,
        requiresTarget,
        targets,
      });
    }
    this.appendConversionActions(player, actions, canPlaySlash);
    actions.push({ type: "end", label: "结束出牌阶段" });
    return actions;
  }

  /**
   * 外部武将包 `conversion`（当牌转换，Phase 7）的可玩动作枚举。
   *
   * 约定 `cardIndex = -10000 - 手牌下标`（避开内置已占用的 -100/-200/-400/-500/-1000 与 -1/-11/-12/-13），
   * 并用 `convertVia`/`convertTo` 标明"通过哪个技能、当成哪张牌"，`playAction` 据此复算，不信任客户端。
   * 只枚举引擎结算得了的牌类：杀/火杀/雷杀（需要目标）与桃（自己体力未满）。
   * 闪/无懈可击是响应牌，不进可玩动作列表（走 `provide_response`）。
   */
  private appendConversionActions(player: Player, actions: GameAction[], canPlaySlash: boolean): void {
    for (const { skillId, conversion } of this.playerConversions(player)) {
      const isSlashLike = this.isSlashCard(conversion.to);
      if (isSlashLike && !canPlaySlash) {
        continue;
      }
      if (conversion.to === CardType.Peach && player.hp >= player.maxHp) {
        continue;
      }
      if (!isSlashLike && conversion.to !== CardType.Peach) {
        continue;
      }
      const displayName = resolveSkillDescriptor(skillId).displayName ?? skillId;
      const targets = isSlashLike ? this.findTargetsByCard(player.id, conversion.to) : [];
      if (isSlashLike && targets.length === 0) {
        continue;
      }
      player.hand.forEach((card, cardIndex) => {
        if (!matchesConversionFilter(card, conversion.from)) {
          return;
        }
        actions.push({
          type: "play",
          cardIndex: -10000 - cardIndex,
          label: `发动${displayName}：将${describeCard(card)}当${conversion.to}${isSlashLike ? "使用" : "对自己使用"}`,
          requiresTarget: isSlashLike,
          targets,
          convertVia: skillId,
          convertTo: conversion.to,
        });
      });
    }
  }

  /** 该玩家拥有的全部当牌转换（外部包声明式 `conversions`；内置技能不走这里）。 */
  private playerConversions(player: Player): { skillId: SkillId; conversion: SkillConversion }[] {
    const result: { skillId: SkillId; conversion: SkillConversion }[] = [];
    for (const skillId of new Set(player.skills)) {
      for (const conversion of resolveSkillDescriptor(skillId).conversions ?? []) {
        result.push({ skillId, conversion });
      }
    }
    return result;
  }

  /** 该玩家能否用某种转换作为 `kind` 响应打出（`asResponse` 命中且源牌匹配）。 */
  private responseConversions(player: Player, kind: ResponseKind): { skillId: SkillId; conversion: SkillConversion }[] {
    return this.playerConversions(player).filter(
      (entry) => (entry.conversion.asResponse ?? []).includes(kind) && responseKindToCardType(kind) === entry.conversion.to,
    );
  }

  /**
   * 当牌转换在**出牌阶段**的结算（`playAction` 的 `cardIndex <= -10000` 分支）。
   * 复算全部条件：技能归属、转换声明、源牌是否满足 `from`、杀次数、目标合法性。
   */
  private async resolveConversionUse(
    player: Player,
    handIndex: number,
    viaSkillId: SkillId | undefined,
    convertTo: CardType | undefined,
    targetId: string | undefined,
  ): Promise<string[]> {
    const card = player.hand[handIndex];
    if (!card || !viaSkillId || !convertTo) {
      return ["使用卡牌失败"];
    }
    // 同一技能可声明多条相同 `to`、不同 `from` 的转换：必须找到"源牌也匹配"的那一条，
    // 不能只按 skillId+to 取第一条（否则合法牌会被误拒）。
    const conversion = this.playerConversions(player).find(
      (entry) =>
        entry.skillId === viaSkillId &&
        entry.conversion.to === convertTo &&
        matchesConversionFilter(card, entry.conversion.from),
    )?.conversion;
    if (!conversion) {
      return ["使用卡牌失败"];
    }
    const displayName = resolveSkillDescriptor(viaSkillId).displayName ?? viaSkillId;
    const isSlashLike = this.isSlashCard(conversion.to);
    if (!isSlashLike && conversion.to !== CardType.Peach) {
      return [`${conversion.to}不能这样使用`];
    }
    if (conversion.to === CardType.Peach && player.hp >= player.maxHp) {
      return [`${player.name} 当前体力已满`];
    }
    let target: Player | null = null;
    if (isSlashLike) {
      if (this.slashUsedThisTurn && !getSkillRules(player).slashLimitExempt && player.weapon !== CardType.Crossbow) {
        return [`${player.name} 本回合已使用过杀`];
      }
      if (!targetId) {
        return ["需要选择目标"];
      }
      const candidate = this.mustGetPlayer(targetId);
      if (
        !candidate.alive ||
        candidate.id === player.id ||
        !this.canReachForSlash(player, candidate) ||
        this.isKongChengProtected(candidate, conversion.to)
      ) {
        return ["目标无效"];
      }
      target = candidate;
    }
    const used = await this.removeHandCardAt(player, handIndex);
    if (!used) {
      return ["使用卡牌失败"];
    }
    this.discardPile.push(used);
    const logs = [`${player.name} 发动${displayName}，将${describeCard(used)}当${conversion.to}使用`];
    if (isSlashLike && target) {
      if (!getSkillRules(player).slashLimitExempt) {
        this.slashUsedThisTurn = true;
      }
      logs.push(...(await this.useSlash(player, target, { kind: slashKindOf(player, conversion.to), card: used })));
      return logs;
    }
    player.hp = Math.min(player.maxHp, player.hp + 1);
    logs.push(`${player.name} 回复 1 点体力`);
    logs.push(...(await this.resolveDeaths()));
    logs.push(...this.resolveWinner());
    await this.advanceIfCurrentPlayerDead(logs);
    return logs;
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
    this.discardPile.push(removed);
    const logs = [`${player.name} 弃置了 ${removed.type}`];
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
    if (this.winner !== null) {
      return [];
    }
    if (action.type === "end") {
      return this.endPlayPhase(playerId);
    }
    if (action.type === "skill") {
      return this.useSkillAction(playerId, action, targetId);
    }
    const player = this.mustGetPlayer(playerId);
    if (!player.alive || player.id !== this.currentPlayer.id || this.phase !== TurnPhase.Play) {
      return [];
    }
    if (action.cardIndex <= -10000) {
      // 外部武将包当牌转换（Phase 7）：cardIndex = -10000 - 手牌下标。
      // **必须排在所有内置负下标分支之前**（`<= -1000` 是木牛流马，否则会被它先吃掉）。
      // 不信任客户端：convertVia/convertTo 与源牌都由 resolveConversionUse 复算。
      return this.resolveConversionUse(player, -10000 - action.cardIndex, action.convertVia, action.convertTo, targetId);
    }
    if (action.cardIndex <= -100 && action.cardIndex > -200) {
      const index = -100 - action.cardIndex;
      const converted = player.hand[index];
      if (!converted || converted.suit !== "diamond" || !this.hasSkill(player, SkillName.GuoSe)) {
        return ["使用卡牌失败"];
      }
      if (!targetId) {
        return ["需要选择目标"];
      }
      const target = this.mustGetPlayer(targetId);
      if (!target.alive || target.id === player.id) {
        return ["目标无效"];
      }
      if (target.delayedTricks.some((t) => t.cardType === CardType.Indulgence)) {
        return ["目标判定区已有乐不思蜀"];
      }
      const used = await this.removeHandCardAt(player, index);
      if (!used) {
        return ["使用卡牌失败"];
      }
      this.discardPile.push(used);
      const convertedCard = this.createCard(CardType.Indulgence, `guose-${this.turn}`);
      const logs = [`${player.name} 发动${SkillName.GuoSe}，将方块牌 ${used.type} 当${CardType.Indulgence}使用`];
      logs.push(...(await this.resolveDelayedTrick(player, convertedCard, target.id)));
      logs.push(...(await this.resolveDeaths()));
      logs.push(...this.resolveWinner());
      await this.advanceIfCurrentPlayerDead(logs);
      return logs;
    }
    if (action.cardIndex <= -200 && action.cardIndex > -400) {
      const index = -200 - action.cardIndex;
      const converted = player.hand[index];
      if (!converted || converted.type !== CardType.Dodge || !this.hasSkill(player, SkillName.LongDan)) {
        return ["使用卡牌失败"];
      }
      if (!this.canPlaySlashInTurn(player)) {
        return [`${player.name} 本回合已使用过杀`];
      }
      if (!targetId) {
        return ["需要选择目标"];
      }
      const target = this.mustGetPlayer(targetId);
      if (
        !target.alive ||
        target.id === player.id ||
        !this.canReachForSlash(player, target) ||
        this.isKongChengProtected(target, CardType.Slash)
      ) {
        return ["目标无效"];
      }
      const used = await this.removeHandCardAt(player, index);
      if (!used) {
        return ["使用卡牌失败"];
      }
      this.discardPile.push(used);
      this.slashUsedThisTurn = true;
      const logs = [`${player.name} 发动${SkillName.LongDan}，将${CardType.Dodge}当${CardType.Slash}使用`];
      logs.push(...(await this.resolveSlash(player, target, false, slashKindOf(player, used.type), used)));
      logs.push(...(await this.resolveDeaths()));
      logs.push(...this.resolveWinner());
      await this.advanceIfCurrentPlayerDead(logs);
      return logs;
    }
    if (action.cardIndex <= -500 && action.cardIndex > -1000) {
      // 铁索连环重铸：弃置此牌并摸一张
      const index = -500 - action.cardIndex;
      const card = player.hand[index];
      if (!card || card.type !== CardType.IronChain) {
        return [`${player.name} 当前无法重铸${CardType.IronChain}`];
      }
      const removed = await this.removeHandCardAt(player, index);
      if (!removed) {
        return ["使用卡牌失败"];
      }
      this.discardPile.push(removed);
      const drawn = this.drawCards(player.id, 1);
      const logs = [`${player.name} 重铸${CardType.IronChain}，摸了 ${drawn} 张牌`];
      logs.push(...(await this.resolveDeaths()));
      logs.push(...this.resolveWinner());
      await this.advanceIfCurrentPlayerDead(logs);
      return logs;
    }
    if (action.cardIndex <= -400 && action.cardIndex > -1000) {
      const index = -400 - action.cardIndex;
      const converted = player.hand[index];
      if (!converted || converted.type === CardType.Slash || converted.color !== "red" || !this.hasSkill(player, SkillName.WuSheng)) {
        return ["使用卡牌失败"];
      }
      if (!this.canPlaySlashInTurn(player)) {
        return [`${player.name} 本回合已使用过杀`];
      }
      if (!targetId) {
        return ["需要选择目标"];
      }
      const target = this.mustGetPlayer(targetId);
      if (
        !target.alive ||
        target.id === player.id ||
        !this.canReachForSlash(player, target) ||
        this.isKongChengProtected(target, CardType.Slash)
      ) {
        return ["目标无效"];
      }
      const used = await this.removeHandCardAt(player, index);
      if (!used) {
        return ["使用卡牌失败"];
      }
      this.discardPile.push(used);
      this.slashUsedThisTurn = true;
      const logs = [`${player.name} 发动${SkillName.WuSheng}，将红色${used.type}当${CardType.Slash}使用`];
      logs.push(...(await this.resolveSlash(player, target, false, slashKindOf(player, used.type), used)));
      logs.push(...(await this.resolveDeaths()));
      logs.push(...this.resolveWinner());
      await this.advanceIfCurrentPlayerDead(logs);
      return logs;
    }
    if (action.cardIndex === -11) {
      if (player.treasure !== CardType.WoodenOx || player.hand.length === 0) {
        return [`${player.name} 当前无法发动${CardType.WoodenOx}`];
      }
      const handSources = this.buildUsableSources(player).filter((source) => source.origin === "hand");
      const [moved] = await this.requestDiscardSelection(player, 1, "木牛流马：选择1张手牌置于其下", handSources);
      if (!moved) {
        return [`${player.name} 当前无法发动${CardType.WoodenOx}`];
      }
      player.treasureCards.push(moved);
      this.oxStoredTurnMap().set(moved.id, this.turn);
      return [`${player.name} 将 ${moved.type} 置于${CardType.WoodenOx}下方`];
    }
    if (action.cardIndex === -13) {
      if (player.treasure !== CardType.WoodenOx || player.treasureCards.length === 0) {
        return [`${player.name} 当前无法从${CardType.WoodenOx}取牌`];
      }
      const oxSources = this.buildUsableSources(player).filter(
        (source) => source.origin === "treasure" && this.canTakeStoredCard(source.card),
      );
      const [taken] = await this.requestDiscardSelection(player, 1, "木牛流马：选择取出1张牌", oxSources);
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
      const target = this.mustGetPlayer(targetId);
      if (!target.alive || target.id === player.id) {
        return ["目标无效"];
      }
      const logs = [`${player.name} 将${CardType.WoodenOx}移动给${target.name}`];
      if (target.treasure !== null) {
        this.discardPile.push(this.createCard(target.treasure, `replace-${this.turn}`));
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
      if (preview && this.isSlashCard(preview.type) && !this.canPlaySlashInTurn(player)) {
        return [`${player.name} 本回合已使用过杀`];
      }
      const usedCard = player.treasureCards.splice(index, 1)[0];
      if (!usedCard) {
        return ["使用卡牌失败"];
      }
      return this.resolveUsedCard(player, usedCard, targetId, true, selectedCardId);
    }
    if (action.cardIndex === -1) {
      if (player.weapon !== CardType.SerpentSpear || player.hand.length < 2) {
        return [`${player.name} 当前无法发动丈八蛇矛`];
      }
      if (this.slashUsedThisTurn && !getSkillRules(player).slashLimitExempt) {
        return [`${player.name} 本回合已使用过杀`];
      }
      if (!targetId) {
        return ["需要选择目标"];
      }
      const target = this.mustGetPlayer(targetId);
      if (!target.alive || target.id === player.id || !this.canReachForSlash(player, target)) {
        return ["目标无效"];
      }
      const first = await this.removeHandCardAt(player, 0);
      const second = await this.removeHandCardAt(player, 0);
      if (!first || !second) {
        return [`${player.name} 手牌不足，无法发动丈八蛇矛`];
      }
      this.discardPile.push(first);
      this.discardPile.push(second);
      if (!getSkillRules(player).slashLimitExempt) {
        this.slashUsedThisTurn = true;
      }
      const logs = [
        `${player.name} 发动丈八蛇矛，弃置 ${first.type}、${second.type} 视为使用杀`,
        ...(await this.resolveSlash(player, target, true, slashKindOf(player, undefined))),
      ];
      return logs;
    }
    const card = player.hand[action.cardIndex];
    if (!card) {
      return [`${player.name} 选择了无效卡牌`];
    }
    if (
      this.isSlashCard(card.type) &&
      this.slashUsedThisTurn &&
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
    if (this.cardNeedsTarget(card.type)) {
      if (!targetId) {
        return ["需要选择目标"];
      }
      const target = this.mustGetPlayer(targetId);
      // 铁索连环是唯一可以指定**自己**的有目标牌（`findTargetsByCard` 就是按"含自己"枚举的，
      // 官方规则同样允许"横置/重置一名角色，包括你自己"）。此前这里一律拒绝自己，
      // 导致 UI/AI 能选到一个 playAction 必然拒绝的目标 → 联机实测出现"目标无效"死循环。
      if (!target.alive || (target.id === player.id && card.type !== CardType.IronChain)) {
        return ["目标无效"];
      }
      if ((this.isSlashCard(card.type) || card.type === CardType.Duel) && this.isKongChengProtected(target, card.type)) {
        return [`${target.name} 的${SkillName.KongCheng}生效，无法成为目标`];
      }
      if (this.isSlashCard(card.type) && !this.canReachForSlash(player, target)) {
        return ["目标超出攻击范围"];
      }
      if (isDistanceOneTrickCard(card.type) && !this.canReachForDistanceOneTrick(player, target)) {
        return [`目标超出距离，${card.type}只能对距离 1 以内的角色使用`];
      }
    }

    const usedCard = await this.removeHandCardAt(player, action.cardIndex);
    if (!usedCard) {
      return ["使用卡牌失败"];
    }
    return this.resolveUsedCard(player, usedCard, targetId, false, selectedCardId);
  }

  /**
   * 全体/无指向锦囊的无懈可击询问（无中生有/桃园结义/五谷丰登）：
   * 统一走 `resolve.ts` 的 `tryNegateGlobal`（与闪电自贴同口径）。
   */
  private async tryNegateGlobal(user: Player, trickType: CardType, logs: string[]): Promise<boolean> {
    return tryNegateGlobalImpl(this as unknown as ResolveContext, user, trickType, logs);
  }

  private async resolveUsedCard(
    player: Player,
    usedCard: Card,
    targetId: string | undefined,
    fromTreasure: boolean,
    selectedCardId?: string,
  ): Promise<string[]> {
    this.discardPile.push(usedCard);
    const logs: string[] = [];
    // 拦截点 card_used：使用一张牌时（结算前）通知，reason="使用"。
    await this.emitSkillTrigger("card_used", { actor: player, card: usedCard, reason: "使用" }, logs);
    if (fromTreasure) {
      logs.push(`${player.name} 从${CardType.WoodenOx}下使用了 ${usedCard.type}`);
    }
    if (this.hasSkill(player, SkillName.JiZhi) && await this.shouldActivateOptionalEffect(player, SkillName.JiZhi) && this.isNonDelayedTrickCard(usedCard.type)) {
      const drawn = this.drawCards(player.id, 1);
      logs.push(`${player.name} 的${SkillName.JiZhi}生效，摸了 ${drawn} 张牌`);
    }
    if (this.isSlashCard(usedCard.type) && targetId) {
      if (!getSkillRules(player).slashLimitExempt) {
        this.slashUsedThisTurn = true;
      }
      const slashTargets = await this.expandSlashTargets(player, this.mustGetPlayer(targetId), player.hand.length === 0);
      for (const slashTarget of slashTargets) {
        logs.push(...(await this.resolveSlash(player, slashTarget, false, slashKindOf(player, usedCard.type), usedCard)));
      }
    } else if (usedCard.type === CardType.Peach) {
      player.hp = Math.min(player.maxHp, player.hp + 1);
      logs.push(`${player.name} 使用桃，回复 1 点体力`);
    } else if (usedCard.type === CardType.Wine) {
      // 方法Ⅰ：出牌阶段对自己使用，本回合下一张杀伤害+1（每回合限一次，由可玩动作列表保证）
      this.wineUsedPlayerIds.add(player.id);
      this.wineBuffPlayerIds.add(player.id);
      logs.push(`${player.name} 使用酒，本回合下一张杀伤害+1`);
    } else if (usedCard.type === CardType.Dismantle && targetId) {
      logs.push(...(await this.resolveDismantle(player, this.mustGetPlayer(targetId), selectedCardId)));
    } else if (usedCard.type === CardType.Snatch && targetId) {
      logs.push(...(await this.resolveSnatch(player, this.mustGetPlayer(targetId), selectedCardId)));
    } else if (usedCard.type === CardType.Duel && targetId) {
      logs.push(...(await this.resolveDuel(player, this.mustGetPlayer(targetId), usedCard)));
    } else if (usedCard.type === CardType.ExNihilo) {
      if (await this.tryNegateGlobal(player, usedCard.type, logs)) {
        logs.push(`${player.name} 的${usedCard.type}被无懈可击抵消`);
      } else {
        const drawn = this.drawCards(player.id, 2);
        logs.push(`${player.name} 使用无中生有，摸了 ${drawn} 张牌`);
      }
    } else if (usedCard.type === CardType.Barbarian) {
      logs.push(...(await this.resolveBarbarian(player, usedCard)));
    } else if (usedCard.type === CardType.ArrowRain) {
      logs.push(...(await this.resolveArrowRain(player, usedCard)));
    } else if (usedCard.type === CardType.FireAttack && targetId) {
      logs.push(...(await this.resolveFireAttack(player, this.mustGetPlayer(targetId), usedCard)));
    } else if (usedCard.type === CardType.IronChain && targetId) {
      logs.push(...(await this.resolveIronChain(player, this.mustGetPlayer(targetId))));
    } else if (usedCard.type === CardType.Collateral && targetId) {
      logs.push(...(await this.resolveCollateral(player, this.mustGetPlayer(targetId))));
    } else if (usedCard.type === CardType.PeachGarden) {
      if (await this.tryNegateGlobal(player, usedCard.type, logs)) {
        logs.push(`${player.name} 的${usedCard.type}被无懈可击抵消`);
      } else {
        logs.push(...this.resolvePeachGarden(player));
      }
    } else if (usedCard.type === CardType.Harvest) {
      if (await this.tryNegateGlobal(player, usedCard.type, logs)) {
        logs.push(`${player.name} 的${usedCard.type}被无懈可击抵消`);
      } else {
        logs.push(...this.resolveHarvest(player));
      }
    } else if (usedCard.type === CardType.Lightning) {
      logs.push(...(await this.resolveDelayedTrick(player, usedCard, player.id)));
    } else if (this.isDelayedTrickCard(usedCard.type) && targetId) {
      logs.push(...(await this.resolveDelayedTrick(player, usedCard, targetId)));
    } else if (this.isEquipCard(usedCard.type)) {
      logs.push(...(await this.resolveEquip(player, usedCard.type)));
    }
    logs.push(...(await this.resolveDeaths()));
    logs.push(...this.resolveWinner());
    await this.advanceIfCurrentPlayerDead(logs);
    return logs;
  }

  async runAITurn(): Promise<string[]> {
    if (this.winner !== null || !this.currentPlayer.isAI || !this.currentPlayer.alive) {
      return [];
    }
    const logs: string[] = [];
    this.beginAiTurnProgress();
    while (true) {
      const ai = this.currentPlayer;
      const actions = this.getPlayableActions(ai.id);
      const best = pickBestAiAction(this as unknown as AiHeuristicsContext, actions, ai.id);
      if (!best || best.type === "end") {
        logs.push(...(await this.endPlayPhase(ai.id)));
        return logs;
      }
      const targetId = best.requiresTarget ? pickBestTarget(this as unknown as AiHeuristicsContext, best.targets) : undefined;
      logs.push(...(await this.playAction(ai.id, best, targetId)));
      if (this.winner !== null) {
        return logs;
      }
      // 兜底：决策器零收益打转（局面重复出现）时强制结束，不再无限出牌
      if (this.noteAiTurnProgress()) {
        logs.push(`${ai.name} 的出牌陷入重复局面，强制结束出牌阶段`);
        logs.push(...(await this.endPlayPhase(ai.id)));
        return logs;
      }
    }
  }

  getBestAiDecision(playerId: string): { action: GameAction; targetId?: string } | null {
    const player = this.players.find((item) => item.id === playerId);
    if (!player || !player.alive || !player.isAI) {
      return null;
    }
    const actions = this.getPlayableActions(player.id);
    const best = pickBestAiAction(this as unknown as AiHeuristicsContext, actions, player.id);
    if (!best) {
      return null;
    }
    if (best.type === "end" || !best.requiresTarget) {
      return { action: best };
    }
    const targetId = pickBestTarget(this as unknown as AiHeuristicsContext, best.targets);
    return targetId ? { action: best, targetId } : { action: best };
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
    const playerId =
      request.kind === "respond" ? request.responderId : request.kind === "collateral" ? request.targetId : request.playerId;
    const target = this.players.find((player) => player.id === playerId);
    if (target && !target.alive) {
      return this.autoDecisionForDeadPlayer(request);
    }
    const handler = this.decisionHandlers.get(playerId);
    if (handler) {
      try {
        const decision = await handler(request);
        if (decision) {
          return decision;
        }
      } catch {
        // 处理器异常时回退自动决策，避免结算中断
      }
    }
    return this.autoDecision(request);
  }

  private autoDecisionForDeadPlayer(request: InteractionRequest): InteractionDecision {
    if (
      request.kind === "optional-effect" ||
      request.kind === "respond" ||
      request.kind === "collateral"
    ) {
      return { choice: "pass" };
    }
    if (request.kind === "choose-discard") {
      return request.sources[0] ? { choice: "pass" } : { choice: "card", sourceId: "" };
    }
    if (request.kind === "choose-suit") {
      return { choice: "suit", suit: request.suits[0] ?? "heart" };
    }
    return { choice: "pass" };
  }

  private autoDecision(request: InteractionRequest): InteractionDecision {
    if (request.kind === "optional-effect") {
      return { choice: "effect", enabled: false };
    }
    if (request.kind === "collateral") {
      const victim = request.victims[0];
      if (victim) {
        const firstSlash = request.sources[0];
        return firstSlash
          ? { choice: "target", targetId: victim, sourceId: firstSlash.sourceId }
          : { choice: "target", targetId: victim };
      }
      return { choice: "pass" };
    }
    if (request.kind === "choose-discard") {
      const first = request.sources[0];
      if (first) {
        return { choice: "card", sourceId: first.sourceId };
      }
      return { choice: "pass" };
    }
    if (request.kind === "choose-suit") {
      const suit = request.suits[this.randomIndex(request.suits.length)] ?? "heart";
      return { choice: "suit", suit };
    }
    const first = request.sources[0];
    if (first) {
      return { choice: "card", sourceId: first.sourceId };
    }
    return { choice: "pass" };
  }

  /**
   * "弃置任意张牌"（制衡等）的可选范围：手牌 + 木牛流马内存牌 + 装备区。
   * 装备区用 `equip:<槽位>` 作为 sourceId，客户端只回传 sourceId，因此不需要协议变更。
   */
  private buildAnyDiscardSources(player: Player): Array<CardSource & { card: Card }> {
    const sources = [...this.buildUsableSources(player)];
    const equipSource = (slot: string, label: string, type: CardType | null): void => {
      if (type === null) {
        return;
      }
      sources.push({
        sourceId: `equip:${slot}`,
        origin: "equip",
        card: createCardImpl(this as unknown as ResolveContext, type, `equip-${slot}-${this.turn}`),
        label: `${label} ${type}`,
      });
    };
    equipSource("weapon", "武器", player.weapon);
    equipSource("armor", "防具", player.armor);
    equipSource("defenseHorse", "+1马", player.defenseHorse);
    equipSource("attackHorse", "-1马", player.attackHorse);
    equipSource("treasure", "宝物", player.treasure);
    return sources;
  }

  private takeEquipSlot(player: Player, slot: string): EquipCardType | null {
    if (slot === "weapon" && player.weapon !== null) {
      const type = player.weapon;
      player.weapon = null;
      return type;
    }
    if (slot === "armor" && player.armor !== null) {
      const type = player.armor;
      player.armor = null;
      return type;
    }
    if (slot === "defenseHorse" && player.defenseHorse !== null) {
      const type = player.defenseHorse;
      player.defenseHorse = null;
      return type;
    }
    if (slot === "attackHorse" && player.attackHorse !== null) {
      const type = player.attackHorse;
      player.attackHorse = null;
      return type;
    }
    if (slot === "treasure" && player.treasure !== null) {
      const type = player.treasure;
      player.treasure = null;
      return type;
    }
    return null;
  }

  /**
   * 逐张询问"要弃哪张"，直到玩家放弃或已无牌可弃；返回实际弃置张数。
   * 复用现有 choose-discard 请求（allowPass=true），CLI / WebUI / Go 客户端均已支持放弃选项。
   */
  private async requestFlexibleDiscard(player: Player, reason: string, logs: string[]): Promise<number> {
    const maxCount = this.buildAnyDiscardSources(player).length;
    let discarded = 0;
    while (discarded < maxCount) {
      const sources = this.buildAnyDiscardSources(player);
      if (sources.length === 0) {
        break;
      }
      const decision = await this.decide({
        kind: "choose-discard",
        requestId: this.nextInteractionId(),
        playerId: player.id,
        reason: `${reason}（已选 ${discarded} 张，可放弃）`,
        sources,
        count: 1,
        allowPass: true,
      });
      if (decision.choice !== "card") {
        break;
      }
      const sourceId = decision.sourceId;
      if (sourceId.startsWith("equip:")) {
        const removed = this.takeEquipSlot(player, sourceId.slice("equip:".length));
        if (removed === null) {
          break;
        }
        this.discardPile.push(createCardImpl(this as unknown as ResolveContext, removed, `discard-${this.turn}`));
        if (removed === CardType.WoodenOx) {
          discardWoodenOxStoredCardsImpl(this as unknown as ResolveContext, player, logs);
        }
        logs.push(`${player.name} 弃置装备 ${removed}`);
        // 弃置装备同样属于"失去装备"，枭姬/白银狮子等技能应正常触发。
        logs.push(...(await onLoseEquipImpl(this as unknown as ResolveContext, player, removed)));
        discarded += 1;
        continue;
      }
      const card = await this.removeUsableCardBySourceId(player, sourceId);
      if (!card) {
        break;
      }
      this.discardPile.push(card);
      logs.push(`${player.name} 弃置 ${card.type}`);
      discarded += 1;
    }
    return discarded;
  }

  private buildUsableSources(player: Player): Array<CardSource & { card: Card }> {
    const sources: Array<CardSource & { card: Card }> = [];
    for (const card of player.hand) {
      sources.push({ sourceId: `hand:${card.id}`, origin: "hand", card, label: describeCard(card) });
    }
    for (const card of player.treasureCards) {
      sources.push({ sourceId: `treasure:${card.id}`, origin: "treasure", card, label: `${describeCard(card)}（木牛流马）` });
    }
    return sources;
  }

  private peekUsableCard(player: Player, sourceId: string): (CardSource & { card: Card }) | undefined {
    const separator = sourceId.indexOf(":");
    if (separator < 0) {
      return undefined;
    }
    const origin = sourceId.slice(0, separator);
    const cardId = sourceId.slice(separator + 1);
    const pool = origin === "treasure" ? player.treasureCards : origin === "hand" ? player.hand : null;
    if (!pool) {
      return undefined;
    }
    const card = pool.find((item) => item.id === cardId);
    if (!card) {
      return undefined;
    }
    return { sourceId, origin: origin as CardSource["origin"], card, label: card.type };
  }

  private async removeUsableCardBySourceId(player: Player, sourceId: string): Promise<Card | undefined> {
    const separator = sourceId.indexOf(":");
    if (separator < 0) {
      return undefined;
    }
    const origin = sourceId.slice(0, separator);
    const cardId = sourceId.slice(separator + 1);
    if (origin === "treasure") {
      const index = player.treasureCards.findIndex((item) => item.id === cardId);
      if (index < 0) {
        return undefined;
      }
      return player.treasureCards.splice(index, 1)[0];
    }
    if (origin === "hand") {
      const index = player.hand.findIndex((item) => item.id === cardId);
      if (index < 0) {
        return undefined;
      }
      return this.removeHandCardAt(player, index);
    }
    return undefined;
  }

  private buildDodgeSources(player: Player): CardSource[] {
    const all = this.buildUsableSources(player);
    const sources: CardSource[] = [];
    for (const source of all) {
      if (source.card.type === CardType.Dodge) {
        sources.push({ ...source, label: `打出${describeCard(source.card)}${source.origin === "treasure" ? "（木牛流马）" : ""}` });
      }
    }
    if (this.hasSkill(player, SkillName.QingGuo)) {
      for (const source of all) {
        if (source.card.color === "black" && source.card.type !== CardType.Dodge) {
          sources.push({ ...source, label: `${describeCard(source.card)}${SkillName.QingGuo}当${CardType.Dodge}` });
        }
      }
    }
    if (this.hasSkill(player, SkillName.LongDan)) {
      for (const source of all) {
        if (this.isSlashCard(source.card.type)) {
          sources.push({ ...source, label: `${describeCard(source.card)}${SkillName.LongDan}当${CardType.Dodge}` });
        }
      }
    }
    this.appendConversionSources(player, "dodge", sources);
    return sources;
  }

  private buildSlashSources(player: Player): CardSource[] {
    const all = this.buildUsableSources(player);
    const sources: CardSource[] = [];
    for (const source of all) {
      if (this.isSlashCard(source.card.type)) {
        sources.push({ ...source, label: `打出${describeCard(source.card)}${source.origin === "treasure" ? "（木牛流马）" : ""}` });
      }
    }
    if (this.hasSkill(player, SkillName.WuSheng)) {
      for (const source of all) {
        if (source.card.color === "red" && !this.isSlashCard(source.card.type)) {
          sources.push({ ...source, label: `${describeCard(source.card)}${SkillName.WuSheng}当${CardType.Slash}` });
        }
      }
    }
    if (this.hasSkill(player, SkillName.LongDan)) {
      for (const source of all) {
        if (source.card.type === CardType.Dodge) {
          sources.push({ ...source, label: `${describeCard(source.card)}${SkillName.LongDan}当${CardType.Slash}` });
        }
      }
    }
    this.appendConversionSources(player, "slash", sources);
    return sources;
  }

  /**
   * 外部武将包 `conversion.asResponse`（Phase 7）的响应来源：把满足 `from` 的牌标成"可当 `kind` 打出"。
   * `viaSkill`/`asType` 是给 `consumeResponseCard` 的凭据——只有带标记的来源才允许"非直接牌类"响应。
   */
  private appendConversionSources(player: Player, kind: ResponseKind, sources: CardSource[]): void {
    const conversions = this.responseConversions(player, kind);
    if (conversions.length === 0) {
      return;
    }
    const direct = responseKindToCardType(kind);
    const all = this.buildUsableSources(player);
    for (const { skillId, conversion } of conversions) {
      const displayName = resolveSkillDescriptor(skillId).displayName ?? skillId;
      for (const source of all) {
        if (source.card.type === direct) {
          continue;
        }
        if (!matchesConversionFilter(source.card, conversion.from)) {
          continue;
        }
        sources.push({
          ...source,
          label: `${describeCard(source.card)}${displayName}当${conversion.to}`,
          viaSkill: skillId,
          asType: conversion.to,
        });
      }
    }
  }

  private buildNegateSources(player: Player): CardSource[] {
    const sources = this.buildUsableSources(player)
      .filter((source) => source.card.type === CardType.Negate)
      .map((source) => ({ ...source, label: `打出${describeCard(source.card)}${source.origin === "treasure" ? "（木牛流马）" : ""}` }));
    this.appendConversionSources(player, "negate", sources);
    return sources;
  }

  private buildPeachSources(player: Player, selfRescue = false): CardSource[] {
    const all = this.buildUsableSources(player);
    const sources: CardSource[] = [];
    for (const source of all) {
      if (source.card.type === CardType.Peach) {
        sources.push({ ...source, label: `使用${describeCard(source.card)}${source.origin === "treasure" ? "（木牛流马）" : ""}` });
      }
    }
    if (selfRescue) {
      // 酒方法Ⅱ：濒死时可将酒当桃对自己使用（仅自救）
      for (const source of all) {
        if (source.card.type === CardType.Wine) {
          sources.push({ ...source, label: `使用${describeCard(source.card)}自救（当${CardType.Peach}）` });
        }
      }
    }
    if (this.hasSkill(player, SkillName.JiJiu) && player.id !== this.currentPlayer.id) {
      for (const source of all) {
        if (source.card.color === "red" && source.card.type !== CardType.Peach) {
          sources.push({ ...source, label: `${describeCard(source.card)}${SkillName.JiJiu}当${CardType.Peach}` });
        }
      }
    }
    this.appendConversionSources(player, "peach", sources);
    return sources;
  }

  private buildResponseSources(player: Player, kind: ResponseKind, selfRescue = false): CardSource[] {
    if (kind === "dodge") return this.buildDodgeSources(player);
    if (kind === "slash") return this.buildSlashSources(player);
    if (kind === "negate") return this.buildNegateSources(player);
    return this.buildPeachSources(player, selfRescue);
  }

  private async consumeResponseCard(player: Player, kind: ResponseKind, sourceId: string, logs: string[]): Promise<boolean> {
    const source = this.peekUsableCard(player, sourceId);
    if (!source) {
      return false;
    }
    const card = source.card;
    // 酒方法Ⅱ：濒死者本人可将酒当桃使用（仅自救，他人救援只能用桃）
    const wineAsPeach = kind === "peach" && card.type === CardType.Wine && player.hp <= 0;
    const direct =
      kind === "dodge"
        ? card.type === CardType.Dodge
        : kind === "slash"
          ? this.isSlashCard(card.type)
          : kind === "negate"
            ? card.type === CardType.Negate
            : card.type === CardType.Peach || wineAsPeach;
    if (!direct) {
      // 声明式 conversions（`viaSkill` 凭据）与内置转换技各自的"当 X"判定。
      // 凭据只在来源列表里（`peekUsableCard` 只回 {card}），所以这里按 sourceId 回查一次候选来源；
      // 再以技能的真实声明复算 `from`，让伪造的 sourceId 无法蒙过去。
      const candidate = this.buildResponseSources(player, kind, kind === "peach" && player.hp <= 0).find(
        (entry) => entry.sourceId === sourceId && entry.viaSkill,
      );
      const viaConversion = candidate
        ? this.responseConversions(player, kind).find(
            (entry) => entry.skillId === candidate.viaSkill && matchesConversionFilter(card, entry.conversion.from),
          )
        : undefined;
      const convertedLabel = viaConversion
        ? `${resolveSkillDescriptor(viaConversion.skillId).displayName ?? viaConversion.skillId}当${viaConversion.conversion.to}`
        : kind === "dodge" && card.color === "black" && this.hasSkill(player, SkillName.QingGuo)
          ? `${SkillName.QingGuo}当${CardType.Dodge}`
          : kind === "dodge" && this.isSlashCard(card.type) && this.hasSkill(player, SkillName.LongDan)
            ? `${SkillName.LongDan}当${CardType.Dodge}`
            : kind === "slash" && card.color === "red" && this.hasSkill(player, SkillName.WuSheng)
              ? `${SkillName.WuSheng}当${CardType.Slash}`
              : kind === "slash" && card.type === CardType.Dodge && this.hasSkill(player, SkillName.LongDan)
                ? `${SkillName.LongDan}当${CardType.Slash}`
                : kind === "peach" && card.color === "red" && this.hasSkill(player, SkillName.JiJiu)
                  ? `${SkillName.JiJiu}当${CardType.Peach}`
                  : null;
      if (!convertedLabel) {
        return false;
      }
      logs.push(`${player.name} 发动${convertedLabel}（${card.type}）`);
    }
    const removed = await this.removeUsableCardBySourceId(player, sourceId);
    if (!removed) {
      return false;
    }
    this.discardPile.push(removed);
    // 本回合"打出"过杀（与出牌阶段"使用"杀分开计数，供克己等技能判定）。
    if (kind === "slash") {
      this.slashPlayedThisTurn = true;
    }
    // 拦截点 card_used：打出一张响应牌（reason="打出"）。
    await this.emitSkillTrigger("card_used", { actor: player, card: removed, reason: "打出" }, logs);
    if (wineAsPeach) {
      logs.push(`${player.name} 使用酒自救（当${CardType.Peach}）`);
    }
    return true;
  }

  private async requestCardResponse(
    player: Player,
    kind: ResponseKind,
    trigger: { cardName: string; actorId: string },
    logs: string[],
  ): Promise<boolean> {
    const policy = this.responsePolicyByPlayer.get(player.id);
    if (policy && policy[kind] === false) {
      this.setPlayerResponseSelection(player.id, kind, null);
      return false;
    }
    const selection = this.takePlayerResponseSelection(player.id, kind);
    if (selection) {
      return await this.consumeSelectedResponse(player, kind, selection, logs);
    }
    // 酒方法Ⅱ：濒死者本人可将酒当桃自救
    const selfRescue = kind === "peach" && trigger.actorId === player.id;
    const sources = this.buildResponseSources(player, kind, selfRescue);
    // 拦截点 provide_response（Phase 7）：在"没有任何来源 → 直接判为无法响应"**之前**发出，
    // 钩子可往 payload.responseSources 里 push 额外来源（代码技能的当牌转换）。
    const payload: SkillEventPayload = { actor: player, need: kind, responseSources: sources };
    await this.emitSkillTrigger("provide_response", payload, logs);
    const usable = payload.responseSources ?? sources;
    if (usable.length === 0) {
      return false;
    }
    const cardNames: Record<ResponseKind, string> = {
      dodge: CardType.Dodge,
      slash: CardType.Slash,
      negate: CardType.Negate,
      peach: CardType.Peach,
    };
    // 求桃时明确濒死者，救援者才知道要救谁
    let reason = `${trigger.cardName}：是否打出${cardNames[kind]}？`;
    if (kind === "peach") {
      const dying = this.players.find((item) => item.id === trigger.actorId);
      const dyingName = dying ? dying.name : "";
      reason = trigger.actorId === player.id
        ? `你濒死：是否打出${CardType.Peach}自救？`
        : `${dyingName}濒死：是否打出${CardType.Peach}救援？`;
    }
    const decision = await this.decide({
      kind: "respond",
      requestId: this.nextInteractionId(),
      responderId: player.id,
      trigger,
      responseKind: kind,
      sources: usable,
      allowPass: true,
      reason,
    });
    if (decision.choice !== "card") {
      return false;
    }
    return await this.consumeResponseCard(player, kind, decision.sourceId, logs);
  }

  private async requestDiscardSelection(player: Player, count: number, reason: string, providedSources?: CardSource[]): Promise<Card[]> {
    const picked: Card[] = [];
    for (let i = 0; i < count; i += 1) {
      const sources = providedSources ?? this.buildUsableSources(player);
      if (sources.length === 0) {
        break;
      }
      const decision = await this.decide({
        kind: "choose-discard",
        requestId: this.nextInteractionId(),
        playerId: player.id,
        reason: count > 1 ? `${reason}（第 ${i + 1}/${count} 张）` : reason,
        sources,
        count: 1,
        allowPass: false,
      });
      if (decision.choice !== "card") {
        break;
      }
      const card = await this.removeUsableCardBySourceId(player, decision.sourceId);
      if (!card) {
        break;
      }
      picked.push(card);
    }
    return picked;
  }

  private canPlayerRespond(playerId: string, kind: ResponseKind): boolean {
    const policy = this.responsePolicyByPlayer.get(playerId);
    if (!policy) {
      return true;
    }
    const allowed = policy[kind];
    return allowed !== false;
  }

  private async consumeSelectedResponse(player: Player, kind: ResponseKind, optionId: string, logs: string[]): Promise<boolean> {
    let cardId = optionId;
    if (optionId.startsWith("qingguo:") || optionId.startsWith("wusheng:") || optionId.startsWith("longdan:")) {
      cardId = optionId.slice(optionId.indexOf(":") + 1);
    }
    const handSourceId = `hand:${cardId}`;
    if (this.peekUsableCard(player, handSourceId)) {
      return await this.consumeResponseCard(player, kind, handSourceId, logs);
    }
    const treasureSourceId = `treasure:${cardId}`;
    if (this.peekUsableCard(player, treasureSourceId)) {
      return await this.consumeResponseCard(player, kind, treasureSourceId, logs);
    }
    return false;
  }

  private async consumePeachResponse(player: Player, dyingPlayerId: string, logs: string[]): Promise<boolean> {
    const targetedDecisions = this.peachDecisions.get(dyingPlayerId);
    if (targetedDecisions?.has(player.id)) {
      const optionId = targetedDecisions.get(player.id);
      if (optionId === null || optionId === undefined) return false;
      return await this.consumeSelectedResponse(player, "peach", optionId, logs);
    }
    if (!this.canPlayerRespond(player.id, "peach")) return false;
    return this.requestCardResponse(player, "peach", { cardName: CardType.Peach, actorId: dyingPlayerId }, logs);
  }

  private takePlayerResponseSelection(playerId: string, kind: ResponseKind): string | undefined {
    const selected = this.responseSelectionByPlayer.get(playerId);
    if (!selected) {
      return undefined;
    }
    const optionId = selected[kind];
    delete selected[kind];
    if (Object.keys(selected).length === 0) {
      this.responseSelectionByPlayer.delete(playerId);
    } else {
      this.responseSelectionByPlayer.set(playerId, selected);
    }
    return optionId;
  }

  setOptionalEffectDecision(playerId: string, effect: SkillName | CardType, enabled: boolean | null): void {
    const key = `${playerId}:${effect}`;
    if (enabled === null) this.optionalEffectDecisions.delete(key);
    else this.optionalEffectDecisions.set(key, enabled);
  }

  getPlayerResponseOptions(playerId: string, kind: ResponseKind): ResponseOption[] {
    const player = this.players.find((item) => item.id === playerId);
    if (!player || !player.alive) {
      return [];
    }
    if (kind === "negate" || kind === "peach") {
      const cardType = kind === "negate" ? CardType.Negate : CardType.Peach;
      return player.hand
        .filter((card) => card.type === cardType)
        .map((card) => ({ id: card.id, kind, label: `打出${cardType}` }));
    }
    if (kind === "dodge") {
      const direct = player.hand
        .filter((card) => card.type === CardType.Dodge)
        .map((card) => ({ id: card.id, kind, label: `打出${CardType.Dodge}` }));
      const qingGuo = this.hasSkill(player, SkillName.QingGuo)
        ? player.hand
            .filter((card) => card.color === "black" && card.type !== CardType.Dodge)
            .map((card) => ({ id: `qingguo:${card.id}`, kind, label: `${SkillName.QingGuo}当${CardType.Dodge}` }))
        : [];
      const longDan = this.hasSkill(player, SkillName.LongDan)
        ? player.hand
            .filter((card) => this.isSlashCard(card.type))
            .map((card) => ({ id: `longdan:${card.id}`, kind, label: `${SkillName.LongDan}当${CardType.Dodge}` }))
        : [];
      return [...direct, ...qingGuo, ...longDan];
    }
    const direct = player.hand
      .filter((card) => this.isSlashCard(card.type))
      .map((card) => ({ id: card.id, kind, label: `打出${card.type}` }));
    const wuSheng = this.hasSkill(player, SkillName.WuSheng)
      ? player.hand
          .filter((card) => card.color === "red" && !this.isSlashCard(card.type))
          .map((card) => ({ id: `wusheng:${card.id}`, kind, label: `${SkillName.WuSheng}当${CardType.Slash}` }))
      : [];
    const longDan = this.hasSkill(player, SkillName.LongDan)
      ? player.hand
          .filter((card) => card.type === CardType.Dodge)
          .map((card) => ({ id: `longdan:${card.id}`, kind, label: `${SkillName.LongDan}当${CardType.Slash}` }))
      : [];
    return [...direct, ...wuSheng, ...longDan];
  }

  setPlayerResponseSelection(playerId: string, kind: ResponseKind, optionId: string | null): void {
    if (optionId === null) {
      const existed = this.responseSelectionByPlayer.get(playerId);
      if (!existed) {
        return;
      }
      delete existed[kind];
      if (Object.keys(existed).length === 0) {
        this.responseSelectionByPlayer.delete(playerId);
      }
      return;
    }
    const existed = this.responseSelectionByPlayer.get(playerId) ?? {};
    existed[kind] = optionId;
    this.responseSelectionByPlayer.set(playerId, existed);
  }

  setPeachDecision(dyingPlayerId: string, rescuerId: string, optionId: string | null): void {
    const decisions = this.peachDecisions.get(dyingPlayerId) ?? new Map<string, string | null>();
    decisions.set(rescuerId, optionId);
    this.peachDecisions.set(dyingPlayerId, decisions);
  }

  clearPeachDecisions(): void {
    this.peachDecisions.clear();
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
    if (this.winner !== null) {
      return [];
    }
    this.phase = TurnPhase.Judgment;
    this.slashUsedThisTurn = false;
    this.slashPlayedThisTurn = false;
    this.aiTurnSeenStatesSet().clear();
    this.wineBuffPlayerIds = new Set();
    this.wineUsedPlayerIds = new Set();
    const player = this.currentPlayer;
    const logs = [`第 ${this.turn} 回合：${player.name} 的回合`, `进入${TurnPhase.Judgment}`];
    if (player.delayedTricks.length > 0) {
      logs.push(...(await this.resolveDelayedJudgments(player)));
    } else {
      logs.push(`${player.name} 的判定区为空`);
    }
    logs.push(...(await this.resolveDeaths()));
    if (this.winner !== null) {
      return logs;
    }
    this.phase = TurnPhase.Draw;
    logs.push(`进入${TurnPhase.Draw}`);
    if (player.faceDown) {
      player.faceDown = false;
      logs.push(`${player.name} 翻至正面，跳过本回合`);
      if (this.hasSkill(player, SkillName.JieWei) && await this.shouldActivateOptionalEffect(player, SkillName.JieWei)) {
        const drawn = this.drawCards(player.id, 1);
        logs.push(`${player.name} 发动${SkillName.JieWei}，摸了 ${drawn} 张牌`);
      }
      this.moveToNextPlayer();
      if (this.winner !== null) return logs;
      if (this.staged) {
        this.pendingNextTurn = true;
        return logs;
      }
      logs.push(...(await this.startTurn()));
      return logs;
    }
    this.resetTurnSkillState(player.id);
    await this.emitSkillTrigger("turn_start", { actor: player }, logs);
    if (this.skipDrawPhase === player.id) {
      this.skipDrawPhase = null;
      logs.push(`${player.name} 跳过摸牌阶段`);
    } else {
      const drawPayload: SkillEventPayload = { actor: player, drawCount: drawCountPerTurn };
      await this.emitSkillTrigger("before_draw", drawPayload, logs);
      const drawn = this.drawCards(player.id, drawPayload.drawCount ?? drawCountPerTurn);
      logs.push(`${player.name} 摸了 ${drawn} 张牌`);
    }
    this.phase = TurnPhase.Play;
    // 克己口径：官方是"出牌阶段内未使用/打出过杀"。杀只能在出牌阶段使用/打出，
    // 在此重置后，这两个 flag 即精确等于"本出牌阶段"的使用记录。
    this.slashUsedThisTurn = false;
    this.slashPlayedThisTurn = false;
    if (this.skipPlayPhase === player.id) {
      this.skipPlayPhase = null;
      logs.push(`${player.name} 跳过出牌阶段`);
      logs.push(...(await this.endPlayPhase(player.id)));
      return logs;
    }
    logs.push(`进入${TurnPhase.Play}`);
    return logs;
  }

  private async endPlayPhase(playerId: string): Promise<string[]> {
    const player = this.mustGetPlayer(playerId);
    if (!player.alive || player.id !== this.currentPlayer.id || this.phase !== TurnPhase.Play) {
      return [];
    }
    this.phase = TurnPhase.Discard;
    const logs: string[] = [];
    logs.push(`进入${TurnPhase.Discard}`);
    if (!await this.shouldSkipDiscardPhase(player, logs)) {
      // 手牌上限 = 体力值 + rules.handLimitDelta（绝境这类技能会把它抬高），统一走 getHandLimit。
      const handLimit = getHandLimit(player);
      if (!player.isAI && player.hand.length > handLimit) {
        logs.push(`${player.name} 需要弃置 ${player.hand.length - handLimit} 张手牌`);
        return logs;
      }
      while (player.hand.length > handLimit) {
        const index = this.randomIndex(player.hand.length);
        const removed = await this.removeHandCardAt(player, index);
        if (removed) {
          this.discardPile.push(removed);
          logs.push(`${player.name} 弃置了 ${removed.type}`);
        }
      }
    }
    if (this.staged) {
      this.pendingTurnEndPlayer = player.id;
    } else {
      logs.push(...(await this.finishTurn(player)));
    }
    return logs;
  }

  /**
   * 弃牌阶段入口的拦截点（Phase 6）：让外部武将包与声明式规则有机会跳过整个弃牌阶段。
   *
   * 两条路径，任一命中即跳过：
   * 1. `discard_phase_start` 钩子把 `payload.skipDiscardPhase` 置 true（钩子自行处理"是否发动"询问）；
   * 2. 声明式规则 `rules.skipDiscardPhaseIfNoSlash`：出牌阶段内未使用/打出过杀时，询问玩家是否发动（克己）。
   */
  private async shouldSkipDiscardPhase(player: Player, logs: string[]): Promise<boolean> {
    const payload: SkillEventPayload = { actor: player };
    await this.emitSkillTrigger("discard_phase_start", payload, logs);
    if (payload.skipDiscardPhase) {
      logs.push(`${player.name} 跳过弃牌阶段`);
      return true;
    }
    const skillId = findSkillWithBooleanRule(player, "skipDiscardPhaseIfNoSlash");
    if (!skillId || this.slashUsedThisTurn || this.slashPlayedThisTurn) {
      return false;
    }
    if (!await this.shouldActivateOptionalEffect(player, skillId)) {
      return false;
    }
    const displayName = resolveSkillDescriptor(skillId).displayName ?? skillId;
    logs.push(`${player.name} 发动${displayName}，跳过弃牌阶段`);
    return true;
  }

  async finishTurn(player: Player): Promise<string[]> {
    const logs: string[] = [];
    this.phase = TurnPhase.End;
    logs.push(`进入${TurnPhase.End}`);
    if (this.hasSkill(player, SkillName.BiYue) && await this.shouldActivateOptionalEffect(player, SkillName.BiYue)) {
      const drawn = this.drawCards(player.id, 1);
      logs.push(`${player.name} 的${SkillName.BiYue}生效，摸了 ${drawn} 张牌`);
    }
    if (this.hasSkill(player, SkillName.JuShou) && await this.shouldActivateOptionalEffect(player, SkillName.JuShou)) {
      const drawn = this.drawCards(player.id, 3);
      player.faceDown = true;
      logs.push(`${player.name} 发动${SkillName.JuShou}，摸了 ${drawn} 张牌并将武将牌翻至背面`);
    }
    logs.push(`${player.name} 结束回合`);
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

  private findTargetsByCard(playerId: string, cardType: CardType): string[] {
    if (!this.cardNeedsTarget(cardType)) {
      return [];
    }
    const targets = this.players
      .filter((player) => player.id !== playerId && player.alive)
      .map((player) => player.id);
    if (this.isSlashCard(cardType)) {
      const attacker = this.mustGetPlayer(playerId);
      return targets.filter((id) => {
        const target = this.mustGetPlayer(id);
        return this.canReachForSlash(attacker, target) && !this.isKongChengProtected(target, cardType);
      });
    }
    if (cardType === CardType.Duel) {
      return targets.filter((id) => !this.isKongChengProtected(this.mustGetPlayer(id), cardType));
    }
    if (cardType === CardType.Dismantle) {
      return targets.filter((id) => cardUtilsHasRemovableCard(this.mustGetPlayer(id)));
    }
    if (cardType === CardType.Snatch) {
      const user = this.mustGetPlayer(playerId);
      return targets.filter((id) => {
        const holder = this.mustGetPlayer(id);
        if (isImmuneTo(holder, "snatch")) {
          return false;
        }
        // 顺手牵羊只能对距离 1 以内的角色使用（奇才无视该限制）
        if (!this.canReachForDistanceOneTrick(user, holder)) {
          return false;
        }
        return cardUtilsHasRemovableCard(holder);
      });
    }
    if (cardType === CardType.Collateral) {
      return targets.filter((id) => {
        const holder = this.mustGetPlayer(id);
        // 借刀杀人只能对装备武器的角色使用
        if (holder.weapon === null) {
          return false;
        }
        return true;
      });
    }
    if (cardType === CardType.Indulgence || cardType === CardType.SuppliesCut) {
      const user = this.mustGetPlayer(playerId);
      return targets.filter((id) => {
        const holder = this.mustGetPlayer(id);
        if (cardType === CardType.Indulgence && isImmuneTo(holder, "indulgence")) {
          return false;
        }
        // 兵粮寸断只能对距离 1 以内的角色使用（奇才无视该限制）；乐不思蜀无距离限制
        if (cardType === CardType.SuppliesCut && !this.canReachForDistanceOneTrick(user, holder)) {
          return false;
        }
        return !holder.delayedTricks.some((t) => t.cardType === cardType);
      });
    }
    if (cardType === CardType.FireAttack) {
      // 火攻：对一名其他角色使用，无距离限制
      return targets;
    }
    if (cardType === CardType.IronChain) {
      // 铁索连环：可对包括自己在内的存活角色使用
      return this.players.filter((player) => player.alive).map((player) => player.id);
    }
    return targets;
  }

  private drawCards(playerId: string, count: number): number {
    const player = this.mustGetPlayer(playerId);
    let drawn = 0;
    for (let i = 0; i < count; i += 1) {
      const card = this.drawCard();
      if (!card) {
        break;
      }
      player.hand.push(card);
      drawn += 1;
    }
    return drawn;
  }

  private drawCard(): Card | null {
    if (this.deck.length === 0) {
      if (this.discardPile.length === 0) {
        return null;
      }
      this.deck = shuffle(this.discardPile, this.rng);
      this.discardPile = [];
    }
    const card = this.deck.shift();
    return card ?? null;
  }

  private async drawJudgmentCard(reason: string, logs: string[], owner?: Player): Promise<Card | null> {
    let card = this.drawCard();
    if (!card) {
      logs.push(`${reason}无法判定：牌堆为空`);
      return null;
    }
    this.discardPile.push(card);
    const suitNames = { heart: "红桃", diamond: "方片", club: "梅花", spade: "黑桃", none: "无花色" } as const;
    logs.push(`${reason}判定牌：${suitNames[card.suit]}${card.rank} ${card.type}`);
    // 拦截点 judgment：外部包可替换判定牌实现"改判"。钩子自己负责把替换牌从原区域移除，
    // 引擎负责把替换牌置入弃牌堆并接管后续（与内置鬼才的处理方式一致）。
    const judgmentPayload: SkillEventPayload = { ...(owner ? { actor: owner } : {}), reason, card, judgmentCard: card };
    await this.emitSkillTrigger("judgment", judgmentPayload, logs);
    if (judgmentPayload.judgmentCard && judgmentPayload.judgmentCard.id !== card.id) {
      const replacement = judgmentPayload.judgmentCard;
      // 兜底：替换牌若还留在其他区域（外部钩子漏移除），先清掉再入弃牌堆，保证单区唯一
      const cleaned = this.removeCardFromAllZones(replacement.id);
      this.discardPile.push(replacement);
      logs.push(`${reason}判定牌被替换：${describeCard(card)} → ${describeCard(replacement)}`);
      if (cleaned > 0) {
        logs.push(`${reason}改判替换牌残留在其他区域，已清理 ${cleaned} 处`);
      }
      card = replacement;
    }
    const guiCaiPlayer = this.players.find((item) => item.alive && this.hasSkill(item, SkillName.GuiCai));
    if (guiCaiPlayer) {
      const sources = this.buildUsableSources(guiCaiPlayer);
      if (sources.length > 0) {
        const decision = await this.decide({
          kind: "choose-discard",
          requestId: this.nextInteractionId(),
          playerId: guiCaiPlayer.id,
          reason: `${reason}：${guiCaiPlayer.name} 是否发动${SkillName.GuiCai}，用手牌替换判定牌？`,
          sources,
          count: 1,
          allowPass: true,
          passLabel: `不发动${SkillName.GuiCai}`,
        });
        if (decision.choice === "card") {
          const replacement = await this.removeUsableCardBySourceId(guiCaiPlayer, decision.sourceId);
          if (replacement) {
            this.discardPile.push(replacement);
            logs.push(`${guiCaiPlayer.name} 发动${SkillName.GuiCai}，以 ${describeCard(replacement)} 替换判定牌 ${describeCard(card)}`);
            card = replacement;
          }
        }
      }
    }
    if (owner && this.hasSkill(owner, SkillName.TianDu) && await this.shouldActivateOptionalEffect(owner, SkillName.TianDu)) {
      const index = this.discardPile.findIndex((item) => item.id === card.id);
      if (index >= 0) {
        const [obtained] = this.discardPile.splice(index, 1);
        if (obtained) {
          owner.hand.push(obtained);
          logs.push(`${owner.name} 的${SkillName.TianDu}生效，获得判定牌`);
        }
      }
    }
    return card;
  }

  private moveToNextPlayer(): void {
    const livingPlayers = this.players.filter((player) => player.alive);
    if (livingPlayers.length <= 1) {
      this.resolveWinner();
      return;
    }
    let moved = false;
    for (let i = 0; i < this.players.length; i += 1) {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
      if (this.players[this.currentPlayerIndex]?.alive) {
        moved = true;
        break;
      }
    }
    if (moved) {
      this.turn += 1;
    }
  }

  private async advanceIfCurrentPlayerDead(logs: string[]): Promise<void> {
    if (this.winner !== null) {
      return;
    }
    const current = this.players[this.currentPlayerIndex];
    if (current?.alive) {
      return;
    }
    this.moveToNextPlayer();
    if (this.winner !== null) {
      return;
    }
    if (this.staged) {
      this.pendingNextTurn = true;
      return;
    }
    logs.push(...(await this.startTurn()));
  }

  private normalizeInitOptions(options: Partial<GameInitOptions>): GameInitOptions {
    const playerCountSource = options.playerCount ?? ((options.aiCount ?? defaultInitOptions.aiCount) + 1);
    const playerCount = Math.min(6, Math.max(2, Math.floor(playerCountSource)));
    const aiCount = playerCount - 1;
    const openingHandCount = options.openingHandCount ?? defaultInitOptions.openingHandCount;
    const humanName = options.humanName ?? defaultInitOptions.humanName;
    const humanRole = options.humanRole ?? defaultInitOptions.humanRole;
    const humanGeneral = options.humanGeneral ?? defaultInitOptions.humanGeneral;
    return {
      playerCount,
      aiCount,
      openingHandCount: Math.min(6, Math.max(3, Math.floor(openingHandCount))),
      humanName,
      humanRole,
      humanGeneral,
    };
  }

  private createPlayer(
    id: string,
    name: string,
    isAI: boolean,
    general: GeneralDefinition,
    role: PlayerRole,
  ): Player {
    return {
      id,
      name,
      role,
      gender: general.gender,
      general: general.name,
      skills: [...general.skills],
      isAI,
      hp: general.maxHp,
      maxHp: general.maxHp,
      hand: [],
      weapon: null,
      armor: null,
      defenseHorse: null,
      attackHorse: null,
      treasure: null,
      treasureCards: [],
      delayedTricks: [],
      alive: true,
      faceDown: false,
      chained: false,
    };
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
    let discarded = 0;
    for (let i = 0; i < count && player.hand.length > 0; i += 1) {
      const index = this.randomIndex(player.hand.length);
      const removed = await this.removeHandCardAt(player, index);
      if (removed) {
        this.discardPile.push(removed);
        discarded += 1;
      }
    }
    if (discarded > 0) {
      logs.push(`${player.name} 弃置了 ${discarded} 张手牌`);
    }
    return discarded;
  }

  // 集中式手牌移除：所有“失去手牌”的路径统一走这里，便于触发连营。
  private async removeHandCardAt(player: Player, index: number, logs?: string[]): Promise<Card | undefined> {
    const removed = player.hand.splice(index, 1)[0];
    if (removed) {
      // 拦截点 hand_card_lost：只通知，不改变移除结果。
      // 注意：调用方未传 logs 时，钩子产生的日志会被丢弃（不进入对局日志）。
      await this.emitSkillTrigger("hand_card_lost", { actor: player, card: removed }, logs ?? []);
      await this.checkLianYing(player, logs);
    }
    return removed;
  }

  // 连营：失去最后一张手牌时可摸一张牌。
  private async checkLianYing(player: Player, logs?: string[]): Promise<void> {
    if (this.winner !== null || !player.alive || player.hand.length > 0) {
      return;
    }
    if (!this.hasSkill(player, SkillName.LianYing)) {
      return;
    }
    if (!await this.shouldActivateOptionalEffect(player, SkillName.LianYing)) {
      return;
    }
    const drawn = this.drawCards(player.id, 1);
    if (drawn > 0 && logs) {
      logs.push(`${player.name} 的${SkillName.LianYing}生效，失去最后手牌后摸了 ${drawn} 张牌`);
    }
  }

  // 突袭/其他技能用：从目标获得 1 张随机手牌（不取装备）。
  private async takeRandomHandCard(player: Player, receiver: Player): Promise<Card | undefined> {
    if (player.hand.length === 0) {
      return undefined;
    }
    const index = this.randomIndex(player.hand.length);
    const removed = await this.removeHandCardAt(player, index);
    if (removed) {
      receiver.hand.push(removed);
    }
    return removed;
  }

  private drawTopCards(count: number): Card[] {
    const drawn: Card[] = [];
    for (let i = 0; i < count; i += 1) {
      const card = this.drawCard();
      if (!card) {
        break;
      }
      drawn.push(card);
    }
    return drawn;
  }

  private placeCardsOnTop(cards: Card[]): void {
    for (let i = cards.length - 1; i >= 0; i -= 1) {
      const card = cards[i];
      if (card) {
        this.deck.unshift(card);
      }
    }
  }

  private placeCardsOnBottom(cards: Card[]): void {
    this.deck.push(...cards);
  }

  private async emitSkillTrigger(trigger: SkillTrigger, payload: SkillEventPayload, logs: string[]): Promise<void> {
    const hooks = this.skillHooks[trigger];
    for (const hook of hooks) {
      await hook(payload, logs);
    }
  }

  private async applyDamage(
    source: Player | null,
    target: Player,
    amount: number,
    reason: string,
    logs: string[],
    damageCard?: Card,
    damageKind?: DamageKind | null,
    isChainSpread = false,
  ): Promise<void> {
    const payload: SkillEventPayload = {
      source,
      target,
      damage: amount,
      reason,
      ...(damageCard ? { card: damageCard } : {}),
    };
    await this.emitSkillTrigger("before_damage", payload, logs);
    let finalDamage = Math.max(0, payload.damage ?? 0);
    if (target.armor === CardType.SilverLion && finalDamage > 1) {
      finalDamage = 1;
      logs.push(`${target.name} 的白银狮子生效，本次伤害改为 1`);
    }
    if (finalDamage === 0) {
      logs.push(`${target.name} 未受到伤害`);
      return;
    }
    target.hp -= finalDamage;
    // 记录击杀归属：伤害来源即"凶手"，无来源伤害（闪电、苦肉等 source === target）记 null。
    this.noteDamageSource(source && source.id !== target.id ? source.id : null, target.id);
    logs.push(`${target.name} 受到 ${finalDamage} 点伤害，当前体力 ${Math.max(target.hp, 0)}`);
    // 铁索连环传导：处于连环状态的角色受到属性伤害时，其他连环角色受到等量同属性伤害（单波次，不递归）。
    // 属性伤害结算完成后，受到影响的所有角色（含被传导者）立即重置武将牌、脱离连环状态。
    if (!isChainSpread && target.chained) {
      const kind = damageKind ?? attributeDamageKind(damageCard?.type);
      if (kind) {
        const kindLabel = kind === "fire" ? "火焰" : "雷电";
        target.chained = false;
        logs.push(`${target.name} 受到${kindLabel}属性伤害，铁索连环状态重置`);
        const others = this.players.filter((p) => p.alive && p.chained && p.id !== target.id);
        for (const other of others) {
          other.chained = false;
          logs.push(`铁索连环传导：${other.name} 受到 ${finalDamage} 点${kindLabel}伤害，铁索连环状态重置`);
          await this.applyDamage(source, other, finalDamage, "铁索连环", logs, damageCard, kind, true);
        }
      }
    }
    // after_damage 钩子看到的是实际造成的伤害（白银狮子等压过之后的值），而非原始数值
    payload.damage = finalDamage;
    await this.emitSkillTrigger("after_damage", payload, logs);
  }

  private isKongChengProtected(target: Player, cardType: CardType): boolean {
    if (this.isSlashCard(cardType)) {
      return isImmuneTo(target, "slash");
    }
    if (cardType === CardType.Duel) {
      return isImmuneTo(target, "duel");
    }
    return false;
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

  /** 主公 +1 体力上限：总人数 ≥ 4 时生效（rules.md §3.4）。 */
  private applyLordBonus(): void {
    if (this.players.length < 4) {
      return;
    }
    const lord = this.players.find((player) => player.role === PlayerRole.Lord);
    if (!lord) {
      return;
    }
    lord.maxHp += 1;
    lord.hp += 1;
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

  private isEquipCard(cardType: CardType): cardType is EquipCardType {
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
    this.damageCredit ??= new Map<string, string | null>();
    return this.damageCredit;
  }

  /**
   * 把一张牌从所有已知区域移除（牌堆/弃牌堆/所有人手牌/木牛流马存牌），返回移除数量。
   * 外部改判钩子漏移除时的兜底：保证同一张牌只存在于一个区域。
   */
  private removeCardFromAllZones(cardId: string): number {
    let removed = 0;
    const sweep = (pool: Card[]): void => {
      for (let index = pool.length - 1; index >= 0; index -= 1) {
        if (pool[index]?.id === cardId) {
          pool.splice(index, 1);
          removed += 1;
        }
      }
    };
    sweep(this.deck);
    sweep(this.discardPile);
    for (const player of this.players) {
      sweep(player.hand);
      sweep(player.treasureCards);
    }
    return removed;
  }

  private oxStoredTurnMap(): Map<string, number> {
    this.woodenOxStoredTurn ??= new Map<string, number>();
    return this.woodenOxStoredTurn;
  }

  private aiTurnSeenStatesSet(): Set<string> {
    this.aiTurnSeenStates ??= new Set<string>();
    return this.aiTurnSeenStates;
  }

  /** 木牛流马取出资格：本回合刚置入的牌本回合不能取出（防置入/取出空转）。 */
  private canTakeStoredCard(card: Card): boolean {
    return (this.oxStoredTurnMap().get(card.id) ?? -1) < this.turn;
  }

  private buildAiTurnProgressKey(): string {
    const parts: string[] = [`t${this.turn}`, `p${this.phase}`, `d${this.deck.length}`, `x${this.discardPile.length}`];
    for (const player of this.players) {
      parts.push(
        [
          player.id,
          player.alive ? 1 : 0,
          player.hp,
          player.hand.map((card) => card.id).join(","),
          player.weapon ?? "",
          player.armor ?? "",
          player.defenseHorse ?? "",
          player.attackHorse ?? "",
          player.treasure ?? "",
          player.treasureCards.map((card) => card.id).join(","),
          player.chained ? 1 : 0,
        ].join("|"),
      );
    }
    return parts.join("#");
  }

  /**
   * AI 驱动每执行一个动作后调用：当前局面若本回合已出现过则返回 true
   *（决策器在零收益打转，调用方应强制结束出牌），否则记录并返回 false。
   */
  public noteAiTurnProgress(): boolean {
    const seen = this.aiTurnSeenStatesSet();
    const key = this.buildAiTurnProgressKey();
    if (seen.has(key)) {
      return true;
    }
    if (seen.size > 1000) {
      seen.clear();
    }
    seen.add(key);
    return false;
  }

  /** AI 驱动在回合开始时调用：清空局面记录并记下初始局面。 */
  public beginAiTurnProgress(): void {
    this.aiTurnSeenStatesSet().clear();
    this.noteAiTurnProgress();
  }

  private noteDamageSource(sourceId: string | null, targetId: string): void {
    this.damageCreditMap().set(targetId, sourceId);
  }

  private takeDamageSource(targetId: string): string | null {
    const map = this.damageCreditMap();
    const sourceId = map.get(targetId) ?? null;
    map.delete(targetId);
    return sourceId;
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
