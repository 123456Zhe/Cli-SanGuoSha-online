import { CARD_LIBRARY_SUMMARY, Card, CardType, createDeck, shuffle } from "./cards.js";

export enum TurnPhase {
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
  alive: boolean;
};

export enum SkillName {
  Heroic = "英姿",
  Roar = "咆哮",
  Assault = "强袭",
  Guard = "坚守",
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

type SkillHook = (payload: SkillEventPayload, logs: string[]) => void;

type RngFn = () => number;

export type ResponseKind = "dodge" | "slash" | "negate";

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
  | CardType.RenwangShield
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
  skills: [SkillName.Heroic, SkillName.Assault],
};

const commonGeneralPool: GeneralDefinition[] = [
  { kingdom: "魏", name: "曹操", maxHp: 4, skills: [SkillName.JianXiong, SkillName.HuJia] },
  { kingdom: "魏", name: "甄姬", maxHp: 3, skills: [SkillName.QingGuo, SkillName.LuoShen] },
  { kingdom: "魏", name: "夏侯惇", maxHp: 4, skills: [SkillName.GangLie] },
  { kingdom: "魏", name: "许褚", maxHp: 4, skills: [SkillName.LuoYi] },
  { kingdom: "魏", name: "张辽", maxHp: 4, skills: [SkillName.TuXi] },
  { kingdom: "魏", name: "郭嘉", maxHp: 3, skills: [SkillName.TianDu, SkillName.YiJi] },
  { kingdom: "魏", name: "司马懿", maxHp: 3, skills: [SkillName.FanKui, SkillName.GuiCai] },
  { kingdom: "蜀", name: "刘备", maxHp: 4, skills: [SkillName.RenDe, SkillName.JiJiang] },
  { kingdom: "蜀", name: "关羽", maxHp: 4, skills: [SkillName.WuSheng] },
  { kingdom: "蜀", name: "张飞", maxHp: 4, skills: [SkillName.Roar] },
  { kingdom: "蜀", name: "赵云", maxHp: 4, skills: [SkillName.LongDan] },
  { kingdom: "蜀", name: "马超", maxHp: 4, skills: [SkillName.MaShu, SkillName.TieQi] },
  { kingdom: "蜀", name: "诸葛亮（标准版）", maxHp: 3, skills: [SkillName.GuanXing, SkillName.KongCheng] },
  { kingdom: "蜀", name: "黄月英", maxHp: 3, skills: [SkillName.JiZhi, SkillName.QiCai] },
  { kingdom: "吴", name: "孙权", maxHp: 4, skills: [SkillName.ZhiHeng, SkillName.JiuYuan] },
  { kingdom: "吴", name: "周瑜", maxHp: 3, skills: [SkillName.Heroic, SkillName.FanJian] },
  { kingdom: "吴", name: "黄盖", maxHp: 4, skills: [SkillName.KuRou] },
  { kingdom: "吴", name: "陆逊", maxHp: 3, skills: [SkillName.QianXun, SkillName.LianYing] },
  { kingdom: "吴", name: "大乔", maxHp: 3, skills: [SkillName.GuoSe, SkillName.LiuLi] },
  { kingdom: "吴", name: "孙尚香", maxHp: 3, skills: [SkillName.JieYin, SkillName.XiaoJi] },
  { kingdom: "群雄", name: "吕布", maxHp: 4, skills: [SkillName.WuShuang] },
  { kingdom: "群雄", name: "貂蝉", maxHp: 3, skills: [SkillName.LiJian, SkillName.BiYue] },
  { kingdom: "群雄", name: "华佗", maxHp: 3, skills: [SkillName.QingNang, SkillName.JiJiu] },
  { kingdom: "魏", name: "曹仁", maxHp: 4, skills: [SkillName.Guard] },
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
  }

  initDefaultGame(options: Partial<GameInitOptions> = {}): string[] {
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
    logs.push(...this.startTurn());
    return logs;
  }

  getSnapshot(): GameSnapshot {
    return {
      turn: this.turn,
      currentPlayerId: this.currentPlayer.id,
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

  ensureTurnState(): string[] {
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
    logs.push(...this.startTurn());
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
      if (card.type === CardType.Slash && !canPlaySlash) {
        return;
      }
      if (card.type === CardType.Peach && player.hp >= player.maxHp) {
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
        if (card.type === CardType.Slash || card.color !== "red") {
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

  discardForCurrentPlayer(playerId: string, handIndex: number): string[] {
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
    logs.push(...this.finishTurn(player));
    return logs;
  }

  playAction(playerId: string, action: GameAction, targetId?: string, selectedCardId?: string): string[] {
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
      logs.push(...this.resolveSlash(player, target, used.color));
      logs.push(...this.resolveDeaths());
      logs.push(...this.resolveWinner());
      this.advanceIfCurrentPlayerDead(logs);
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
      logs.push(...this.resolveSlash(player, target, used.color));
      logs.push(...this.resolveDeaths());
      logs.push(...this.resolveWinner());
      this.advanceIfCurrentPlayerDead(logs);
      return logs;
    }
    if (action.cardIndex === -11) {
      if (player.treasure !== CardType.WoodenOx || player.hand.length === 0) {
        return [`${player.name} 当前无法发动${CardType.WoodenOx}`];
      }
      const moved = player.hand.shift();
      if (!moved) {
        return [`${player.name} 当前无法发动${CardType.WoodenOx}`];
      }
      player.treasureCards.push(moved);
      return [`${player.name} 将 1 张手牌置于${CardType.WoodenOx}下方`];
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
        ...this.resolveSlash(player, target, "colorless", true),
      ];
      return logs;
    }
    const card = player.hand[action.cardIndex];
    if (!card) {
      return [`${player.name} 选择了无效卡牌`];
    }
    if (
      card.type === CardType.Slash &&
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
      if ((card.type === CardType.Slash || card.type === CardType.Duel) && this.isKongChengProtected(target, card.type)) {
        return [`${target.name} 的${SkillName.KongCheng}生效，无法成为目标`];
      }
      if (card.type === CardType.Slash && !this.canReachForSlash(player, target)) {
        return ["目标超出攻击范围"];
      }
    }

    const usedCard = player.hand.splice(action.cardIndex, 1)[0];
    if (!usedCard) {
      return ["使用卡牌失败"];
    }
    return this.resolveUsedCard(player, usedCard, targetId, false, selectedCardId);
  }

  private resolveUsedCard(
    player: Player,
    usedCard: Card,
    targetId: string | undefined,
    fromTreasure: boolean,
    selectedCardId?: string,
  ): string[] {
    this.discardPile.push(usedCard);
    const logs: string[] = [];
    if (fromTreasure) {
      logs.push(`${player.name} 从${CardType.WoodenOx}下使用了 ${usedCard.type}`);
    }
    if (this.hasSkill(player, SkillName.JiZhi) && this.isNonDelayedTrickCard(usedCard.type)) {
      const drawn = this.drawCards(player.id, 1);
      logs.push(`${player.name} 的${SkillName.JiZhi}生效，摸了 ${drawn} 张牌`);
    }
    if (usedCard.type === CardType.Slash && targetId) {
      if (!this.hasSkill(player, SkillName.Roar)) {
        this.slashUsedThisTurn = true;
      }
      const slashTargets = this.expandSlashTargets(player, this.mustGetPlayer(targetId), player.hand.length === 0);
      for (const slashTarget of slashTargets) {
        logs.push(...this.resolveSlash(player, slashTarget, usedCard.color));
      }
    } else if (usedCard.type === CardType.Peach) {
      player.hp = Math.min(player.maxHp, player.hp + 1);
      logs.push(`${player.name} 使用桃，回复 1 点体力`);
    } else if (usedCard.type === CardType.Dismantle && targetId) {
      logs.push(...this.resolveDismantle(player, this.mustGetPlayer(targetId), selectedCardId));
    } else if (usedCard.type === CardType.Snatch && targetId) {
      logs.push(...this.resolveSnatch(player, this.mustGetPlayer(targetId), selectedCardId));
    } else if (usedCard.type === CardType.Duel && targetId) {
      logs.push(...this.resolveDuel(player, this.mustGetPlayer(targetId)));
    } else if (usedCard.type === CardType.ExNihilo) {
      const drawn = this.drawCards(player.id, 2);
      logs.push(`${player.name} 使用无中生有，摸了 ${drawn} 张牌`);
    } else if (usedCard.type === CardType.Barbarian) {
      logs.push(...this.resolveBarbarian(player));
    } else if (usedCard.type === CardType.ArrowRain) {
      logs.push(...this.resolveArrowRain(player));
    } else if (usedCard.type === CardType.Collateral && targetId) {
      logs.push(...this.resolveCollateral(player, this.mustGetPlayer(targetId)));
    } else if (usedCard.type === CardType.PeachGarden) {
      logs.push(...this.resolvePeachGarden(player));
    } else if (usedCard.type === CardType.Harvest) {
      logs.push(...this.resolveHarvest(player));
    } else if (this.isEquipCard(usedCard.type)) {
      logs.push(...this.resolveEquip(player, usedCard.type));
    }
    logs.push(...this.resolveDeaths());
    logs.push(...this.resolveWinner());
    this.advanceIfCurrentPlayerDead(logs);
    return logs;
  }

  runAITurn(): string[] {
    if (this.winner !== null || !this.currentPlayer.isAI || !this.currentPlayer.alive) {
      return [];
    }
    const logs: string[] = [];
    while (true) {
      const ai = this.currentPlayer;
      const actions = this.getPlayableActions(ai.id);
      const best = this.pickBestAiAction(actions, ai.id);
      if (!best || best.type === "end") {
        logs.push(...this.endPlayPhase(ai.id));
        return logs;
      }
      const targetId = best.requiresTarget ? this.pickBestTarget(best.targets) : undefined;
      logs.push(...this.playAction(ai.id, best, targetId));
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
    this.responsePolicyByPlayer.set(playerId, policy);
  }

  getPlayerResponseOptions(playerId: string, kind: ResponseKind): ResponseOption[] {
    const player = this.players.find((item) => item.id === playerId);
    if (!player || !player.alive) {
      return [];
    }
    if (kind === "negate") {
      return player.hand
        .filter((card) => card.type === CardType.Negate)
        .map((card) => ({ id: card.id, kind, label: `打出${CardType.Negate}` }));
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
            .filter((card) => card.type === CardType.Slash)
            .map((card) => ({ id: `longdan:${card.id}`, kind, label: `${SkillName.LongDan}当${CardType.Dodge}` }))
        : [];
      return [...direct, ...qingGuo, ...longDan];
    }
    const direct = player.hand
      .filter((card) => card.type === CardType.Slash)
      .map((card) => ({ id: card.id, kind, label: `打出${CardType.Slash}` }));
    const wuSheng = this.hasSkill(player, SkillName.WuSheng)
      ? player.hand
          .filter((card) => card.color === "red" && card.type !== CardType.Slash)
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

  startTurn(): string[] {
    if (this.winner !== null) {
      return [];
    }
    this.phase = TurnPhase.Draw;
    this.slashUsedThisTurn = false;
    const player = this.currentPlayer;
    const logs = [`第 ${this.turn} 回合：${player.name} 的回合`, `进入${TurnPhase.Draw}`];
    this.resetTurnSkillState(player.id);
    this.emitSkillTrigger("turn_start", { actor: player }, logs);
    const drawPayload: SkillEventPayload = { actor: player, drawCount: drawCountPerTurn };
    this.emitSkillTrigger("before_draw", drawPayload, logs);
    const drawn = this.drawCards(player.id, drawPayload.drawCount ?? drawCountPerTurn);
    logs.push(`${player.name} 摸了 ${drawn} 张牌`);
    this.phase = TurnPhase.Play;
    logs.push(`进入${TurnPhase.Play}`);
    return logs;
  }

  private endPlayPhase(playerId: string): string[] {
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
    logs.push(...this.finishTurn(player));
    return logs;
  }

  private finishTurn(player: Player): string[] {
    const logs: string[] = [];
    this.phase = TurnPhase.End;
    logs.push(`进入${TurnPhase.End}`);
    if (this.hasSkill(player, SkillName.BiYue)) {
      const drawn = this.drawCards(player.id, 1);
      logs.push(`${player.name} 的${SkillName.BiYue}生效，摸了 ${drawn} 张牌`);
    }
    logs.push(`${player.name} 结束回合`);
    this.moveToNextPlayer();
    if (this.winner !== null) {
      return logs;
    }
    logs.push(...this.startTurn());
    return logs;
  }

  private resolveSlash(
    attacker: Player,
    target: Player,
    slashColor: "red" | "black" | "colorless" = "colorless",
    fromSerpent = false,
  ): string[] {
    const logs = [`${attacker.name} 对 ${target.name} 使用杀`];
    if (this.isKongChengProtected(target, CardType.Slash)) {
      logs.push(`${target.name} 的${SkillName.KongCheng}生效，无法成为杀的目标`);
      return logs;
    }
    if (fromSerpent) {
      logs.push("本次杀来自丈八蛇矛转化");
    }
    const ignoreArmor = attacker.weapon === CardType.QinggangSword;
    if (!ignoreArmor && target.armor === CardType.VineArmor) {
      logs.push(`${target.name} 的藤甲生效，抵消了杀`);
      return logs;
    }
    if (!ignoreArmor && target.armor === CardType.RenwangShield && slashColor === "black") {
      logs.push(`${target.name} 的仁王盾生效，黑色杀无效`);
      return logs;
    }
    if (attacker.weapon === CardType.FemaleSword && attacker.gender !== target.gender) {
      if (target.hand.length > 0 && this.rng() < 0.6) {
        const removed = target.hand.splice(this.randomIndex(target.hand.length), 1)[0];
        if (removed) {
          this.discardPile.push(removed);
          logs.push(`${attacker.name} 的雌雄双股剑生效，${target.name} 弃置了 1 张手牌`);
        }
      } else {
        const drawn = this.drawCards(attacker.id, 1);
        logs.push(`${attacker.name} 的雌雄双股剑生效，摸了 ${drawn} 张牌`);
      }
    }
    if (!ignoreArmor && target.armor === CardType.EightDiagram && this.rng() < 0.5) {
      logs.push(`${target.name} 的八卦阵判定为红色，视为打出闪`);
      return logs;
    }
    let requireDodgeCount = this.hasSkill(attacker, SkillName.WuShuang) ? 2 : 1;
    if (this.hasSkill(attacker, SkillName.TieQi) && this.rng() < 0.5) {
      requireDodgeCount = 0;
      logs.push(`${attacker.name} 的${SkillName.TieQi}生效，此杀不可被闪避`);
    }
    let dodged = true;
    for (let i = 0; i < requireDodgeCount; i += 1) {
      if (!this.consumeDodgeResponse(target, logs)) {
        dodged = false;
        break;
      }
    }
    if (dodged && requireDodgeCount > 0) {
      logs.push(`${target.name} 打出闪，抵消了杀`);
      if (attacker.weapon === CardType.RockCleavingAxe && this.countRemovableSelfCards(attacker) >= 2) {
        logs.push(...this.discardSelfCards(attacker, 2));
        logs.push(`${attacker.name} 的贯石斧生效，此次杀强制命中`);
      } else if (attacker.weapon === CardType.GreenDragonBlade) {
        const nextSlash = attacker.hand.findIndex((card) => card.type === CardType.Slash);
        if (nextSlash >= 0) {
          const slash = attacker.hand.splice(nextSlash, 1)[0];
          if (slash) {
            this.discardPile.push(slash);
            logs.push(`${attacker.name} 的青龙偃月刀生效，追加一张杀`);
            logs.push(...this.resolveSlash(attacker, target, slash.color));
            return logs;
          }
        }
      } else {
        return logs;
      }
    }
    if (attacker.weapon === CardType.IceSword && this.hasRemovableCard(target)) {
      logs.push(`${attacker.name} 的寒冰剑生效，防止本次伤害并弃置目标2张牌`);
      logs.push(...this.removeRandomCardFromPlayer(target, "弃置"));
      if (this.hasRemovableCard(target)) {
        logs.push(...this.removeRandomCardFromPlayer(target, "弃置"));
      }
      return logs;
    }
    let damage = 1;
    if (attacker.weapon === CardType.GudingBlade && target.hand.length === 0) {
      damage += 1;
      logs.push(`${attacker.name} 的古锭刀生效，伤害+1`);
    }
    if (this.isSkillUsed(attacker.id, SkillName.LuoYi)) {
      damage += 1;
      logs.push(`${attacker.name} 的${SkillName.LuoYi}生效，本次杀伤害+1`);
    }
    this.applyDamage(attacker, target, damage, "杀", logs);
    if (attacker.weapon === CardType.KylinBow) {
      const horseLogs = this.removeHorseEquip(target);
      logs.push(...horseLogs);
    }
    return logs;
  }

  private resolveDismantle(user: Player, target: Player, selectedCardId?: string): string[] {
    const logs = [`${user.name} 对 ${target.name} 使用过河拆桥`];
    if (this.tryNegate(target, CardType.Dismantle, logs)) {
      return logs;
    }
    if (!this.hasRemovableCard(target)) {
      logs.push(`${target.name} 没有可拆的牌`);
      return logs;
    }
    if (selectedCardId) {
      const removedByChoice = this.removeSelectedCardFromPlayer(target, "弃置", selectedCardId);
      if (removedByChoice.length > 0) {
        logs.push(...removedByChoice);
        return logs;
      }
    }
    logs.push(...this.removeRandomCardFromPlayer(target, "弃置"));
    return logs;
  }

  private resolveSnatch(user: Player, target: Player, selectedCardId?: string): string[] {
    const logs = [`${user.name} 对 ${target.name} 使用顺手牵羊`];
    if (this.tryNegate(target, CardType.Snatch, logs)) {
      return logs;
    }
    if (!this.hasRemovableCard(target)) {
      logs.push(`${target.name} 没有可获得的牌`);
      return logs;
    }
    if (selectedCardId) {
      const removedByChoice = this.removeSelectedCardFromPlayer(target, "获得", selectedCardId, user);
      if (removedByChoice.length > 0) {
        logs.push(...removedByChoice);
        return logs;
      }
    }
    logs.push(...this.removeRandomCardFromPlayer(target, "获得", user));
    return logs;
  }

  private resolveDuel(user: Player, target: Player): string[] {
    const logs = [`${user.name} 对 ${target.name} 发起决斗`];
    if (this.isKongChengProtected(target, CardType.Duel)) {
      logs.push(`${target.name} 的${SkillName.KongCheng}生效，无法成为决斗目标`);
      return logs;
    }
    if (this.tryNegate(target, CardType.Duel, logs)) {
      return logs;
    }
    let attacker = user;
    let defender = target;
    while (true) {
      const needCount = this.hasSkill(attacker, SkillName.WuShuang) ? 2 : 1;
      let valid = true;
      for (let i = 0; i < needCount; i += 1) {
        if (!this.consumeSlashResponse(defender, logs)) {
          valid = false;
          break;
        }
      }
      if (!valid) {
        let damage = 1;
        if (this.isSkillUsed(attacker.id, SkillName.LuoYi)) {
          damage += 1;
          logs.push(`${attacker.name} 的${SkillName.LuoYi}生效，本次决斗伤害+1`);
        }
        this.applyDamage(attacker, defender, damage, "决斗", logs);
        break;
      }
      logs.push(`${defender.name} 打出杀响应决斗`);
      const swap = attacker;
      attacker = defender;
      defender = swap;
    }
    return logs;
  }

  private resolveBarbarian(user: Player): string[] {
    const logs = [`${user.name} 使用南蛮入侵`];
    for (const target of this.players) {
      if (!target.alive || target.id === user.id) {
        continue;
      }
      if (this.tryNegate(target, CardType.Barbarian, logs)) {
        continue;
      }
      if (target.armor === CardType.VineArmor) {
        logs.push(`${target.name} 的藤甲生效，抵消南蛮入侵`);
        continue;
      }
      if (this.consumeSlashResponse(target, logs)) {
        logs.push(`${target.name} 打出杀，抵消南蛮入侵`);
      } else {
        this.applyDamage(user, target, 1, "南蛮入侵", logs);
      }
    }
    return logs;
  }

  private resolveArrowRain(user: Player): string[] {
    const logs = [`${user.name} 使用万箭齐发`];
    for (const target of this.players) {
      if (!target.alive || target.id === user.id) {
        continue;
      }
      if (this.tryNegate(target, CardType.ArrowRain, logs)) {
        continue;
      }
      if (target.armor === CardType.VineArmor) {
        logs.push(`${target.name} 的藤甲生效，抵消万箭齐发`);
        continue;
      }
      if (this.consumeDodgeResponse(target, logs)) {
        logs.push(`${target.name} 打出闪，抵消万箭齐发`);
      } else {
        this.applyDamage(user, target, 1, "万箭齐发", logs);
      }
    }
    return logs;
  }

  private resolveCollateral(user: Player, target: Player): string[] {
    const logs = [`${user.name} 对 ${target.name} 使用借刀杀人`];
    if (this.tryNegate(target, CardType.Collateral, logs)) {
      return logs;
    }
    const slashIndex = target.hand.findIndex((card) => card.type === CardType.Slash);
    if (slashIndex < 0) {
      if (!this.hasRemovableCard(target)) {
        logs.push(`${target.name} 没有杀且没有可获得的牌`);
        return logs;
      }
      logs.push(...this.removeRandomCardFromPlayer(target, "获得", user));
      return logs;
    }
    const slash = target.hand.splice(slashIndex, 1)[0];
    if (slash) {
      this.discardPile.push(slash);
    }
    const victims = this.players
      .filter(
        (player) =>
          player.alive &&
          player.id !== user.id &&
          player.id !== target.id &&
          this.canReachForSlash(target, player) &&
          !this.isKongChengProtected(player, CardType.Slash),
      )
      .sort((a, b) => a.hp - b.hp || a.hand.length - b.hand.length);
    const victim = victims[0];
    if (!victim) {
      logs.push(`${target.name} 无可攻击目标`);
      return logs;
    }
    logs.push(`${target.name} 被迫对 ${victim.name} 使用杀`);
    logs.push(...this.resolveSlash(target, victim, slash?.color ?? "colorless"));
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

  private resolveEquip(user: Player, equipType: EquipCardType): string[] {
    const logs: string[] = [];
    if (this.isWeaponCard(equipType)) {
      const previous = user.weapon;
      user.weapon = equipType;
      if (previous !== null) {
        this.discardPile.push(this.createCard(previous, `replace-${this.turn}`));
        logs.push(`${user.name} 的旧武器 ${previous} 被替换并弃置`);
        logs.push(...this.onLoseEquip(user, previous));
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
        logs.push(...this.onLoseEquip(user, previous));
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

  private resolveDeaths(): string[] {
    const logs: string[] = [];
    for (const player of this.players) {
      if (!player.alive) {
        continue;
      }
      if (player.hp > 0) {
        continue;
      }
      const peachIndex = player.hand.findIndex((card) => card.type === CardType.Peach);
      if (peachIndex >= 0) {
        const peach = player.hand.splice(peachIndex, 1)[0];
        if (peach) {
          this.discardPile.push(peach);
        }
        player.hp = 1;
        logs.push(`${player.name} 打出桃自救，体力恢复到 1`);
        continue;
      }
      let rescued = false;
      const rescuers = this.getRescuersInOrder(player);
      for (const rescuer of rescuers) {
        const rescuerPeachIndex = rescuer.hand.findIndex((card) => card.type === CardType.Peach);
        if (rescuerPeachIndex < 0) {
          continue;
        }
        const peach = rescuer.hand.splice(rescuerPeachIndex, 1)[0];
        if (peach) {
          this.discardPile.push(peach);
        }
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
        logs.push(`${player.name} 阵亡，身份：${player.role}`);
      }
    }
    return logs;
  }

  private consumeDirectDodgeResponse(player: Player, logs: string[]): boolean {
    if (!this.canPlayerRespond(player.id, "dodge")) {
      return false;
    }
    if (this.consumeSelectedResponse(player, "dodge", logs)) {
      return true;
    }
    const dodgeIndex = player.hand.findIndex((card) => card.type === CardType.Dodge);
    if (dodgeIndex >= 0) {
      const dodge = player.hand.splice(dodgeIndex, 1)[0];
      if (dodge) {
        this.discardPile.push(dodge);
      }
      return true;
    }
    if (this.hasSkill(player, SkillName.QingGuo)) {
      const blackIndex = player.hand.findIndex((card) => card.color === "black");
      if (blackIndex >= 0) {
        const converted = player.hand.splice(blackIndex, 1)[0];
        if (converted) {
          this.discardPile.push(converted);
        }
        logs.push(`${player.name} 发动${SkillName.QingGuo}，将黑色牌当${CardType.Dodge}打出`);
        return true;
      }
    }
    if (this.hasSkill(player, SkillName.LongDan)) {
      const slashIndex = player.hand.findIndex((card) => card.type === CardType.Slash);
      if (slashIndex >= 0) {
        const slash = player.hand.splice(slashIndex, 1)[0];
        if (slash) {
          this.discardPile.push(slash);
        }
        logs.push(`${player.name} 发动${SkillName.LongDan}，将${CardType.Slash}当${CardType.Dodge}打出`);
        return true;
      }
    }
    return false;
  }

  private consumeDirectSlashResponse(player: Player, logs: string[]): boolean {
    if (!this.canPlayerRespond(player.id, "slash")) {
      return false;
    }
    if (this.consumeSelectedResponse(player, "slash", logs)) {
      return true;
    }
    const slashIndex = player.hand.findIndex((card) => card.type === CardType.Slash);
    if (slashIndex >= 0) {
      const slash = player.hand.splice(slashIndex, 1)[0];
      if (slash) {
        this.discardPile.push(slash);
      }
      return true;
    }
    if (this.hasSkill(player, SkillName.WuSheng)) {
      const redIndex = player.hand.findIndex((card) => card.color === "red");
      if (redIndex >= 0) {
        const converted = player.hand.splice(redIndex, 1)[0];
        if (converted) {
          this.discardPile.push(converted);
        }
        logs.push(`${player.name} 发动${SkillName.WuSheng}，将红色牌当${CardType.Slash}打出`);
        return true;
      }
    }
    if (this.hasSkill(player, SkillName.LongDan)) {
      const dodgeIndex = player.hand.findIndex((card) => card.type === CardType.Dodge);
      if (dodgeIndex >= 0) {
        const dodge = player.hand.splice(dodgeIndex, 1)[0];
        if (dodge) {
          this.discardPile.push(dodge);
        }
        logs.push(`${player.name} 发动${SkillName.LongDan}，将${CardType.Dodge}当${CardType.Slash}打出`);
        return true;
      }
    }
    return false;
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

  private findTargetsByCard(playerId: string, cardType: CardType): string[] {
    if (!this.cardNeedsTarget(cardType)) {
      return [];
    }
    const targets = this.players
      .filter((player) => player.id !== playerId && player.alive)
      .map((player) => player.id);
    if (cardType === CardType.Slash) {
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
        const hasSlash = holder.hand.some((card) => card.type === CardType.Slash);
        const hasVictim = this.players.some(
          (player) => player.alive && player.id !== id && player.id !== playerId,
        );
        return hasSlash && hasVictim;
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

  private expandSlashTargets(player: Player, primary: Player, isLastHandSlash: boolean): Player[] {
    if (player.weapon !== CardType.Halberd || !isLastHandSlash) {
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

  private discardSelfCards(player: Player, count: number): string[] {
    const logs: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const removedLogs = this.removeRandomCardFromPlayer(player, "弃置");
      logs.push(...removedLogs);
    }
    return logs;
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

  private consumeDodgeResponse(player: Player, logs: string[]): boolean {
    if (!this.canPlayerRespond(player.id, "dodge")) {
      this.setPlayerResponseSelection(player.id, "dodge", null);
      return false;
    }
    if (this.consumeDirectDodgeResponse(player, logs)) {
      return true;
    }
    if (player.role !== PlayerRole.Lord || !this.hasSkill(player, SkillName.HuJia)) {
      return false;
    }
    const responders = this.getKingdomRespondersInOrder(player, "魏");
    for (const responder of responders) {
      if (this.consumeDirectDodgeResponse(responder, logs)) {
        logs.push(`${player.name} 的${SkillName.HuJia}生效，${responder.name}为其提供了${CardType.Dodge}`);
        return true;
      }
    }
    return false;
  }

  private consumeSlashResponse(player: Player, logs: string[]): boolean {
    if (!this.canPlayerRespond(player.id, "slash")) {
      this.setPlayerResponseSelection(player.id, "slash", null);
      return false;
    }
    if (this.consumeDirectSlashResponse(player, logs)) {
      return true;
    }
    if (player.role !== PlayerRole.Lord || !this.hasSkill(player, SkillName.JiJiang)) {
      return false;
    }
    const responders = this.getKingdomRespondersInOrder(player, "蜀");
    for (const responder of responders) {
      if (this.consumeDirectSlashResponse(responder, logs)) {
        logs.push(`${player.name} 的${SkillName.JiJiang}生效，${responder.name}为其提供了${CardType.Slash}`);
        return true;
      }
    }
    return false;
  }

  private onLoseEquip(player: Player, equip: EquipCardType): string[] {
    const logs: string[] = [];
    if (this.hasSkill(player, SkillName.XiaoJi)) {
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
    return { id: `${type}-${seed}-${this.turn}`, type, color: "colorless" };
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
    return cardType === CardType.Slash || cardType === CardType.Duel;
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

  private advanceIfCurrentPlayerDead(logs: string[]): void {
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
    logs.push(...this.startTurn());
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
      return card?.type === CardType.Slash;
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
      cardType === CardType.Slash ||
      cardType === CardType.Dismantle ||
      cardType === CardType.Snatch ||
      cardType === CardType.Duel ||
      cardType === CardType.Collateral
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

  private tryNegate(target: Player, trickType: CardType, logs: string[]): boolean {
    if (!this.canPlayerRespond(target.id, "negate")) {
      return false;
    }
    if (this.consumeSelectedResponse(target, "negate", logs)) {
      logs.push(`${target.name} 打出无懈可击，抵消了 ${trickType}`);
      return true;
    }
    const negateIndex = target.hand.findIndex((card) => card.type === CardType.Negate);
    if (negateIndex < 0) {
      return false;
    }
    const negate = target.hand.splice(negateIndex, 1)[0];
    if (negate) {
      this.discardPile.push(negate);
    }
    logs.push(`${target.name} 打出无懈可击，抵消了 ${trickType}`);
    return true;
  }

  private canPlayerRespond(playerId: string, kind: ResponseKind): boolean {
    const policy = this.responsePolicyByPlayer.get(playerId);
    if (!policy) {
      return true;
    }
    const allowed = policy[kind];
    return allowed !== false;
  }

  private consumeSelectedResponse(player: Player, kind: ResponseKind, logs: string[]): boolean {
    const optionId = this.takePlayerResponseSelection(player.id, kind);
    if (!optionId) {
      return false;
    }
    if (kind === "negate") {
      const directIndex = player.hand.findIndex((card) => card.id === optionId && card.type === CardType.Negate);
      if (directIndex >= 0) {
        const picked = player.hand.splice(directIndex, 1)[0];
        if (picked) {
          this.discardPile.push(picked);
        }
        return true;
      }
      return false;
    }
    if (kind === "dodge" && optionId.startsWith("qingguo:")) {
      const cardId = optionId.slice("qingguo:".length);
      const selectedIndex = player.hand.findIndex((card) => card.id === cardId && card.color === "black");
      if (selectedIndex >= 0 && this.hasSkill(player, SkillName.QingGuo)) {
        const picked = player.hand.splice(selectedIndex, 1)[0];
        if (picked) {
          this.discardPile.push(picked);
        }
        logs.push(`${player.name} 发动${SkillName.QingGuo}，将黑色牌当${CardType.Dodge}打出`);
        return true;
      }
      return false;
    }
    if (kind === "slash" && optionId.startsWith("wusheng:")) {
      const cardId = optionId.slice("wusheng:".length);
      const selectedIndex = player.hand.findIndex((card) => card.id === cardId && card.color === "red");
      if (selectedIndex >= 0 && this.hasSkill(player, SkillName.WuSheng)) {
        const picked = player.hand.splice(selectedIndex, 1)[0];
        if (picked) {
          this.discardPile.push(picked);
        }
        logs.push(`${player.name} 发动${SkillName.WuSheng}，将红色牌当${CardType.Slash}打出`);
        return true;
      }
      return false;
    }
    if (optionId.startsWith("longdan:")) {
      const cardId = optionId.slice("longdan:".length);
      if (kind === "dodge") {
        const selectedIndex = player.hand.findIndex((card) => card.id === cardId && card.type === CardType.Slash);
        if (selectedIndex >= 0 && this.hasSkill(player, SkillName.LongDan)) {
          const picked = player.hand.splice(selectedIndex, 1)[0];
          if (picked) {
            this.discardPile.push(picked);
          }
          logs.push(`${player.name} 发动${SkillName.LongDan}，将${CardType.Slash}当${CardType.Dodge}打出`);
          return true;
        }
        return false;
      }
      const selectedIndex = player.hand.findIndex((card) => card.id === cardId && card.type === CardType.Dodge);
      if (selectedIndex >= 0 && this.hasSkill(player, SkillName.LongDan)) {
        const picked = player.hand.splice(selectedIndex, 1)[0];
        if (picked) {
          this.discardPile.push(picked);
        }
        logs.push(`${player.name} 发动${SkillName.LongDan}，将${CardType.Dodge}当${CardType.Slash}打出`);
        return true;
      }
      return false;
    }
    if (kind === "dodge") {
      const directIndex = player.hand.findIndex((card) => card.id === optionId && card.type === CardType.Dodge);
      if (directIndex >= 0) {
        const picked = player.hand.splice(directIndex, 1)[0];
        if (picked) {
          this.discardPile.push(picked);
        }
        return true;
      }
      return false;
    }
    const directIndex = player.hand.findIndex((card) => card.id === optionId && card.type === CardType.Slash);
    if (directIndex >= 0) {
      const picked = player.hand.splice(directIndex, 1)[0];
      if (picked) {
        this.discardPile.push(picked);
      }
      return true;
    }
    return false;
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

  private removeRandomCardFromPlayer(player: Player, mode: "弃置" | "获得", receiver?: Player): string[] {
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
      return [];
    }
    const picked = options[this.randomIndex(options.length)];
    if (!picked) {
      return [];
    }
    return this.removeSelectedCardFromPlayer(player, mode, picked, receiver);
  }

  private removeSelectedCardFromPlayer(
    player: Player,
    mode: "弃置" | "获得",
    selectedCardId: string,
    receiver?: Player,
  ): string[] {
    if (selectedCardId === "hand-random") {
      if (player.hand.length === 0) {
        return [];
      }
      const index = this.randomIndex(player.hand.length);
      const removed = player.hand.splice(index, 1)[0];
      if (!removed) {
        return [];
      }
      if (mode === "获得" && receiver) {
        receiver.hand.push(removed);
        return [`${receiver.name} 获得了 ${player.name} 的 1 张手牌`];
      }
      this.discardPile.push(removed);
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
      this.discardPile.push(removed);
      return [`${player.name} 的手牌 ${removed.type} 被弃置`];
    }
    if (selectedCardId === "weapon") {
      const removedWeapon = player.weapon;
      player.weapon = null;
      if (removedWeapon === null) {
        return [];
      }
      if (mode === "获得" && receiver) {
        receiver.hand.push(this.createCard(removedWeapon, `loot-${this.turn}`));
        return [`${receiver.name} 获得了 ${player.name} 的装备 ${removedWeapon}`];
      }
      this.discardPile.push(this.createCard(removedWeapon, `discard-${this.turn}`));
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
        receiver.hand.push(this.createCard(removedArmor, `loot-${this.turn}`));
        logs.push(`${receiver.name} 获得了 ${player.name} 的装备 ${removedArmor}`);
      } else {
        this.discardPile.push(this.createCard(removedArmor, `discard-${this.turn}`));
        logs.push(`${player.name} 的装备 ${removedArmor} 被弃置`);
      }
      logs.push(...this.onLoseEquip(player, removedArmor));
      return logs;
    }
    if (selectedCardId === "defenseHorse") {
      const removed = player.defenseHorse;
      player.defenseHorse = null;
      if (removed === null) {
        return [];
      }
      if (mode === "获得" && receiver) {
        receiver.hand.push(this.createCard(removed, `loot-${this.turn}`));
        return [`${receiver.name} 获得了 ${player.name} 的装备 ${removed}`];
      }
      this.discardPile.push(this.createCard(removed, `discard-${this.turn}`));
      return [`${player.name} 的装备 ${removed} 被弃置`];
    }
    if (selectedCardId === "attackHorse") {
      const removed = player.attackHorse;
      player.attackHorse = null;
      if (removed === null) {
        return [];
      }
      if (mode === "获得" && receiver) {
        receiver.hand.push(this.createCard(removed, `loot-${this.turn}`));
        return [`${receiver.name} 获得了 ${player.name} 的装备 ${removed}`];
      }
      this.discardPile.push(this.createCard(removed, `discard-${this.turn}`));
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
      receiver.hand.push(this.createCard(removedTreasure, `loot-${this.turn}`));
      return [`${receiver.name} 获得了 ${player.name} 的装备 ${removedTreasure}`];
    }
    this.discardPile.push(this.createCard(removedTreasure, `discard-${this.turn}`));
    return [`${player.name} 的装备 ${removedTreasure} 被弃置`];
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
      cardType === CardType.RenwangShield ||
      cardType === CardType.VineArmor ||
      cardType === CardType.SilverLion
    );
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
      alive: true,
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
    const found = GENERAL_LIBRARY.find((item) => item.name === generalName);
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

  private pickRandomUnusedGeneral(usedGeneralNames: Set<string>): GeneralDefinition {
    const candidates = GENERAL_LIBRARY.filter((general) => !usedGeneralNames.has(general.name));
    if (candidates.length <= 0) {
      const fallback = GENERAL_LIBRARY[this.randomIndex(GENERAL_LIBRARY.length)];
      return fallback ?? humanGeneral;
    }
    const picked = candidates[this.randomIndex(candidates.length)];
    return picked ?? humanGeneral;
  }

  private useSkillAction(
    playerId: string,
    action: Extract<GameAction, { type: "skill" }>,
    targetId?: string,
  ): string[] {
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
      const discarded = player.hand.shift();
      if (!discarded) {
        return [`${player.name} 没有可弃置手牌`];
      }
      this.discardPile.push(discarded);
      this.markSkillUsed(player.id, SkillName.Assault);
      const logs = [`${player.name} 发动${SkillName.Assault}，弃置 ${discarded.type}`];
      this.applyDamage(player, target, 1, SkillName.Assault, logs);
      logs.push(...this.resolveDeaths());
      logs.push(...this.resolveWinner());
      this.advanceIfCurrentPlayerDead(logs);
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
      const discarded = player.hand.shift();
      if (!discarded) {
        return [`${player.name} 没有可弃置手牌`];
      }
      this.discardPile.push(discarded);
      target.hp = Math.min(target.maxHp, target.hp + 1);
      this.markSkillUsed(player.id, SkillName.QingNang);
      return [`${player.name} 发动${SkillName.QingNang}，弃置 ${discarded.type}，令${target.name}回复 1 点体力`];
    }
    if (action.skill === SkillName.KuRou) {
      if (!this.canUseKuRou(player)) {
        return [`${player.name} 当前无法发动${SkillName.KuRou}`];
      }
      player.hp -= 1;
      const drawn = this.drawCards(player.id, 2);
      const logs = [`${player.name} 发动${SkillName.KuRou}，失去 1 点体力并摸了 ${drawn} 张牌`];
      logs.push(...this.resolveDeaths());
      logs.push(...this.resolveWinner());
      this.advanceIfCurrentPlayerDead(logs);
      return logs;
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

  private hasSkill(player: Player, skill: SkillName): boolean {
    return player.skills.includes(skill);
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
      turn_start: [],
      before_draw: [
        (payload, logs) => {
          const actor = payload.actor;
          if (!actor || payload.drawCount === undefined) {
            return;
          }
          if (!this.hasSkill(actor, SkillName.Heroic)) {
            return;
          }
          payload.drawCount += 1;
          logs.push(`${actor.name} 的${SkillName.Heroic}生效，额外摸 1 张牌`);
        },
        (payload, logs) => {
          const actor = payload.actor;
          if (!actor || payload.drawCount === undefined) {
            return;
          }
          if (!this.hasSkill(actor, SkillName.LuoYi) || payload.drawCount <= 0) {
            return;
          }
          payload.drawCount = Math.max(0, payload.drawCount - 1);
          this.markSkillUsed(actor.id, SkillName.LuoYi);
          logs.push(`${actor.name} 的${SkillName.LuoYi}生效，本回合少摸 1 张牌且伤害+1`);
        },
      ],
      before_damage: [
        (payload, logs) => {
          const target = payload.target;
          if (!target || payload.damage === undefined || payload.damage <= 0) {
            return;
          }
          if (!this.hasSkill(target, SkillName.Guard)) {
            return;
          }
          if (this.isSkillUsed(target.id, SkillName.Guard)) {
            return;
          }
          payload.damage = Math.max(0, payload.damage - 1);
          this.markSkillUsed(target.id, SkillName.Guard);
          logs.push(`${target.name} 的${SkillName.Guard}生效，本次伤害-1`);
        },
      ],
      after_damage: [
        (payload, logs) => {
          const target = payload.target;
          const source = payload.source;
          if (!target || !source || !source.alive || source.id === target.id) {
            return;
          }
          if (this.hasSkill(target, SkillName.FanKui) && this.hasRemovableCard(source)) {
            logs.push(...this.removeRandomCardFromPlayer(source, "获得", target));
          }
          if (this.hasSkill(target, SkillName.JianXiong)) {
            const drawn = this.drawCards(target.id, 1);
            logs.push(`${target.name} 的${SkillName.JianXiong}生效，摸了 ${drawn} 张牌`);
          }
          if (this.hasSkill(target, SkillName.YiJi)) {
            const drawn = this.drawCards(target.id, 2);
            logs.push(`${target.name} 的${SkillName.YiJi}生效，摸了 ${drawn} 张牌`);
          }
        },
      ],
    };
  }

  private emitSkillTrigger(trigger: SkillTrigger, payload: SkillEventPayload, logs: string[]): void {
    const hooks = this.skillHooks[trigger];
    for (const hook of hooks) {
      hook(payload, logs);
    }
  }

  private applyDamage(
    source: Player | null,
    target: Player,
    amount: number,
    reason: string,
    logs: string[],
  ): void {
    const payload: SkillEventPayload = {
      source,
      target,
      damage: amount,
      reason,
    };
    this.emitSkillTrigger("before_damage", payload, logs);
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
    this.emitSkillTrigger("after_damage", payload, logs);
  }

  private get currentPlayer(): Player {
    const player = this.players[this.currentPlayerIndex];
    if (!player) {
      throw new Error("current player missing");
    }
    return player;
  }
}
