import { CARD_LIBRARY_SUMMARY, Card, CardType, createDeck, shuffle } from "./cards.js";
import { CardSource, DecisionHandler, InteractionDecision, InteractionRequest, ResponseKind } from "./interaction.js";

export type { CardSource, DecisionHandler, InteractionDecision, InteractionRequest, ResponseKind } from "./interaction.js";

export enum TurnPhase {
  Judgment = "判定阶段",
  Draw = "摸牌阶段",
  Play = "出牌阶段",
  Discard = "弃牌阶段",
  End = "结束阶段",
}

export type Player = {
  id: string;
  name: string;
  role: PlayerRole;
  gender: "男" | "女";
  general: string;
  skills: SkillName[];
  isAI: boolean;
  hp: number;
  maxHp: number;
  hand: Card[];
  weapon: WeaponType | null;
  armor: ArmorType | null;
  defenseHorse: DefenseHorseType | null;
  attackHorse: AttackHorseType | null;
  treasure: TreasureType | null;
  treasureCards: Card[];
  delayedTricks: Array<{ cardType: CardType; sourcePlayerId: string }>;
  alive: boolean;
  faceDown: boolean;
};

export enum SkillName {
  Heroic = "英姿",
  Roar = "咆哮",
  Assault = "强袭",
  JuShou = "据守",
  JieWei = "解围",
  JianXiong = "奸雄",
  HuJia = "护驾",
  QingGuo = "倾国",
  LuoShen = "洛神",
  GangLie = "刚烈",
  LuoYi = "裸衣",
  TuXi = "突袭",
  TianDu = "天妒",
  YiJi = "遗计",
  FanKui = "反馈",
  GuiCai = "鬼才",
  RenDe = "仁德",
  JiJiang = "激将",
  WuSheng = "武圣",
  LongDan = "龙胆",
  MaShu = "马术",
  TieQi = "铁骑",
  GuanXing = "观星",
  KongCheng = "空城",
  JiZhi = "集智",
  QiCai = "奇才",
  ZhiHeng = "制衡",
  JiuYuan = "救援",
  FanJian = "反间",
  KuRou = "苦肉",
  QianXun = "谦逊",
  LianYing = "连营",
  GuoSe = "国色",
  LiuLi = "流离",
  JieYin = "结姻",
  XiaoJi = "枭姬",
  WuShuang = "无双",
  LiJian = "离间",
  BiYue = "闭月",
  QingNang = "青囊",
  JiJiu = "急救",
  JiAng = "激昂",
  HunZi = "魂姿",
  YingHun = "英魂",
  ZhiBa = "制霸",
}

export type GameAction =
  | {
      type: "play";
      cardIndex: number;
      label: string;
      requiresTarget: boolean;
      targets: string[];
    }
  | {
      type: "skill";
      skill: SkillName;
      label: string;
      requiresTarget: boolean;
      targets: string[];
    }
  | {
      type: "end";
      label: string;
    };

export type GameSnapshot = {
  turn: number;
  currentPlayerId: string;
  phase: TurnPhase;
  players: Player[];
  winner: "human" | "ai" | "draw" | null;
  gameOver: boolean;
  slashUsed: boolean;
  deckCount: number;
  discardCount: number;
};

export type GameInitOptions = {
  playerCount: number;
  aiCount: number;
  openingHandCount: number;
  humanName: string;
  humanRole: PlayerRole;
  humanGeneral: string;
};

export type NetworkPlayerConfig = {
  id: string;
  name: string;
  isAI?: boolean;
};

export type GeneralDefinition = {
  kingdom: "魏" | "蜀" | "吴" | "群雄";
  name: string;
  maxHp: number;
  skills: SkillName[];
};

type SkillTrigger = "turn_start" | "before_draw" | "before_damage" | "after_damage";

type SkillEventPayload = {
  actor?: Player;
  source?: Player | null;
  target?: Player;
  drawCount?: number;
  damage?: number;
  reason?: string;
};

type SkillHook = (payload: SkillEventPayload, logs: string[]) => void | Promise<void>;

type RngFn = () => number;

type ResponsePolicy = Partial<Record<ResponseKind, boolean>>;

export type ResponseOption = {
  id: string;
  kind: ResponseKind;
  label: string;
};

export type DiscardOption = {
  handIndex: number;
  cardId: string;
  cardType: CardType;
};

export type RemovableCardOption = {
  id: string;
  zone: "hand" | "weapon" | "armor" | "defenseHorse" | "attackHorse" | "treasure";
  cardType: CardType | null;
  label: string;
};

const drawCountPerTurn = 2;

export enum PlayerRole {
  Lord = "主公",
  Loyalist = "忠臣",
  Rebel = "反贼",
  Traitor = "内奸",
}

type WeaponType =
  | CardType.Crossbow
  | CardType.FemaleSword
  | CardType.QinggangSword
  | CardType.IceSword
  | CardType.GudingBlade
  | CardType.SerpentSpear
  | CardType.GreenDragonBlade
  | CardType.RockCleavingAxe
  | CardType.Halberd
  | CardType.KylinBow;
type ArmorType =
  | CardType.EightDiagram
  | CardType.VineArmor
  | CardType.SilverLion;
type DefenseHorseType = CardType.Dilu | CardType.JueYing | CardType.ZhuaHuangFeiDian;
type AttackHorseType = CardType.ChiTu | CardType.DaYuan | CardType.ZiXing;
type TreasureType = CardType.WoodenOx;
type EquipCardType = WeaponType | ArmorType | DefenseHorseType | AttackHorseType | TreasureType;

const defaultInitOptions: GameInitOptions = {
  playerCount: 3,
  aiCount: 2,
  openingHandCount: 4,
  humanName: "主公",
  humanRole: PlayerRole.Lord,
  humanGeneral: "孙策",
};

const humanGeneral: GeneralDefinition = {
  kingdom: "吴",
  name: "孙策",
  maxHp: 4,
  skills: [SkillName.JiAng, SkillName.HunZi, SkillName.ZhiBa],
};

const commonGeneralPool: GeneralDefinition[] = [
  { kingdom: "魏", name: "夏侯惇", maxHp: 4, skills: [SkillName.GangLie] },
  { kingdom: "魏", name: "许褚", maxHp: 4, skills: [SkillName.LuoYi] },
  { kingdom: "蜀", name: "关羽", maxHp: 4, skills: [SkillName.WuSheng] },
  { kingdom: "蜀", name: "张飞", maxHp: 4, skills: [SkillName.Roar] },
  { kingdom: "蜀", name: "赵云", maxHp: 4, skills: [SkillName.LongDan] },
  { kingdom: "蜀", name: "马超", maxHp: 4, skills: [SkillName.MaShu, SkillName.TieQi] },
  { kingdom: "蜀", name: "黄月英", maxHp: 3, skills: [SkillName.JiZhi, SkillName.QiCai] },
  { kingdom: "吴", name: "黄盖", maxHp: 4, skills: [SkillName.KuRou] },
  { kingdom: "群雄", name: "吕布", maxHp: 4, skills: [SkillName.WuShuang] },
  { kingdom: "魏", name: "曹仁", maxHp: 4, skills: [SkillName.JuShou, SkillName.JieWei] },
  { kingdom: "魏", name: "甄姬", maxHp: 3, skills: [SkillName.QingGuo, SkillName.LuoShen] },
  { kingdom: "吴", name: "孙权", maxHp: 4, skills: [SkillName.ZhiHeng, SkillName.JiuYuan] },
  { kingdom: "吴", name: "周瑜", maxHp: 3, skills: [SkillName.Heroic, SkillName.FanJian] },
  { kingdom: "吴", name: "孙尚香", maxHp: 3, skills: [SkillName.JieYin, SkillName.XiaoJi] },
  { kingdom: "群雄", name: "貂蝉", maxHp: 3, skills: [SkillName.LiJian, SkillName.BiYue] },
  { kingdom: "群雄", name: "华佗", maxHp: 3, skills: [SkillName.QingNang, SkillName.JiJiu] },
];


// Kept only for loading explicit legacy configurations; these generals are not selectable or randomly assigned.
const disabledGeneralDefinitions: GeneralDefinition[] = [
  { kingdom: "魏", name: "曹操", maxHp: 4, skills: [SkillName.JianXiong, SkillName.HuJia] },
  { kingdom: "魏", name: "张辽", maxHp: 4, skills: [SkillName.TuXi] },
  { kingdom: "魏", name: "郭嘉", maxHp: 3, skills: [SkillName.TianDu, SkillName.YiJi] },
  { kingdom: "魏", name: "司马懿", maxHp: 3, skills: [SkillName.FanKui, SkillName.GuiCai] },
  { kingdom: "蜀", name: "刘备", maxHp: 4, skills: [SkillName.RenDe, SkillName.JiJiang] },
  { kingdom: "蜀", name: "诸葛亮（标准版）", maxHp: 3, skills: [SkillName.GuanXing, SkillName.KongCheng] },
  { kingdom: "吴", name: "陆逊", maxHp: 3, skills: [SkillName.QianXun, SkillName.LianYing] },
  { kingdom: "吴", name: "大乔", maxHp: 3, skills: [SkillName.GuoSe, SkillName.LiuLi] },
];

export const GENERAL_LIBRARY: GeneralDefinition[] = [humanGeneral, ...commonGeneralPool];

export class SanGuoGame {
  private players: Player[];

  private deck: Card[];

  private discardPile: Card[];

  private currentPlayerIndex: number;

  private turn: number;

  private phase: TurnPhase;

  private slashUsedThisTurn: boolean;

  private winner: "human" | "ai" | "draw" | null;

  private readonly rng: RngFn;

  private skillUsedThisTurn: Map<string, Set<SkillName>>;

  private readonly skillHooks: Record<SkillTrigger, SkillHook[]>;

  private responsePolicyByPlayer: Map<string, ResponsePolicy>;

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

  constructor(rng: RngFn = Math.random) {
    this.rng = rng;
    this.players = [];
    this.deck = [];
    this.discardPile = [];
    this.currentPlayerIndex = 0;
    this.turn = 1;
    this.phase = TurnPhase.Draw;
    this.slashUsedThisTurn = false;
    this.winner = null;
    this.skillUsedThisTurn = new Map();
    this.skillHooks = this.createSkillHooks();
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
    this.skillUsedThisTurn = new Map();
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
    this.players = playerConfigs.map((config, index) => {
      const general = this.pickRandomUnusedGeneral(usedGeneralNames);
      usedGeneralNames.add(general.name);
      return this.createPlayer(config.id, config.name, config.isAI ?? false, general, shuffledRoles[index] ?? PlayerRole.Rebel);
    });
    this.deck = shuffle(createDeck(), this.rng);
    this.discardPile = [];
    this.currentPlayerIndex = this.players.findIndex((player) => player.role === PlayerRole.Lord);
    this.currentPlayerIndex = Math.max(0, this.currentPlayerIndex);
    this.turn = 1;
    this.phase = TurnPhase.Draw;
    this.winner = null;
    this.slashUsedThisTurn = false;
    this.skillUsedThisTurn = new Map();
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
      maxHp: item.maxHp,
      skills: [...item.skills],
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
      });
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
    if (
      player.weapon === CardType.SerpentSpear &&
      player.hand.length >= 2 &&
      (!this.slashUsedThisTurn || this.hasSkill(player, SkillName.Roar))
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
        });
      });
      if (player.treasureCards.length > 0) {
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
    actions.push({ type: "end", label: "结束出牌阶段" });
    return actions;
  }

  getPendingDiscardCount(playerId: string): number {
    if (this.winner !== null) {
      return 0;
    }
    const player = this.mustGetPlayer(playerId);
    if (!player.alive || player.id !== this.currentPlayer.id || this.phase !== TurnPhase.Discard) {
      return 0;
    }
    return Math.max(0, player.hand.length - player.hp);
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
    const removed = player.hand.splice(handIndex, 1)[0];
    if (!removed) {
      return ["弃牌选择无效"];
    }
    this.discardPile.push(removed);
    const logs = [`${player.name} 弃置了 ${removed.type}`];
    if (player.hand.length > player.hp) {
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
      const used = player.hand.splice(index, 1)[0];
      if (!used) {
        return ["使用卡牌失败"];
      }
      this.discardPile.push(used);
      this.slashUsedThisTurn = true;
      const logs = [`${player.name} 发动${SkillName.LongDan}，将${CardType.Dodge}当${CardType.Slash}使用`];
      logs.push(...(await this.resolveSlash(player, target, false, false, used.color === "red")));
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
      const used = player.hand.splice(index, 1)[0];
      if (!used) {
        return ["使用卡牌失败"];
      }
      this.discardPile.push(used);
      this.slashUsedThisTurn = true;
      const logs = [`${player.name} 发动${SkillName.WuSheng}，将红色${used.type}当${CardType.Slash}使用`];
      logs.push(...(await this.resolveSlash(player, target, false, false, true)));
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
      return [`${player.name} 将 ${moved.type} 置于${CardType.WoodenOx}下方`];
    }
    if (action.cardIndex === -13) {
      if (player.treasure !== CardType.WoodenOx || player.treasureCards.length === 0) {
        return [`${player.name} 当前无法从${CardType.WoodenOx}取牌`];
      }
      const oxSources = this.buildUsableSources(player).filter((source) => source.origin === "treasure");
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
      if (this.slashUsedThisTurn && !this.hasSkill(player, SkillName.Roar)) {
        return [`${player.name} 本回合已使用过杀`];
      }
      if (!targetId) {
        return ["需要选择目标"];
      }
      const target = this.mustGetPlayer(targetId);
      if (!target.alive || target.id === player.id || !this.canReachForSlash(player, target)) {
        return ["目标无效"];
      }
      const first = player.hand.shift();
      const second = player.hand.shift();
      if (!first || !second) {
        return [`${player.name} 手牌不足，无法发动丈八蛇矛`];
      }
      this.discardPile.push(first);
      this.discardPile.push(second);
      if (!this.hasSkill(player, SkillName.Roar)) {
        this.slashUsedThisTurn = true;
      }
      const logs = [
        `${player.name} 发动丈八蛇矛，弃置 ${first.type}、${second.type} 视为使用杀`,
        ...(await this.resolveSlash(player, target, true)),
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
      !this.hasSkill(player, SkillName.Roar) &&
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
      if (!target.alive || target.id === player.id) {
        return ["目标无效"];
      }
      if ((this.isSlashCard(card.type) || card.type === CardType.Duel) && this.isKongChengProtected(target, card.type)) {
        return [`${target.name} 的${SkillName.KongCheng}生效，无法成为目标`];
      }
      if (this.isSlashCard(card.type) && !this.canReachForSlash(player, target)) {
        return ["目标超出攻击范围"];
      }
    }

    const usedCard = player.hand.splice(action.cardIndex, 1)[0];
    if (!usedCard) {
      return ["使用卡牌失败"];
    }
    return this.resolveUsedCard(player, usedCard, targetId, false, selectedCardId);
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
    if (fromTreasure) {
      logs.push(`${player.name} 从${CardType.WoodenOx}下使用了 ${usedCard.type}`);
    }
    if (this.hasSkill(player, SkillName.JiZhi) && await this.shouldActivateOptionalEffect(player, SkillName.JiZhi) && this.isNonDelayedTrickCard(usedCard.type)) {
      const drawn = this.drawCards(player.id, 1);
      logs.push(`${player.name} 的${SkillName.JiZhi}生效，摸了 ${drawn} 张牌`);
    }
    if (this.isSlashCard(usedCard.type) && targetId) {
      if (!this.hasSkill(player, SkillName.Roar)) {
        this.slashUsedThisTurn = true;
      }
      const slashTargets = await this.expandSlashTargets(player, this.mustGetPlayer(targetId), player.hand.length === 0);
      for (const slashTarget of slashTargets) {
        logs.push(...(await this.resolveSlash(player, slashTarget, false, usedCard.type === CardType.FireSlash, usedCard.color === "red")));
      }
    } else if (usedCard.type === CardType.Peach) {
      player.hp = Math.min(player.maxHp, player.hp + 1);
      logs.push(`${player.name} 使用桃，回复 1 点体力`);
    } else if (usedCard.type === CardType.Dismantle && targetId) {
      logs.push(...(await this.resolveDismantle(player, this.mustGetPlayer(targetId), selectedCardId)));
    } else if (usedCard.type === CardType.Snatch && targetId) {
      logs.push(...(await this.resolveSnatch(player, this.mustGetPlayer(targetId), selectedCardId)));
    } else if (usedCard.type === CardType.Duel && targetId) {
      logs.push(...(await this.resolveDuel(player, this.mustGetPlayer(targetId))));
    } else if (usedCard.type === CardType.ExNihilo) {
      const drawn = this.drawCards(player.id, 2);
      logs.push(`${player.name} 使用无中生有，摸了 ${drawn} 张牌`);
    } else if (usedCard.type === CardType.Barbarian) {
      logs.push(...(await this.resolveBarbarian(player)));
    } else if (usedCard.type === CardType.ArrowRain) {
      logs.push(...(await this.resolveArrowRain(player)));
    } else if (usedCard.type === CardType.Collateral && targetId) {
      logs.push(...(await this.resolveCollateral(player, this.mustGetPlayer(targetId))));
    } else if (usedCard.type === CardType.PeachGarden) {
      logs.push(...this.resolvePeachGarden(player));
    } else if (usedCard.type === CardType.Harvest) {
      logs.push(...this.resolveHarvest(player));
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
    while (true) {
      const ai = this.currentPlayer;
      const actions = this.getPlayableActions(ai.id);
      const best = this.pickBestAiAction(actions, ai.id);
      if (!best || best.type === "end") {
        logs.push(...(await this.endPlayPhase(ai.id)));
        return logs;
      }
      const targetId = best.requiresTarget ? this.pickBestTarget(best.targets) : undefined;
      logs.push(...(await this.playAction(ai.id, best, targetId)));
      if (this.winner !== null) {
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
    const best = this.pickBestAiAction(actions, player.id);
    if (!best) {
      return null;
    }
    if (best.type === "end" || !best.requiresTarget) {
      return { action: best };
    }
    const targetId = this.pickBestTarget(best.targets);
    return targetId ? { action: best, targetId } : { action: best };
  }

  setPlayerResponsePolicy(playerId: string, policy: ResponsePolicy | null): void {
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

  private buildUsableSources(player: Player): CardSource[] {
    const sources: CardSource[] = [];
    for (const card of player.hand) {
      sources.push({ sourceId: `hand:${card.id}`, origin: "hand", card, label: card.type });
    }
    for (const card of player.treasureCards) {
      sources.push({ sourceId: `treasure:${card.id}`, origin: "treasure", card, label: `${card.type}（木牛流马）` });
    }
    return sources;
  }

  private usableCardCount(player: Player): number {
    return player.hand.length + player.treasureCards.length;
  }

  private peekUsableCard(player: Player, sourceId: string): CardSource | undefined {
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

  private removeUsableCardBySourceId(player: Player, sourceId: string): Card | undefined {
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
    const index = pool.findIndex((item) => item.id === cardId);
    if (index < 0) {
      return undefined;
    }
    return pool.splice(index, 1)[0];
  }

  private buildDodgeSources(player: Player): CardSource[] {
    const all = this.buildUsableSources(player);
    const sources: CardSource[] = [];
    for (const source of all) {
      if (source.card.type === CardType.Dodge) {
        sources.push({ ...source, label: `打出${CardType.Dodge}${source.origin === "treasure" ? "（木牛流马）" : ""}` });
      }
    }
    if (this.hasSkill(player, SkillName.QingGuo)) {
      for (const source of all) {
        if (source.card.color === "black" && source.card.type !== CardType.Dodge) {
          sources.push({ ...source, label: `${SkillName.QingGuo}当${CardType.Dodge}` });
        }
      }
    }
    if (this.hasSkill(player, SkillName.LongDan)) {
      for (const source of all) {
        if (this.isSlashCard(source.card.type)) {
          sources.push({ ...source, label: `${SkillName.LongDan}当${CardType.Dodge}` });
        }
      }
    }
    return sources;
  }

  private buildSlashSources(player: Player): CardSource[] {
    const all = this.buildUsableSources(player);
    const sources: CardSource[] = [];
    for (const source of all) {
      if (this.isSlashCard(source.card.type)) {
        sources.push({ ...source, label: `打出${source.card.type}${source.origin === "treasure" ? "（木牛流马）" : ""}` });
      }
    }
    if (this.hasSkill(player, SkillName.WuSheng)) {
      for (const source of all) {
        if (source.card.color === "red" && !this.isSlashCard(source.card.type)) {
          sources.push({ ...source, label: `${SkillName.WuSheng}当${CardType.Slash}` });
        }
      }
    }
    if (this.hasSkill(player, SkillName.LongDan)) {
      for (const source of all) {
        if (source.card.type === CardType.Dodge) {
          sources.push({ ...source, label: `${SkillName.LongDan}当${CardType.Slash}` });
        }
      }
    }
    return sources;
  }

  private buildNegateSources(player: Player): CardSource[] {
    return this.buildUsableSources(player)
      .filter((source) => source.card.type === CardType.Negate)
      .map((source) => ({ ...source, label: `打出${CardType.Negate}${source.origin === "treasure" ? "（木牛流马）" : ""}` }));
  }

  private buildPeachSources(player: Player): CardSource[] {
    const all = this.buildUsableSources(player);
    const sources: CardSource[] = [];
    for (const source of all) {
      if (source.card.type === CardType.Peach) {
        sources.push({ ...source, label: `使用${CardType.Peach}${source.origin === "treasure" ? "（木牛流马）" : ""}` });
      }
    }
    if (this.hasSkill(player, SkillName.JiJiu) && player.id !== this.currentPlayer.id) {
      for (const source of all) {
        if (source.card.color === "red" && source.card.type !== CardType.Peach) {
          sources.push({ ...source, label: `${SkillName.JiJiu}当${CardType.Peach}` });
        }
      }
    }
    return sources;
  }

  private buildResponseSources(player: Player, kind: ResponseKind): CardSource[] {
    if (kind === "dodge") return this.buildDodgeSources(player);
    if (kind === "slash") return this.buildSlashSources(player);
    if (kind === "negate") return this.buildNegateSources(player);
    return this.buildPeachSources(player);
  }

  private consumeResponseCard(player: Player, kind: ResponseKind, sourceId: string, logs: string[]): boolean {
    const source = this.peekUsableCard(player, sourceId);
    if (!source) {
      return false;
    }
    const card = source.card;
    const direct =
      kind === "dodge"
        ? card.type === CardType.Dodge
        : kind === "slash"
          ? this.isSlashCard(card.type)
          : kind === "negate"
            ? card.type === CardType.Negate
            : card.type === CardType.Peach;
    if (!direct) {
      const convertedLabel =
        kind === "dodge" && card.color === "black" && this.hasSkill(player, SkillName.QingGuo)
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
    const removed = this.removeUsableCardBySourceId(player, sourceId);
    if (!removed) {
      return false;
    }
    this.discardPile.push(removed);
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
      return this.consumeSelectedResponse(player, kind, selection, logs);
    }
    const sources = this.buildResponseSources(player, kind);
    if (sources.length === 0) {
      return false;
    }
    const cardNames: Record<ResponseKind, string> = {
      dodge: CardType.Dodge,
      slash: CardType.Slash,
      negate: CardType.Negate,
      peach: CardType.Peach,
    };
    const decision = await this.decide({
      kind: "respond",
      requestId: this.nextInteractionId(),
      responderId: player.id,
      trigger,
      responseKind: kind,
      sources,
      allowPass: true,
      reason: `${trigger.cardName}：是否打出${cardNames[kind]}？`,
    });
    if (decision.choice !== "card") {
      return false;
    }
    return this.consumeResponseCard(player, kind, decision.sourceId, logs);
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
      const card = this.removeUsableCardBySourceId(player, decision.sourceId);
      if (!card) {
        break;
      }
      picked.push(card);
    }
    return picked;
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
    if (this.hasSkill(player, SkillName.LuoShen)) effects.push(SkillName.LuoShen);
    if (this.hasSkill(player, SkillName.YingHun) && Math.max(0, player.maxHp - player.hp) > 0) {
      const others = this.players.filter((item) => item.alive && item.id !== player.id);
      if (others.length > 0) effects.push(SkillName.YingHun);
    }
    if (this.hasSkill(player, SkillName.Heroic)) effects.push(SkillName.Heroic);
    if (this.hasSkill(player, SkillName.LuoYi)) effects.push(SkillName.LuoYi);
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
    if (!player.isAI && player.hand.length > player.hp) {
      logs.push(`${player.name} 需要弃置 ${player.hand.length - player.hp} 张手牌`);
      return logs;
    }
    while (player.hand.length > player.hp) {
      const index = this.randomIndex(player.hand.length);
      const removed = player.hand.splice(index, 1)[0];
      if (removed) {
        this.discardPile.push(removed);
        logs.push(`${player.name} 弃置了 ${removed.type}`);
      }
    }
    if (this.staged) {
      this.pendingTurnEndPlayer = player.id;
    } else {
      logs.push(...(await this.finishTurn(player)));
    }
    return logs;
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

  private async resolveSlash(
    attacker: Player,
    target: Player,
    fromSerpent = false,
    fire = false,
    redSlash = false,
  ): Promise<string[]> {
    const logs = [`${attacker.name} 对 ${target.name} 使用${fire ? CardType.FireSlash : CardType.Slash}`];
    await this.triggerJiAng(attacker, target, redSlash, logs);
    if (this.isKongChengProtected(target, CardType.Slash)) {
      logs.push(`${target.name} 的${SkillName.KongCheng}生效，无法成为杀的目标`);
      return logs;
    }
    if (fromSerpent) {
      logs.push("本次杀来自丈八蛇矛转化");
    }
    const ignoreArmor = attacker.weapon === CardType.QinggangSword && await this.shouldActivateOptionalEffect(attacker, CardType.QinggangSword);
    if (!fire && !ignoreArmor && target.armor === CardType.VineArmor) {
      logs.push(`${target.name} 的藤甲生效，抵消了杀`);
      return logs;
    }
    if (attacker.weapon === CardType.FemaleSword && await this.shouldActivateOptionalEffect(attacker, CardType.FemaleSword) && attacker.gender !== target.gender) {
      if (this.usableCardCount(target) > 0) {
        const decision = await this.decide({
          kind: "choose-discard",
          requestId: this.nextInteractionId(),
          playerId: target.id,
          reason: `${attacker.name} 的雌雄双股剑：弃置1张牌，或令其摸1张牌`,
          sources: this.buildUsableSources(target),
          count: 1,
          allowPass: true,
          passLabel: `令${attacker.name}摸1张牌`,
        });
        if (decision.choice === "card") {
          const removed = this.removeUsableCardBySourceId(target, decision.sourceId);
          if (removed) {
            this.discardPile.push(removed);
            logs.push(`${attacker.name} 的雌雄双股剑生效，${target.name} 弃置了 ${removed.type}`);
          }
        } else {
          const drawn = this.drawCards(attacker.id, 1);
          logs.push(`${attacker.name} 的雌雄双股剑生效，摸了 ${drawn} 张牌`);
        }
      } else {
        const drawn = this.drawCards(attacker.id, 1);
        logs.push(`${attacker.name} 的雌雄双股剑生效，摸了 ${drawn} 张牌`);
      }
    }
    if (!ignoreArmor && target.armor === CardType.EightDiagram) {
      const judgment = this.drawJudgmentCard(`${target.name} 的八卦阵`, logs);
      if (judgment?.color === "red") {
        logs.push(`${target.name} 的八卦阵判定为红色，视为打出闪`);
        return logs;
      }
    }
    let requireDodgeCount = this.hasSkill(attacker, SkillName.WuShuang) ? 2 : 1;
    if (this.hasSkill(attacker, SkillName.TieQi) && await this.shouldActivateOptionalEffect(attacker, SkillName.TieQi)) {
      const judgment = this.drawJudgmentCard(`${attacker.name} 的${SkillName.TieQi}`, logs);
      if (judgment?.color === "red") {
        requireDodgeCount = 0;
        logs.push(`${attacker.name} 的${SkillName.TieQi}判定为红色，此杀不可被闪避`);
      }
    }
    let dodged = true;
    if (requireDodgeCount > 1) {
      const available = this.countAvailableDodgeResponses(target);
      if (available < requireDodgeCount) {
        logs.push(`${target.name} 面对${SkillName.WuShuang}，需 ${requireDodgeCount} 张闪抵消，仅有 ${available} 张，未能抵消`);
        dodged = false;
      } else {
        for (let i = 0; i < requireDodgeCount; i += 1) {
          if (!(await this.consumeDodgeResponse(target, { cardName: fire ? CardType.FireSlash : CardType.Slash, actorId: attacker.id }, logs))) {
            dodged = false;
            break;
          }
        }
      }
    } else {
      for (let i = 0; i < requireDodgeCount; i += 1) {
        if (!(await this.consumeDodgeResponse(target, { cardName: fire ? CardType.FireSlash : CardType.Slash, actorId: attacker.id }, logs))) {
          dodged = false;
          break;
        }
      }
    }
    if (dodged && requireDodgeCount > 0) {
      const wushuangNote = requireDodgeCount > 1 ? `（${SkillName.WuShuang}消耗 ${requireDodgeCount} 张闪）` : "";
      logs.push(`${target.name} 打出闪，抵消了杀${wushuangNote}`);
      if (attacker.weapon === CardType.RockCleavingAxe && await this.shouldActivateOptionalEffect(attacker, CardType.RockCleavingAxe) && this.countRemovableSelfCards(attacker) >= 2) {
        logs.push(...(await this.discardSelfCards(attacker, 2)));
        logs.push(`${attacker.name} 的贯石斧生效，此次杀强制命中`);
      } else if (attacker.weapon === CardType.GreenDragonBlade && await this.shouldActivateOptionalEffect(attacker, CardType.GreenDragonBlade)) {
        const nextSlash = attacker.hand.findIndex((card) => this.isSlashCard(card.type));
        if (nextSlash >= 0) {
          const slash = attacker.hand.splice(nextSlash, 1)[0];
          if (slash) {
            this.discardPile.push(slash);
            logs.push(`${attacker.name} 的青龙偃月刀生效，追加一张杀`);
            logs.push(...(await this.resolveSlash(attacker, target, false, slash.type === CardType.FireSlash, slash.color === "red")));
            return logs;
          }
        }
        // 没有额外杀可追加，闪避有效
        return logs;
      } else {
        return logs;
      }
    }
    if (attacker.weapon === CardType.IceSword && await this.shouldActivateOptionalEffect(attacker, CardType.IceSword) && this.hasRemovableCard(target)) {
      logs.push(`${attacker.name} 的寒冰剑生效，防止本次伤害并弃置目标2张牌`);
      logs.push(...await this.removeRandomCardFromPlayer(target, "弃置"));
      if (this.hasRemovableCard(target)) {
        logs.push(...await this.removeRandomCardFromPlayer(target, "弃置"));
      }
      return logs;
    }
    let damage = 1;
    if (fire && target.armor === CardType.VineArmor) {
      damage += 1;
      logs.push(`${target.name} 的藤甲受到火焰克制，伤害+1`);
    }
    if (attacker.weapon === CardType.GudingBlade && await this.shouldActivateOptionalEffect(attacker, CardType.GudingBlade) && target.hand.length === 0) {
      damage += 1;
      logs.push(`${attacker.name} 的古锭刀生效，伤害+1`);
    }
    if (this.isSkillUsed(attacker.id, SkillName.LuoYi)) {
      damage += 1;
      logs.push(`${attacker.name} 的${SkillName.LuoYi}生效，本次杀伤害+1`);
    }
    await this.applyDamage(attacker, target, damage, "杀", logs);
    if (attacker.weapon === CardType.KylinBow && await this.shouldActivateOptionalEffect(attacker, CardType.KylinBow)) {
      const horseLogs = this.removeHorseEquip(target);
      logs.push(...horseLogs);
    }
    return logs;
  }

  private async resolveDismantle(user: Player, target: Player, selectedCardId?: string): Promise<string[]> {
    const logs = [`${user.name} 对 ${target.name} 使用过河拆桥`];
    if (await this.tryNegate(target, CardType.Dismantle, logs, user.id)) {
      return logs;
    }
    if (!this.hasRemovableCard(target)) {
      logs.push(`${target.name} 没有可拆的牌`);
      return logs;
    }
    if (selectedCardId) {
      const removedByChoice = await this.removeSelectedCardFromPlayer(target, "弃置", selectedCardId);
      if (removedByChoice.length > 0) {
        logs.push(...removedByChoice);
        return logs;
      }
    }
    logs.push(...await this.removeRandomCardFromPlayer(target, "弃置"));
    return logs;
  }

  private async resolveSnatch(user: Player, target: Player, selectedCardId?: string): Promise<string[]> {
    const logs = [`${user.name} 对 ${target.name} 使用顺手牵羊`];
    if (await this.tryNegate(target, CardType.Snatch, logs, user.id)) {
      return logs;
    }
    if (!this.hasRemovableCard(target)) {
      logs.push(`${target.name} 没有可获得的牌`);
      return logs;
    }
    if (selectedCardId) {
      const removedByChoice = await this.removeSelectedCardFromPlayer(target, "获得", selectedCardId, user);
      if (removedByChoice.length > 0) {
        logs.push(...removedByChoice);
        return logs;
      }
    }
    logs.push(...await this.removeRandomCardFromPlayer(target, "获得", user));
    return logs;
  }

  private async resolveDuel(user: Player, target: Player): Promise<string[]> {
    const logs = [`${user.name} 对 ${target.name} 发起决斗`];
    await this.triggerJiAng(user, target, true, logs);
    if (this.isKongChengProtected(target, CardType.Duel)) {
      logs.push(`${target.name} 的${SkillName.KongCheng}生效，无法成为决斗目标`);
      return logs;
    }
    if (await this.tryNegate(target, CardType.Duel, logs, user.id)) {
      return logs;
    }
    let attacker = user;
    let defender = target;
    while (true) {
      const needCount = this.hasSkill(attacker, SkillName.WuShuang) ? 2 : 1;
      let valid = true;
      const available = this.countAvailableSlashResponses(defender);
      if (available < needCount) {
        if (needCount > 1) {
          logs.push(`${defender.name} 面对${SkillName.WuShuang}，需 ${needCount} 张杀响应，仅有 ${available} 张，未能响应`);
        }
        valid = false;
      } else {
        for (let i = 0; i < needCount; i += 1) {
          if (!(await this.consumeSlashResponse(defender, { cardName: CardType.Duel, actorId: attacker.id }, logs))) {
            valid = false;
            break;
          }
        }
      }
      if (!valid) {
        let damage = 1;
        if (this.isSkillUsed(attacker.id, SkillName.LuoYi)) {
          damage += 1;
          logs.push(`${attacker.name} 的${SkillName.LuoYi}生效，本次决斗伤害+1`);
        }
        await this.applyDamage(attacker, defender, damage, "决斗", logs);
        break;
      }
      const wushuangNote = needCount > 1 ? `（${SkillName.WuShuang}消耗 ${needCount} 张杀）` : "";
      logs.push(`${defender.name} 打出杀响应决斗${wushuangNote}`);
      const swap = attacker;
      attacker = defender;
      defender = swap;
    }
    return logs;
  }

  private async resolveBarbarian(user: Player): Promise<string[]> {
    const logs = [`${user.name} 使用南蛮入侵`];
    for (const target of this.players) {
      if (!target.alive || target.id === user.id) {
        continue;
      }
      if (await this.tryNegate(target, CardType.Barbarian, logs, user.id)) {
        continue;
      }
      if (target.armor === CardType.VineArmor) {
        logs.push(`${target.name} 的藤甲生效，抵消南蛮入侵`);
        continue;
      }
      if (await this.consumeSlashResponse(target, { cardName: CardType.Barbarian, actorId: user.id }, logs)) {
        logs.push(`${target.name} 打出杀，抵消南蛮入侵`);
      } else {
        await this.applyDamage(user, target, 1, "南蛮入侵", logs);
      }
    }
    return logs;
  }

  private async resolveArrowRain(user: Player): Promise<string[]> {
    const logs = [`${user.name} 使用万箭齐发`];
    for (const target of this.players) {
      if (!target.alive || target.id === user.id) {
        continue;
      }
      if (await this.tryNegate(target, CardType.ArrowRain, logs, user.id)) {
        continue;
      }
      if (target.armor === CardType.VineArmor) {
        logs.push(`${target.name} 的藤甲生效，抵消万箭齐发`);
        continue;
      }
      if (await this.consumeDodgeResponse(target, { cardName: CardType.ArrowRain, actorId: user.id }, logs)) {
        logs.push(`${target.name} 打出闪，抵消万箭齐发`);
      } else {
        await this.applyDamage(user, target, 1, "万箭齐发", logs);
      }
    }
    return logs;
  }

  private async resolveCollateral(user: Player, target: Player): Promise<string[]> {
    const logs = [`${user.name} 对 ${target.name} 使用借刀杀人`];
    if (await this.tryNegate(target, CardType.Collateral, logs, user.id)) {
      return logs;
    }
    const slashSources = this.buildSlashSources(target);
    const victims =
      slashSources.length > 0
        ? this.players
            .filter(
              (player) =>
                player.alive &&
                player.id !== user.id &&
                player.id !== target.id &&
                this.canReachForSlash(target, player) &&
                !this.isKongChengProtected(player, CardType.Slash),
            )
            .sort((a, b) => a.hp - b.hp || a.hand.length - b.hand.length)
        : [];
    if (victims.length === 0) {
      if (target.weapon === null) {
        logs.push(`${target.name} 无法出杀且没有攻击目标`);
        return logs;
      }
      logs.push(...(await this.removeSelectedCardFromPlayer(target, "获得", "weapon", user)));
      return logs;
    }

    // Phase 1: Card user (Player A) chooses the victim
    const victimDecision = await this.decide({
      kind: "collateral",
      requestId: this.nextInteractionId(),
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
    const response = await this.decide({
      kind: "collateral",
      requestId: this.nextInteractionId(),
      targetId: target.id,
      actorId: user.id,
      victims: [chosenVictim.id],
      sources: slashSources,
      allowHandOverWeapon: target.weapon !== null,
      reason: `借刀杀人：对 ${chosenVictim.name} 使用杀？否则交出武器`,
    });
    if (response.choice === "target" && response.targetId === chosenVictim.id) {
      const sourceId = response.sourceId ?? slashSources[0]?.sourceId;
      const slash = sourceId ? this.removeUsableCardBySourceId(target, sourceId) : undefined;
      if (slash) {
        this.discardPile.push(slash);
        logs.push(`${target.name} 对 ${chosenVictim.name} 使用杀`);
        logs.push(...(await this.resolveSlash(target, chosenVictim, false, slash.type === CardType.FireSlash, slash.color === "red")));
        return logs;
      }
    }
    // Target chose to hand over weapon (or couldn't slash)
    if (target.weapon === null) {
      logs.push(`${target.name} 无法出杀且没有武器`);
      return logs;
    }
    logs.push(...(await this.removeSelectedCardFromPlayer(target, "获得", "weapon", user)));
    return logs;
  }

  private async resolveDelayedTrick(user: Player, usedCard: Card, targetId: string): Promise<string[]> {
    const logs = [`${user.name} 对 ${this.mustGetPlayer(targetId).name} 使用 ${usedCard.type}`];
    if (usedCard.type !== CardType.Lightning && await this.tryNegate(this.mustGetPlayer(targetId), usedCard.type, logs, user.id)) {
      return logs;
    }
    const target = this.mustGetPlayer(targetId);
    target.delayedTricks.push({ cardType: usedCard.type, sourcePlayerId: user.id });
    logs.push(`${target.name} 的判定区增加了 ${usedCard.type}`);
    return logs;
  }

  private async resolveDelayedJudgments(player: Player): Promise<string[]> {
    const logs: string[] = [];
    // Process in order: Lightning -> SuppliesCut -> Indulgence
    const lightningIdx = player.delayedTricks.findIndex((t) => t.cardType === CardType.Lightning);
    if (lightningIdx >= 0) {
      logs.push(...(await this.resolveSingleDelayedJudgment(player, lightningIdx)));
      if (!player.alive) return logs;
    }
    const suppliesIdx = player.delayedTricks.findIndex((t) => t.cardType === CardType.SuppliesCut);
    if (suppliesIdx >= 0) {
      logs.push(...(await this.resolveSingleDelayedJudgment(player, suppliesIdx)));
      if (!player.alive) return logs;
    }
    const indulgenceIdx = player.delayedTricks.findIndex((t) => t.cardType === CardType.Indulgence);
    if (indulgenceIdx >= 0) {
      logs.push(...(await this.resolveSingleDelayedJudgment(player, indulgenceIdx)));
    }
    return logs;
  }

  private async resolveSingleDelayedJudgment(player: Player, index: number): Promise<string[]> {
    const logs: string[] = [];
    const trick = player.delayedTricks[index];
    if (!trick) return logs;
    player.delayedTricks.splice(index, 1);

    const judgment = this.drawJudgmentCard(`${player.name} 的 ${trick.cardType}`, logs);
    if (!judgment) return logs;

    if (trick.cardType === CardType.Lightning) {
      if (judgment.suit === "spade" && judgment.rank >= 2 && judgment.rank <= 9) {
        logs.push(`${player.name} 的闪电判定为黑桃${judgment.rank}，受到 3 点雷电伤害`);
        await this.applyDamage(player, player, 3, "闪电", logs);
      } else {
        logs.push(`${player.name} 的闪电判定未命中`);
        const alivePlayers = this.players.filter((p) => p.alive);
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
        this.skipDrawPhase = player.id;
      } else {
        logs.push(`${player.name} 的兵粮寸断判定为梅花，不生效`);
      }
    } else if (trick.cardType === CardType.Indulgence) {
      if (judgment.suit !== "heart") {
        logs.push(`${player.name} 的乐不思蜀生效，跳过出牌阶段`);
        this.skipPlayPhase = player.id;
      } else {
        logs.push(`${player.name} 的乐不思蜀判定为红桃，不生效`);
      }
    }
    return logs;
  }

  private resolvePeachGarden(user: Player): string[] {
    const logs = [`${user.name} 使用桃园结义`];
    for (const target of this.players) {
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

  private resolveHarvest(user: Player): string[] {
    const logs = [`${user.name} 使用五谷丰登`];
    for (const target of this.players) {
      if (!target.alive) {
        continue;
      }
      const drawn = this.drawCards(target.id, 1);
      logs.push(`${target.name} 摸了 ${drawn} 张牌`);
    }
    return logs;
  }

  private async resolveEquip(user: Player, equipType: EquipCardType): Promise<string[]> {
    const logs: string[] = [];
    if (this.isWeaponCard(equipType)) {
      const previous = user.weapon;
      user.weapon = equipType;
      if (previous !== null) {
        this.discardPile.push(this.createCard(previous, `replace-${this.turn}`));
        logs.push(`${user.name} 的旧武器 ${previous} 被替换并弃置`);
        logs.push(...(await this.onLoseEquip(user, previous)));
      }
      logs.push(`${user.name} 装备了${equipType}`);
      return logs;
    }
    if (this.isArmorCard(equipType)) {
      const previous = user.armor;
      user.armor = equipType;
      if (previous !== null) {
        this.discardPile.push(this.createCard(previous, `replace-${this.turn}`));
        logs.push(`${user.name} 的旧防具 ${previous} 被替换并弃置`);
        logs.push(...(await this.onLoseEquip(user, previous)));
      }
      logs.push(`${user.name} 装备了${equipType}`);
      return logs;
    }
    if (this.isDefenseHorseCard(equipType)) {
      const previous = user.defenseHorse;
      user.defenseHorse = equipType;
      if (previous !== null) {
        this.discardPile.push(this.createCard(previous, `replace-${this.turn}`));
        logs.push(`${user.name} 的旧+1马 ${previous} 被替换并弃置`);
      }
      logs.push(`${user.name} 装备了${equipType}`);
      return logs;
    }
    if (this.isAttackHorseCard(equipType)) {
      const previous = user.attackHorse;
      user.attackHorse = equipType;
      if (previous !== null) {
        this.discardPile.push(this.createCard(previous, `replace-${this.turn}`));
        logs.push(`${user.name} 的旧-1马 ${previous} 被替换并弃置`);
      }
      logs.push(`${user.name} 装备了${equipType}`);
      return logs;
    }
    const previous = user.treasure;
    user.treasure = equipType;
    if (previous !== null) {
      this.discardPile.push(this.createCard(previous, `replace-${this.turn}`));
      logs.push(`${user.name} 的旧宝物 ${previous} 被替换并弃置`);
    }
    logs.push(`${user.name} 装备了${equipType}`);
    return logs;
  }

  private async resolveDeaths(): Promise<string[]> {
    if (this.deferDyingResolution) return [];
    const logs: string[] = [];
    for (const player of this.players) {
      if (!player.alive) {
        continue;
      }
      if (player.hp > 0) {
        continue;
      }
      if (await this.consumePeachResponse(player, player.id, logs)) {
        player.hp = 1;
        logs.push(`${player.name} 打出桃自救，体力恢复到 1`);
        continue;
      }
      let rescued = false;
      const rescuers = this.getRescuersInOrder(player);
      for (const rescuer of rescuers) {
        if (!(await this.consumePeachResponse(rescuer, player.id, logs))) continue;
        let recovered = 1;
        if (
          this.hasSkill(player, SkillName.JiuYuan) &&
          player.role === PlayerRole.Lord &&
          this.getPlayerKingdom(rescuer) === "吴"
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
  }

  private getPlayerKingdom(player: Player): "魏" | "蜀" | "吴" | "群雄" {
    return this.resolveGeneralByName(player.general).kingdom;
  }

  private getKingdomRespondersInOrder(
    requester: Player,
    kingdom: "魏" | "蜀" | "吴" | "群雄",
  ): Player[] {
    const start = this.players.findIndex((item) => item.id === requester.id);
    const ordered: Player[] = [];
    for (let i = 1; i < this.players.length; i += 1) {
      const index = (start + i) % this.players.length;
      const candidate = this.players[index];
      if (!candidate || !candidate.alive || candidate.id === requester.id) {
        continue;
      }
      if (this.getPlayerKingdom(candidate) !== kingdom) {
        continue;
      }
      ordered.push(candidate);
    }
    return ordered;
  }

  private getRescuersInOrder(target: Player): Player[] {
    const start = this.players.findIndex((item) => item.id === target.id);
    const ordered: Player[] = [];
    for (let i = 1; i < this.players.length; i += 1) {
      const index = (start + i) % this.players.length;
      const candidate = this.players[index];
      if (!candidate || !candidate.alive || candidate.id === target.id) {
        continue;
      }
      ordered.push(candidate);
    }
    return ordered;
  }

  private resolveWinner(): string[] {
    const alivePlayers = this.players.filter((player) => player.alive);
    if (alivePlayers.length === 0) {
      this.winner = "draw";
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
      const human = this.players.find((player) => !player.isAI);
      const humanWin =
        human !== undefined &&
        (winRole === "lord-side"
          ? human.role === PlayerRole.Lord || human.role === PlayerRole.Loyalist
          : human.role === winRole);
      this.winner = humanWin ? "human" : "ai";
    }
    if (this.winner === null) {
      return [];
    }
    if (this.winner === "draw") {
      return ["全员阵亡，平局"];
    }
    const human = this.players.find((player) => !player.isAI);
    if (this.winner === "human") {
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

  private drawJudgmentCard(reason: string, logs: string[]): Card | null {
    const card = this.drawCard();
    if (!card) {
      logs.push(`${reason}无法判定：牌堆为空`);
      return null;
    }
    this.discardPile.push(card);
    const suitNames = { heart: "红桃", diamond: "方片", club: "梅花", spade: "黑桃", none: "无花色" } as const;
    logs.push(`${reason}判定牌：${suitNames[card.suit]}${card.rank} ${card.type}`);
    return card;
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
    if (cardType === CardType.Dismantle || cardType === CardType.Snatch) {
      return targets.filter((id) => this.hasRemovableCard(this.mustGetPlayer(id)));
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
      return targets.filter((id) => {
        const holder = this.mustGetPlayer(id);
        return !holder.delayedTricks.some((t) => t.cardType === cardType);
      });
    }
    return targets;
  }

  private canReachForSlash(attacker: Player, target: Player): boolean {
    const distance = this.computeDistance(attacker, target);
    return distance <= this.getAttackRange(attacker);
  }

  private getAttackRange(player: Player): number {
    if (!player.weapon) {
      return 1;
    }
    if (
      player.weapon === CardType.Crossbow ||
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

  private computeDistance(attacker: Player, target: Player): number {
    const alivePlayers = this.players.filter((player) => player.alive);
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
    if (this.hasSkill(attacker, SkillName.MaShu)) {
      distance -= 1;
    }
    if (target.defenseHorse !== null) {
      distance += 1;
    }
    return Math.max(1, distance);
  }

  private async expandSlashTargets(player: Player, primary: Player, isLastHandSlash: boolean): Promise<Player[]> {
    if (player.weapon !== CardType.Halberd || !await this.shouldActivateOptionalEffect(player, CardType.Halberd) || !isLastHandSlash) {
      return [primary];
    }
    const extras = this.players
      .filter(
        (item) =>
          item.alive &&
          item.id !== player.id &&
          item.id !== primary.id &&
          this.canReachForSlash(player, item) &&
          !this.isKongChengProtected(item, CardType.Slash),
      )
      .sort((a, b) => a.hp - b.hp || a.hand.length - b.hand.length)
      .slice(0, 2);
    return [primary, ...extras];
  }

  private countRemovableSelfCards(player: Player): number {
    return (
      player.hand.length +
      (player.weapon ? 1 : 0) +
      (player.armor ? 1 : 0) +
      (player.defenseHorse ? 1 : 0) +
      (player.attackHorse ? 1 : 0) +
      (player.treasure ? 1 : 0)
    );
  }

  private countDirectDodgeSources(player: Player): number {
    let count = player.hand.filter((card) => card.type === CardType.Dodge).length;
    if (this.hasSkill(player, SkillName.QingGuo)) {
      count += player.hand.filter((card) => card.color === "black" && card.type !== CardType.Dodge).length;
    }
    if (this.hasSkill(player, SkillName.LongDan)) {
      count += player.hand.filter((card) => this.isSlashCard(card.type)).length;
    }
    return count;
  }

  private countAvailableDodgeResponses(player: Player): number {
    let count = this.countDirectDodgeSources(player);
    if (player.role === PlayerRole.Lord && this.hasSkill(player, SkillName.HuJia)) {
      for (const responder of this.getKingdomRespondersInOrder(player, "魏")) {
        count += this.countDirectDodgeSources(responder);
      }
    }
    return count;
  }

  private countDirectSlashSources(player: Player): number {
    let count = player.hand.filter((card) => this.isSlashCard(card.type)).length;
    if (this.hasSkill(player, SkillName.WuSheng)) {
      count += player.hand.filter((card) => card.color === "red" && !this.isSlashCard(card.type)).length;
    }
    if (this.hasSkill(player, SkillName.LongDan)) {
      count += player.hand.filter((card) => card.type === CardType.Dodge).length;
    }
    return count;
  }

  private countAvailableSlashResponses(player: Player): number {
    let count = this.countDirectSlashSources(player);
    if (player.role === PlayerRole.Lord && this.hasSkill(player, SkillName.JiJiang)) {
      for (const responder of this.getKingdomRespondersInOrder(player, "蜀")) {
        count += this.countDirectSlashSources(responder);
      }
    }
    return count;
  }

  private async discardSelfCards(player: Player, count: number): Promise<string[]> {
    const logs: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const removedLogs = await this.removeRandomCardFromPlayer(player, "弃置");
      logs.push(...removedLogs);
    }
    return Promise.resolve(logs);
  }

  private removeHorseEquip(player: Player): string[] {
    if (player.defenseHorse !== null) {
      const removed = player.defenseHorse;
      player.defenseHorse = null;
      this.discardPile.push(this.createCard(removed, `kylin-${this.turn}`));
      return [`麒麟弓生效，${player.name} 的 ${removed} 被弃置`];
    }
    if (player.attackHorse !== null) {
      const removed = player.attackHorse;
      player.attackHorse = null;
      this.discardPile.push(this.createCard(removed, `kylin-${this.turn}`));
      return [`麒麟弓生效，${player.name} 的 ${removed} 被弃置`];
    }
    return [];
  }

  private async consumeDodgeResponse(
    player: Player,
    trigger: { cardName: string; actorId: string },
    logs: string[],
  ): Promise<boolean> {
    if (!this.canPlayerRespond(player.id, "dodge")) {
      this.setPlayerResponseSelection(player.id, "dodge", null);
      return false;
    }
    if (await this.requestCardResponse(player, "dodge", trigger, logs)) {
      return true;
    }
    if (player.role !== PlayerRole.Lord || !this.hasSkill(player, SkillName.HuJia)) {
      return false;
    }
    const responders = this.getKingdomRespondersInOrder(player, "魏");
    for (const responder of responders) {
      if (await this.requestCardResponse(responder, "dodge", trigger, logs)) {
        logs.push(`${player.name} 的${SkillName.HuJia}生效，${responder.name}为其提供了${CardType.Dodge}`);
        return true;
      }
    }
    return false;
  }

  private async consumeSlashResponse(
    player: Player,
    trigger: { cardName: string; actorId: string },
    logs: string[],
  ): Promise<boolean> {
    if (!this.canPlayerRespond(player.id, "slash")) {
      this.setPlayerResponseSelection(player.id, "slash", null);
      return false;
    }
    if (await this.requestCardResponse(player, "slash", trigger, logs)) {
      return true;
    }
    if (player.role !== PlayerRole.Lord || !this.hasSkill(player, SkillName.JiJiang)) {
      return false;
    }
    const responders = this.getKingdomRespondersInOrder(player, "蜀");
    for (const responder of responders) {
      if (await this.requestCardResponse(responder, "slash", trigger, logs)) {
        logs.push(`${player.name} 的${SkillName.JiJiang}生效，${responder.name}为其提供了${CardType.Slash}`);
        return true;
      }
    }
    return false;
  }

  private async onLoseEquip(player: Player, equip: EquipCardType): Promise<string[]> {
    const logs: string[] = [];
    if (this.hasSkill(player, SkillName.XiaoJi) && await this.shouldActivateOptionalEffect(player, SkillName.XiaoJi)) {
      const drawn = this.drawCards(player.id, 2);
      if (drawn > 0) {
        logs.push(`${player.name} 的${SkillName.XiaoJi}生效，摸了 ${drawn} 张牌`);
      }
    }
    if (equip === CardType.SilverLion && player.hp < player.maxHp) {
      player.hp += 1;
      logs.push(`${player.name} 失去白银狮子，回复 1 点体力`);
    }
    return logs;
  }

  private createCard(type: CardType, seed: string): Card {
    return { id: `${type}-${seed}-${this.turn}`, type, color: "colorless", suit: "none", rank: 0 };
  }

  private isDelayedTrickCard(cardType: CardType): boolean {
    return cardType === CardType.Indulgence || cardType === CardType.SuppliesCut || cardType === CardType.Lightning;
  }

  private isNonDelayedTrickCard(cardType: CardType): boolean {
    return (
      cardType === CardType.Dismantle ||
      cardType === CardType.Snatch ||
      cardType === CardType.Duel ||
      cardType === CardType.ExNihilo ||
      cardType === CardType.Barbarian ||
      cardType === CardType.ArrowRain ||
      cardType === CardType.Collateral ||
      cardType === CardType.PeachGarden ||
      cardType === CardType.Harvest
    );
  }

  private isKongChengProtected(target: Player, cardType: CardType): boolean {
    if (!this.hasSkill(target, SkillName.KongCheng)) {
      return false;
    }
    if (target.hand.length > 0) {
      return false;
    }
    return this.isSlashCard(cardType) || cardType === CardType.Duel;
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

  private pickBestAiAction(actions: GameAction[], playerId: string): GameAction | null {
    const player = this.mustGetPlayer(playerId);
    const assault = actions.find((action) => action.type === "skill" && action.skill === SkillName.Assault);
    if (assault && player.hp <= 2) {
      return assault;
    }
    const playable = actions.filter((action) => action.type === "play");
    const emergencyPeach = playable.find((action) => {
      if (action.type !== "play") {
        return false;
      }
      const card = player.hand[action.cardIndex];
      return card?.type === CardType.Peach && player.hp <= 2;
    });
    if (emergencyPeach) {
      return emergencyPeach;
    }
    const slash = playable.find((action) => {
      if (action.type !== "play") {
        return false;
      }
      const card = player.hand[action.cardIndex];
      return card ? this.isSlashCard(card.type) : false;
    });
    if (slash) {
      return slash;
    }
    const equip = playable.find((action) => {
      if (action.type !== "play") {
        return false;
      }
      const card = player.hand[action.cardIndex];
      if (!card) {
        return false;
      }
      return this.shouldEquip(player, card.type);
    });
    if (equip) {
      return equip;
    }
    const massAttack = playable.find((action) => {
      if (action.type !== "play") {
        return false;
      }
      const card = player.hand[action.cardIndex];
      return card?.type === CardType.Barbarian || card?.type === CardType.ArrowRain;
    });
    if (massAttack) {
      return massAttack;
    }
    const duel = playable.find((action) => {
      if (action.type !== "play") {
        return false;
      }
      const card = player.hand[action.cardIndex];
      return card?.type === CardType.Duel;
    });
    if (duel) {
      return duel;
    }
    const exNihilo = playable.find((action) => {
      if (action.type !== "play") {
        return false;
      }
      const card = player.hand[action.cardIndex];
      return card?.type === CardType.ExNihilo;
    });
    if (exNihilo) {
      return exNihilo;
    }
    const groupBenefit = playable.find((action) => {
      if (action.type !== "play") {
        return false;
      }
      const card = player.hand[action.cardIndex];
      return card?.type === CardType.PeachGarden || card?.type === CardType.Harvest;
    });
    if (groupBenefit) {
      return groupBenefit;
    }
    const collateral = playable.find((action) => {
      if (action.type !== "play") {
        return false;
      }
      const card = player.hand[action.cardIndex];
      return card?.type === CardType.Collateral;
    });
    if (collateral) {
      return collateral;
    }
    const dismantle = playable.find((action) => {
      if (action.type !== "play") {
        return false;
      }
      const card = player.hand[action.cardIndex];
      return card?.type === CardType.Dismantle;
    });
    if (dismantle) {
      return dismantle;
    }
    const anyPlay = playable[0];
    if (anyPlay) {
      return anyPlay;
    }
    const end = actions.find((action) => action.type === "end");
    return end ?? null;
  }

  private pickBestTarget(targets: string[]): string | undefined {
    const candidates = targets
      .map((id) => this.mustGetPlayer(id))
      .sort((a, b) => a.hp - b.hp || a.hand.length - b.hand.length);
    return candidates[0]?.id;
  }

  private cardNeedsTarget(cardType: CardType): boolean {
    return (
      this.isSlashCard(cardType) ||
      cardType === CardType.Dismantle ||
      cardType === CardType.Snatch ||
      cardType === CardType.Duel ||
      cardType === CardType.Collateral ||
      cardType === CardType.Indulgence ||
      cardType === CardType.SuppliesCut
    );
  }

  private shouldEquip(player: Player, cardType: CardType): boolean {
    if (this.isWeaponCard(cardType)) {
      return true;
    }
    if (this.isArmorCard(cardType)) {
      return true;
    }
    if (this.isDefenseHorseCard(cardType) || this.isAttackHorseCard(cardType) || this.isTreasureCard(cardType)) {
      return true;
    }
    return this.isEquipCard(cardType);
  }

  private async tryNegate(target: Player, trickType: CardType, logs: string[], actorId = ""): Promise<boolean> {
    if (!this.canPlayerRespond(target.id, "negate")) {
      return false;
    }
    const negated = await this.requestCardResponse(target, "negate", { cardName: trickType, actorId }, logs);
    if (negated) {
      logs.push(`${target.name} 打出无懈可击，抵消了 ${trickType}`);
    }
    return negated;
  }

  private canPlayerRespond(playerId: string, kind: ResponseKind): boolean {
    const policy = this.responsePolicyByPlayer.get(playerId);
    if (!policy) {
      return true;
    }
    const allowed = policy[kind];
    return allowed !== false;
  }

  private consumeSelectedResponse(player: Player, kind: ResponseKind, optionId: string, logs: string[]): boolean {
    let cardId = optionId;
    if (optionId.startsWith("qingguo:") || optionId.startsWith("wusheng:") || optionId.startsWith("longdan:")) {
      cardId = optionId.slice(optionId.indexOf(":") + 1);
    }
    const handSourceId = `hand:${cardId}`;
    if (this.peekUsableCard(player, handSourceId)) {
      return this.consumeResponseCard(player, kind, handSourceId, logs);
    }
    const treasureSourceId = `treasure:${cardId}`;
    if (this.peekUsableCard(player, treasureSourceId)) {
      return this.consumeResponseCard(player, kind, treasureSourceId, logs);
    }
    return false;
  }

  private async consumePeachResponse(player: Player, dyingPlayerId: string, logs: string[]): Promise<boolean> {
    const targetedDecisions = this.peachDecisions.get(dyingPlayerId);
    if (targetedDecisions?.has(player.id)) {
      const optionId = targetedDecisions.get(player.id);
      if (optionId === null || optionId === undefined) return false;
      return this.consumeSelectedResponse(player, "peach", optionId, logs);
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

  private hasRemovableCard(player: Player): boolean {
    return (
      player.hand.length > 0 ||
      player.weapon !== null ||
      player.armor !== null ||
      player.defenseHorse !== null ||
      player.attackHorse !== null ||
      player.treasure !== null
    );
  }

  private async removeRandomCardFromPlayer(player: Player, mode: "弃置" | "获得", receiver?: Player): Promise<string[]> {
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
    const picked = options[this.randomIndex(options.length)];
    if (!picked) {
      return Promise.resolve([]);
    }
    return await this.removeSelectedCardFromPlayer(player, mode, picked, receiver);
  }

  private async removeSelectedCardFromPlayer(
    player: Player,
    mode: "弃置" | "获得",
    selectedCardId: string,
    receiver?: Player,
  ): Promise<string[]> {
    if (selectedCardId === "hand-random") {
      if (player.hand.length === 0) {
        return Promise.resolve([]);
      }
      const index = this.randomIndex(player.hand.length);
      const removed = player.hand.splice(index, 1)[0];
      if (!removed) {
        return Promise.resolve([]);
      }
      if (mode === "获得" && receiver) {
        receiver.hand.push(removed);
        return Promise.resolve([`${receiver.name} 获得了 ${player.name} 的 1 张手牌`]);
      }
      this.discardPile.push(removed);
      return Promise.resolve([`${player.name} 的 1 张手牌被弃置`]);
    }
    if (selectedCardId.startsWith("hand:")) {
      const handCardId = selectedCardId.slice(5);
      const index = player.hand.findIndex((card) => card.id === handCardId);
      if (index < 0) {
        return Promise.resolve([]);
      }
      const removed = player.hand.splice(index, 1)[0];
      if (!removed) {
        return Promise.resolve([]);
      }
      if (mode === "获得" && receiver) {
        receiver.hand.push(removed);
        return Promise.resolve([`${receiver.name} 获得了 ${player.name} 的手牌 ${removed.type}`]);
      }
      this.discardPile.push(removed);
      return Promise.resolve([`${player.name} 的手牌 ${removed.type} 被弃置`]);
    }
    if (selectedCardId === "weapon") {
      const removedWeapon = player.weapon;
      player.weapon = null;
      if (removedWeapon === null) {
        return Promise.resolve([]);
      }
      if (mode === "获得" && receiver) {
        receiver.hand.push(this.createCard(removedWeapon, `loot-${this.turn}`));
        return Promise.resolve([`${receiver.name} 获得了 ${player.name} 的装备 ${removedWeapon}`]);
      }
      this.discardPile.push(this.createCard(removedWeapon, `discard-${this.turn}`));
      return Promise.resolve([`${player.name} 的装备 ${removedWeapon} 被弃置`]);
    }
    if (selectedCardId === "armor") {
      const removedArmor = player.armor;
      player.armor = null;
      if (removedArmor === null) {
        return Promise.resolve([]);
      }
      const logs: string[] = [];
      if (mode === "获得" && receiver) {
        receiver.hand.push(this.createCard(removedArmor, `loot-${this.turn}`));
        logs.push(`${receiver.name} 获得了 ${player.name} 的装备 ${removedArmor}`);
      } else {
        this.discardPile.push(this.createCard(removedArmor, `discard-${this.turn}`));
        logs.push(`${player.name} 的装备 ${removedArmor} 被弃置`);
      }
      return this.onLoseEquip(player, removedArmor).then((equipLogs) => [...logs, ...equipLogs]);
    }
    if (selectedCardId === "defenseHorse") {
      const removed = player.defenseHorse;
      player.defenseHorse = null;
      if (removed === null) {
        return Promise.resolve([]);
      }
      if (mode === "获得" && receiver) {
        receiver.hand.push(this.createCard(removed, `loot-${this.turn}`));
        return Promise.resolve([`${receiver.name} 获得了 ${player.name} 的装备 ${removed}`]);
      }
      this.discardPile.push(this.createCard(removed, `discard-${this.turn}`));
      return Promise.resolve([`${player.name} 的装备 ${removed} 被弃置`]);
    }
    if (selectedCardId === "attackHorse") {
      const removed = player.attackHorse;
      player.attackHorse = null;
      if (removed === null) {
        return Promise.resolve([]);
      }
      if (mode === "获得" && receiver) {
        receiver.hand.push(this.createCard(removed, `loot-${this.turn}`));
        return Promise.resolve([`${receiver.name} 获得了 ${player.name} 的装备 ${removed}`]);
      }
      this.discardPile.push(this.createCard(removed, `discard-${this.turn}`));
      return Promise.resolve([`${player.name} 的装备 ${removed} 被弃置`]);
    }
    if (selectedCardId !== "treasure") {
      return Promise.resolve([]);
    }
    const removedTreasure = player.treasure;
    player.treasure = null;
    if (removedTreasure === null) {
      return Promise.resolve([]);
    }
    if (mode === "获得" && receiver) {
      receiver.hand.push(this.createCard(removedTreasure, `loot-${this.turn}`));
      return Promise.resolve([`${receiver.name} 获得了 ${player.name} 的装备 ${removedTreasure}`]);
    }
    this.discardPile.push(this.createCard(removedTreasure, `discard-${this.turn}`));
    return Promise.resolve([`${player.name} 的装备 ${removedTreasure} 被弃置`]);
  }

  private isWeaponCard(cardType: CardType): cardType is WeaponType {
    return (
      cardType === CardType.Crossbow ||
      cardType === CardType.FemaleSword ||
      cardType === CardType.QinggangSword ||
      cardType === CardType.IceSword ||
      cardType === CardType.GudingBlade ||
      cardType === CardType.SerpentSpear ||
      cardType === CardType.GreenDragonBlade ||
      cardType === CardType.RockCleavingAxe ||
      cardType === CardType.Halberd ||
      cardType === CardType.KylinBow
    );
  }

  private isArmorCard(cardType: CardType): cardType is ArmorType {
    return (
      cardType === CardType.EightDiagram ||
      cardType === CardType.VineArmor ||
      cardType === CardType.SilverLion
    );
  }

  private isSlashCard(cardType: CardType): boolean {
    return cardType === CardType.Slash || cardType === CardType.FireSlash;
  }

  private isDefenseHorseCard(cardType: CardType): cardType is DefenseHorseType {
    return cardType === CardType.Dilu || cardType === CardType.JueYing || cardType === CardType.ZhuaHuangFeiDian;
  }

  private isAttackHorseCard(cardType: CardType): cardType is AttackHorseType {
    return cardType === CardType.ChiTu || cardType === CardType.DaYuan || cardType === CardType.ZiXing;
  }

  private isTreasureCard(cardType: CardType): cardType is TreasureType {
    return cardType === CardType.WoodenOx;
  }

  private isEquipCard(cardType: CardType): cardType is EquipCardType {
    return (
      this.isWeaponCard(cardType) ||
      this.isArmorCard(cardType) ||
      this.isDefenseHorseCard(cardType) ||
      this.isAttackHorseCard(cardType) ||
      this.isTreasureCard(cardType)
    );
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

  private getAiName(index: number): string {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const first = alphabet[index % alphabet.length] ?? "A";
    const cycle = Math.floor(index / alphabet.length);
    if (cycle === 0) {
      return first;
    }
    return `${first}${cycle + 1}`;
  }

  private createPlayer(
    id: string,
    name: string,
    isAI: boolean,
    general: GeneralDefinition,
    role: PlayerRole,
  ): Player {
    const tail = id.split("-").pop() ?? "0";
    const index = Number.parseInt(tail, 10);
    const gender: "男" | "女" = !isAI ? "男" : Number.isNaN(index) || index % 2 === 0 ? "男" : "女";
    return {
      id,
      name,
      role,
      gender,
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
    };
  }

  private buildRoleList(playerCount: number): PlayerRole[] {
    if (playerCount === 2) {
      return [PlayerRole.Lord, PlayerRole.Rebel];
    }
    if (playerCount === 3) {
      return [PlayerRole.Lord, PlayerRole.Rebel, PlayerRole.Traitor];
    }
    if (playerCount === 4) {
      return [PlayerRole.Lord, PlayerRole.Loyalist, PlayerRole.Rebel, PlayerRole.Traitor];
    }
    if (playerCount === 5) {
      return [PlayerRole.Lord, PlayerRole.Loyalist, PlayerRole.Rebel, PlayerRole.Rebel, PlayerRole.Traitor];
    }
    if (playerCount === 6) {
      return [
        PlayerRole.Lord,
        PlayerRole.Loyalist,
        PlayerRole.Rebel,
        PlayerRole.Rebel,
        PlayerRole.Rebel,
        PlayerRole.Traitor,
      ];
    }
    return [PlayerRole.Lord, PlayerRole.Loyalist, PlayerRole.Rebel, PlayerRole.Rebel, PlayerRole.Traitor];
  }

  private resolveGeneralByName(generalName: string): GeneralDefinition {
    const found = [...GENERAL_LIBRARY, ...disabledGeneralDefinitions].find((item) => item.name === generalName);
    if (found) {
      return found;
    }
    return humanGeneral;
  }

  private getRoleDistribution(roles: PlayerRole[]): { rebel: number; loyalist: number; traitor: number } {
    let rebel = 0;
    let loyalist = 0;
    let traitor = 0;
    for (const role of roles) {
      if (role === PlayerRole.Rebel) {
        rebel += 1;
      } else if (role === PlayerRole.Loyalist) {
        loyalist += 1;
      } else if (role === PlayerRole.Traitor) {
        traitor += 1;
      }
    }
    return { rebel, loyalist, traitor };
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

  private discardFromPlayerHand(player: Player, count: number, logs: string[]): number {
    let discarded = 0;
    for (let i = 0; i < count && player.hand.length > 0; i += 1) {
      const index = this.randomIndex(player.hand.length);
      const removed = player.hand.splice(index, 1)[0];
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

  private pickRandomUnusedGeneral(usedGeneralNames: Set<string>): GeneralDefinition {
    const candidates = GENERAL_LIBRARY.filter((general) => !usedGeneralNames.has(general.name));
    if (candidates.length <= 0) {
      const fallback = GENERAL_LIBRARY[this.randomIndex(GENERAL_LIBRARY.length)];
      return fallback ?? humanGeneral;
    }
    const picked = candidates[this.randomIndex(candidates.length)];
    return picked ?? humanGeneral;
  }

  private async useSkillAction(
    playerId: string,
    action: Extract<GameAction, { type: "skill" }>,
    targetId?: string,
  ): Promise<string[]> {
    const player = this.mustGetPlayer(playerId);
    if (!player.alive || player.id !== this.currentPlayer.id || this.phase !== TurnPhase.Play) {
      return [];
    }
    if (action.skill === SkillName.Assault) {
      if (!this.canUseAssault(player)) {
        return [`${player.name} 当前无法发动${SkillName.Assault}`];
      }
      if (!targetId) {
        return ["需要选择目标"];
      }
      const target = this.mustGetPlayer(targetId);
      if (!target.alive || target.id === player.id) {
        return ["目标无效"];
      }
      const [discarded] = await this.requestDiscardSelection(player, 1, `发动：选择弃置1张牌`);
      if (!discarded) {
        return [` 没有可弃置手牌`];
      }
      this.discardPile.push(discarded);
      this.markSkillUsed(player.id, SkillName.Assault);
      const logs = [` 发动，弃置 `];
      await this.applyDamage(player, target, 1, SkillName.Assault, logs);
      logs.push(...(await this.resolveDeaths()));
      logs.push(...this.resolveWinner());
      await this.advanceIfCurrentPlayerDead(logs);
      return logs;
    }
    if (action.skill === SkillName.ZhiHeng) {
      if (!this.canUseZhiHeng(player)) {
        return [`${player.name} 当前无法发动${SkillName.ZhiHeng}`];
      }
      const discardCount = player.hand.length;
      if (discardCount <= 0) {
        return [`${player.name} 没有可弃置手牌`];
      }
      const discarded = player.hand.splice(0, discardCount);
      this.discardPile.push(...discarded);
      const drawn = this.drawCards(player.id, discardCount);
      this.markSkillUsed(player.id, SkillName.ZhiHeng);
      return [`${player.name} 发动${SkillName.ZhiHeng}，弃置 ${discardCount} 张并摸了 ${drawn} 张牌`];
    }
    if (action.skill === SkillName.QingNang) {
      if (!this.canUseQingNang(player)) {
        return [`${player.name} 当前无法发动${SkillName.QingNang}`];
      }
      if (!targetId) {
        return ["需要选择目标"];
      }
      const target = this.mustGetPlayer(targetId);
      if (!target.alive || target.hp >= target.maxHp) {
        return ["目标无效"];
      }
      const [discarded] = await this.requestDiscardSelection(player, 1, `发动：选择弃置1张手牌`);
      if (!discarded) {
        return [` 没有可弃置手牌`];
      }
      this.discardPile.push(discarded);
      target.hp = Math.min(target.maxHp, target.hp + 1);
      this.markSkillUsed(player.id, SkillName.QingNang);
      return [` 发动，弃置 ，令回复 1 点体力`];
    }
    if (action.skill === SkillName.KuRou) {
      if (!this.canUseKuRou(player)) {
        return [`${player.name} 当前无法发动${SkillName.KuRou}`];
      }
      player.hp -= 1;
      const drawn = this.drawCards(player.id, 2);
      const logs = [`${player.name} 发动${SkillName.KuRou}，失去 1 点体力并摸了 ${drawn} 张牌`];
      logs.push(...(await this.resolveDeaths()));
      logs.push(...this.resolveWinner());
      await this.advanceIfCurrentPlayerDead(logs);
      return logs;
    }
    if (action.skill === SkillName.FanJian) {
      if (!this.canUseFanJian(player)) {
        return [`${player.name} 当前无法发动${SkillName.FanJian}`];
      }
      if (!targetId) {
        return ["需要选择目标"];
      }
      const target = this.mustGetPlayer(targetId);
      if (!target.alive || target.id === player.id) {
        return ["目标无效"];
      }
      const suitOptions: Card["suit"][] = ["heart", "diamond", "club", "spade"];
      const suitDecision = await this.decide({
        kind: "choose-suit",
        requestId: this.nextInteractionId(),
        playerId: target.id,
        reason: `${player.name} 对你发动${SkillName.FanJian}：请声明1种花色`,
        suits: suitOptions,
      });
      const declaredSuit =
        suitDecision.choice === "suit" && suitOptions.includes(suitDecision.suit)
          ? suitDecision.suit
          : suitOptions[this.randomIndex(suitOptions.length)] ?? "heart";
      const pickDecision = await this.decide({
        kind: "choose-discard",
        requestId: this.nextInteractionId(),
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
          ? this.removeUsableCardBySourceId(player, pickDecision.sourceId) ??
            player.hand.splice(this.randomIndex(player.hand.length), 1)[0]
          : player.hand.splice(this.randomIndex(player.hand.length), 1)[0];
      if (!card) {
        return [`${player.name} 没有可交给目标的手牌`];
      }
      target.hand.push(card);
      this.markSkillUsed(player.id, SkillName.FanJian);
      const suitNames = { heart: "红桃", diamond: "方片", club: "梅花", spade: "黑桃", none: "无花色" } as const;
      const logs = [
        `${player.name} 发动${SkillName.FanJian}，${target.name} 声明${suitNames[declaredSuit]}并获得 ${card.type}`,
      ];
      if (card.suit !== declaredSuit) {
        await this.applyDamage(player, target, 1, SkillName.FanJian, logs);
        logs.push(...(await this.resolveDeaths()));
        logs.push(...this.resolveWinner());
        await this.advanceIfCurrentPlayerDead(logs);
      } else {
        logs.push(`${card.type} 的花色与声明相同，${target.name} 未受到伤害`);
      }
      return logs;
    }
    if (action.skill === SkillName.ZhiBa) {
      const lord = this.getLordWithZhiBa();
      if (!lord || !this.canUseZhiBa(player)) {
        return [`${player.name} 当前无法发动${SkillName.ZhiBa}`];
      }
      if (lord.skills.includes(SkillName.YingHun)) {
        this.markSkillUsed(player.id, SkillName.ZhiBa);
        return [`${lord.name} 已觉醒，拒绝${player.name} 的${SkillName.ZhiBa}拼点`];
      }
      const attackerIndex = this.randomIndex(player.hand.length);
      const attackerCard = player.hand.splice(attackerIndex, 1)[0];
      const lordIndex = this.randomIndex(lord.hand.length);
      const lordCard = lord.hand.splice(lordIndex, 1)[0];
      this.markSkillUsed(player.id, SkillName.ZhiBa);
      const logs = [
        `${player.name} 发动${SkillName.ZhiBa}，与${lord.name}拼点`,
        `${player.name} 拼点牌：${attackerCard?.type}（点数 ${attackerCard?.rank}）`,
        `${lord.name} 拼点牌：${lordCard?.type}（点数 ${lordCard?.rank}）`,
      ];
      const attackerWon = attackerCard && lordCard && attackerCard.rank > lordCard.rank;
      if (attackerWon) {
        if (attackerCard) this.discardPile.push(attackerCard);
        if (lordCard) this.discardPile.push(lordCard);
        logs.push(`${player.name} 拼点获胜，两张拼点牌置入弃牌堆`);
      } else {
        if (attackerCard) lord.hand.push(attackerCard);
        if (lordCard) lord.hand.push(lordCard);
        logs.push(`${player.name} 拼点未胜，${lord.name} 获得${SkillName.ZhiBa}两张拼点牌`);
      }
      return logs;
    }
    if (action.skill === SkillName.LiJian) {
      if (!this.canUseLiJian(player)) {
        return [`${player.name} 当前无法发动${SkillName.LiJian}`];
      }
      if (!targetId) {
        return ["需要选择目标"];
      }
      const firstMale = this.mustGetPlayer(targetId);
      if (!firstMale.alive || firstMale.id === player.id || firstMale.gender !== "男") {
        return ["目标无效"];
      }
      const secondMale = this.players
        .filter((p) => p.alive && p.gender === "男" && p.id !== firstMale.id && p.id !== player.id)
        .sort((a, b) => a.id.localeCompare(b.id))[0];
      if (!secondMale) {
        return ["没有足够的男性角色"];
      }
      const [discarded] = await this.requestDiscardSelection(player, 1, `发动：选择弃置1张牌`);
      if (!discarded) {
        return [` 没有可弃置手牌`];
      }
      this.discardPile.push(discarded);
      this.markSkillUsed(player.id, SkillName.LiJian);
      const logs = [` 发动，弃置 ，令  与  决斗`];
      logs.push(...(await this.resolveDuel(firstMale, secondMale)));
      logs.push(...(await this.resolveDeaths()));
      logs.push(...this.resolveWinner());
      await this.advanceIfCurrentPlayerDead(logs);
      return logs;
    }
    if (action.skill === SkillName.JieYin) {
      if (!this.canUseJieYin(player)) {
        return [`${player.name} 当前无法发动${SkillName.JieYin}`];
      }
      if (!targetId) {
        return ["需要选择目标"];
      }
      const target = this.mustGetPlayer(targetId);
      if (!target.alive || target.id === player.id || target.gender !== "男" || target.hp >= target.maxHp) {
        return ["目标无效"];
      }
      const discarded = await this.requestDiscardSelection(player, 2, `发动：选择弃置2张手牌`);
      if (discarded.length < 2) {
        return [` 手牌不足 2 张`];
      }
      this.discardPile.push(...discarded);
      target.hp = Math.min(target.maxHp, target.hp + 1);
      player.hp = Math.min(player.maxHp, player.hp + 1);
      this.markSkillUsed(player.id, SkillName.JieYin);
      return [` 发动，弃置 2 张手牌， 与  各回复 1 点体力`];
    }
    return [`${player.name} 发动了未知技能`];
  }

  private canPlaySlashInTurn(player: Player): boolean {
    if (this.hasSkill(player, SkillName.Roar)) {
      return true;
    }
    if (player.weapon === CardType.Crossbow) {
      return true;
    }
    return !this.slashUsedThisTurn;
  }

  private canUseAssault(player: Player): boolean {
    if (!this.hasSkill(player, SkillName.Assault)) {
      return false;
    }
    if (player.hand.length === 0) {
      return false;
    }
    return !this.isSkillUsed(player.id, SkillName.Assault);
  }

  private getLordWithZhiBa(): Player | null {
    const lord = this.players.find((item) => item.alive && item.role === PlayerRole.Lord && this.hasSkill(item, SkillName.ZhiBa));
    return lord ?? null;
  }

  private canUseZhiBa(player: Player): boolean {
    const lord = this.getLordWithZhiBa();
    if (!lord) {
      return false;
    }
    if (lord.id === player.id) {
      return false;
    }
    if (this.getPlayerKingdom(player) !== "吴") {
      return false;
    }
    if (player.hand.length === 0 || lord.hand.length === 0) {
      return false;
    }
    return !this.isSkillUsed(player.id, SkillName.ZhiBa);
  }

  private canUseFanJian(player: Player): boolean {
    if (!this.hasSkill(player, SkillName.FanJian) || player.hand.length === 0) {
      return false;
    }
    return !this.isSkillUsed(player.id, SkillName.FanJian);
  }

  private canUseZhiHeng(player: Player): boolean {
    if (!this.hasSkill(player, SkillName.ZhiHeng)) {
      return false;
    }
    if (player.hand.length === 0) {
      return false;
    }
    return !this.isSkillUsed(player.id, SkillName.ZhiHeng);
  }

  private canUseQingNang(player: Player): boolean {
    if (!this.hasSkill(player, SkillName.QingNang)) {
      return false;
    }
    if (player.hand.length === 0) {
      return false;
    }
    return !this.isSkillUsed(player.id, SkillName.QingNang);
  }

  private canUseKuRou(player: Player): boolean {
    if (!this.hasSkill(player, SkillName.KuRou)) {
      return false;
    }
    return player.hp > 0;
  }

  private canUseLiJian(player: Player): boolean {
    if (!this.hasSkill(player, SkillName.LiJian) || player.hand.length === 0) {
      return false;
    }
    const maleCount = this.players.filter((p) => p.alive && p.gender === "男").length;
    if (maleCount < 2) {
      return false;
    }
    return !this.isSkillUsed(player.id, SkillName.LiJian);
  }

  private canUseJieYin(player: Player): boolean {
    if (!this.hasSkill(player, SkillName.JieYin) || player.hand.length < 2) {
      return false;
    }
    const hasMaleWounded = this.players.some(
      (p) => p.alive && p.gender === "男" && p.id !== player.id && p.hp < p.maxHp,
    );
    if (!hasMaleWounded) {
      return false;
    }
    return !this.isSkillUsed(player.id, SkillName.JieYin);
  }

  private hasSkill(player: Player, skill: SkillName): boolean {
    return player.skills.includes(skill);
  }

  private async triggerJiAng(attacker: Player, target: Player, qualifies: boolean, logs: string[]): Promise<void> {
    if (!qualifies) {
      return;
    }
    if (this.hasSkill(attacker, SkillName.JiAng) && await this.shouldActivateOptionalEffect(attacker, SkillName.JiAng)) {
      const drawn = this.drawCards(attacker.id, 1);
      logs.push(`${attacker.name} 的${SkillName.JiAng}生效，摸了 ${drawn} 张牌`);
    }
    if (this.hasSkill(target, SkillName.JiAng) && await this.shouldActivateOptionalEffect(target, SkillName.JiAng)) {
      const drawn = this.drawCards(target.id, 1);
      logs.push(`${target.name} 的${SkillName.JiAng}生效，摸了 ${drawn} 张牌`);
    }
  }

  private async shouldActivateOptionalEffect(player: Player, effect: SkillName | CardType): Promise<boolean> {
    const key = `${player.id}:${effect}`;
    const decision = this.optionalEffectDecisions.get(key);
    this.optionalEffectDecisions.delete(key);
    if (decision !== undefined) {
      return decision;
    }
    const result = await this.decide({
      kind: "optional-effect",
      requestId: this.nextInteractionId(),
      playerId: player.id,
      effect: effect.toString(),
      reason: `是否发动${effect}？`,
    });
    return result.choice === "effect" ? result.enabled : false;
  }

  private resetTurnSkillState(playerId: string): void {
    this.skillUsedThisTurn.set(playerId, new Set<SkillName>());
  }

  private markSkillUsed(playerId: string, skill: SkillName): void {
    const state = this.skillUsedThisTurn.get(playerId) ?? new Set<SkillName>();
    state.add(skill);
    this.skillUsedThisTurn.set(playerId, state);
  }

  private isSkillUsed(playerId: string, skill: SkillName): boolean {
    const state = this.skillUsedThisTurn.get(playerId);
    if (!state) {
      return false;
    }
    return state.has(skill);
  }

  private createSkillHooks(): Record<SkillTrigger, SkillHook[]> {
    return {
      turn_start: [
        async (payload, logs) => {
          const actor = payload.actor;
          if (!actor || !this.hasSkill(actor, SkillName.LuoShen) || !await this.shouldActivateOptionalEffect(actor, SkillName.LuoShen)) {
            return;
          }
          const suitNames = { heart: "红桃", diamond: "方片", club: "梅花", spade: "黑桃", none: "无花色" } as const;
          let gained = 0;
          while (true) {
            const card = this.drawCard();
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
            this.discardPile.push(card);
            logs.push(`${actor.name} 的${SkillName.LuoShen}判定：${suitNames[card.suit]}${card.rank} ${card.type}，停止判定`);
            break;
          }
          if (gained > 0) logs.push(`${actor.name} 的${SkillName.LuoShen}生效，共获得 ${gained} 张牌`);
        },
        (payload, logs) => {
          const actor = payload.actor;
          if (!actor || !this.hasSkill(actor, SkillName.HunZi)) {
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
          if (!actor || !this.hasSkill(actor, SkillName.YingHun) || !await this.shouldActivateOptionalEffect(actor, SkillName.YingHun)) {
            return;
          }
          const lost = Math.max(0, actor.maxHp - actor.hp);
          if (lost <= 0) {
            return;
          }
          const others = this.players.filter((player) => player.alive && player.id !== actor.id);
          if (others.length === 0) {
            return;
          }
          const target = others.sort((a, b) => a.hp - b.hp || a.hand.length - b.hand.length)[0];
          if (!target) {
            return;
          }
          const x = lost;
          const option = this.rng() < 0.5 ? "draw" : "discard";
          if (option === "draw") {
            const drawn = this.drawCards(target.id, x);
            const discarded = this.discardFromPlayerHand(target, 1, logs);
            logs.push(`${actor.name} 的${SkillName.YingHun}生效，令 ${target.name} 摸 ${drawn} 张牌并弃置 ${discarded} 张牌`);
          } else {
            const drawn = this.drawCards(target.id, 1);
            const discarded = this.discardFromPlayerHand(target, x, logs);
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
          if (!this.hasSkill(actor, SkillName.Heroic) || !await this.shouldActivateOptionalEffect(actor, SkillName.Heroic)) {
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
          if (!this.hasSkill(actor, SkillName.LuoYi) || !await this.shouldActivateOptionalEffect(actor, SkillName.LuoYi) || payload.drawCount <= 0) {
            return;
          }
          payload.drawCount = Math.max(0, payload.drawCount - 1);
          this.markSkillUsed(actor.id, SkillName.LuoYi);
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
          if (this.hasSkill(target, SkillName.FanKui) && await this.shouldActivateOptionalEffect(target, SkillName.FanKui) && this.hasRemovableCard(source)) {
            logs.push(...await this.removeRandomCardFromPlayer(source, "获得", target));
          }
          if (this.hasSkill(target, SkillName.JianXiong) && await this.shouldActivateOptionalEffect(target, SkillName.JianXiong)) {
            const drawn = this.drawCards(target.id, 1);
            logs.push(`${target.name} 的${SkillName.JianXiong}生效，摸了 ${drawn} 张牌`);
          }
          if (this.hasSkill(target, SkillName.YiJi) && await this.shouldActivateOptionalEffect(target, SkillName.YiJi)) {
            const drawn = this.drawCards(target.id, 2);
            logs.push(`${target.name} 的${SkillName.YiJi}生效，摸了 ${drawn} 张牌`);
          }
          if (this.hasSkill(target, SkillName.GangLie) && await this.shouldActivateOptionalEffect(target, SkillName.GangLie)) {
            const judgment = this.drawJudgmentCard(`${target.name} 的${SkillName.GangLie}`, logs);
            const succeeded = judgment !== null && judgment.suit !== "heart";
            logs.push(`${target.name} 发动${SkillName.GangLie}，判定${succeeded ? "成功" : "失败"}`);
            if (succeeded) {
              if (this.countRemovableSelfCards(source) >= 2) {
                logs.push(...(await this.discardSelfCards(source, 2)));
                logs.push(`${source.name} 为响应${SkillName.GangLie}弃置了 2 张牌`);
              } else {
                logs.push(`${source.name} 无法弃置 2 张牌，受到${SkillName.GangLie}的 1 点伤害`);
                await this.applyDamage(target, source, 1, SkillName.GangLie, logs);
              }
            }
          }
        },
      ],
    };
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
  ): Promise<void> {
    const payload: SkillEventPayload = {
      source,
      target,
      damage: amount,
      reason,
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
    logs.push(`${target.name} 受到 ${finalDamage} 点伤害，当前体力 ${Math.max(target.hp, 0)}`);
    await this.emitSkillTrigger("after_damage", payload, logs);
  }

  private get currentPlayer(): Player {
    const player = this.players[this.currentPlayerIndex];
    if (!player) {
      throw new Error("current player missing");
    }
    return player;
  }
}
