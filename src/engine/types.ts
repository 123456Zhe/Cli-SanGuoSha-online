import { Card, CardType } from "./cards.js";
import { ResponseKind } from "./interaction.js";

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
  skills: SkillId[];
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
  delayedTricks: Array<{ cardType: CardType; sourcePlayerId: string; card?: Card }>;
  alive: boolean;
  faceDown: boolean;
  /** 铁索连环状态（横置）：受到属性伤害时会向其他连环角色传导 */
  chained: boolean;
};

export const SkillName = {
  Heroic: "英姿",
  Roar: "咆哮",
  Assault: "强袭",
  JuShou: "据守",
  JieWei: "解围",
  JianXiong: "奸雄",
  HuJia: "护驾",
  QingGuo: "倾国",
  LuoShen: "洛神",
  GangLie: "刚烈",
  LuoYi: "裸衣",
  TuXi: "突袭",
  TianDu: "天妒",
  YiJi: "遗计",
  FanKui: "反馈",
  GuiCai: "鬼才",
  RenDe: "仁德",
  JiJiang: "激将",
  WuSheng: "武圣",
  LongDan: "龙胆",
  MaShu: "马术",
  TieQi: "铁骑",
  GuanXing: "观星",
  KongCheng: "空城",
  JiZhi: "集智",
  QiCai: "奇才",
  ZhiHeng: "制衡",
  JiuYuan: "救援",
  FanJian: "反间",
  KuRou: "苦肉",
  QianXun: "谦逊",
  LianYing: "连营",
  GuoSe: "国色",
  LiuLi: "流离",
  JieYin: "结姻",
  XiaoJi: "枭姬",
  WuShuang: "无双",
  LiJian: "离间",
  BiYue: "闭月",
  QingNang: "青囊",
  JiJiu: "急救",
  JiAng: "激昂",
  HunZi: "魂姿",
  YingHun: "英魂",
  ZhiBa: "制霸",
} as const;

/** 技能身份：内置技能名，或外部武将包的命名空间 id（如 `吕蒙/克己`）。 */
export type SkillId = string;

/** 兼容旧写法：类型位置仍可用 `SkillName` / `SkillName[]`（等价 `SkillId`）。 */
export type SkillName = SkillId;

/** 内置技能的字面量联合（用于注册表穷尽性校验）。 */
export type BuiltinSkillId = (typeof SkillName)[keyof typeof SkillName];

/** 势力常量。外部包可用自定义势力字符串。 */
export const KINGDOM = {
  Wei: "魏",
  Shu: "蜀",
  Wu: "吴",
  Qun: "群雄",
} as const;


export type GameAction =
  | {
      type: "play";
      cardIndex: number;
      label: string;
      requiresTarget: boolean;
      targets: string[];
      /** 该牌结算时需要从目标处选择一张牌（如顺手牵羊/过河拆桥），客户端据此决定是否弹出选牌提示 */
      needsTargetCard?: boolean;
    }
  | {
      type: "skill";
      skill: SkillId;
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
  kingdom: string;
  name: string;
  gender: "男" | "女";
  maxHp: number;
  skills: SkillId[];
};

export type SkillTrigger = "turn_start" | "before_draw" | "before_damage" | "after_damage";

export type SkillEventPayload = {
  actor?: Player;
  source?: Player | null;
  target?: Player;
  drawCount?: number;
  damage?: number;
  reason?: string;
  /** 造成本次伤害的牌（如杀/决斗/锦囊），供奸雄等技能获取 */
  card?: Card;
};

export type SkillHook = (payload: SkillEventPayload, logs: string[]) => void | Promise<void>;

export type RngFn = () => number;

export type ResponsePolicy = Partial<Record<ResponseKind, boolean>>;

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

export enum PlayerRole {
  Lord = "主公",
  Loyalist = "忠臣",
  Rebel = "反贼",
  Traitor = "内奸",
}

export type WeaponType =
  | CardType.Crossbow
  | CardType.FemaleSword
  | CardType.QinggangSword
  | CardType.IceSword
  | CardType.SilverMoonSpear
  | CardType.GudingBlade
  | CardType.SerpentSpear
  | CardType.GreenDragonBlade
  | CardType.RockCleavingAxe
  | CardType.Halberd
  | CardType.KylinBow
  | CardType.VermilionFan;
export type ArmorType =
  | CardType.EightDiagram
  | CardType.RenWangShield
  | CardType.VineArmor
  | CardType.SilverLion;
export type DefenseHorseType = CardType.Dilu | CardType.JueYing | CardType.ZhuaHuangFeiDian | CardType.HuaLiu;
export type AttackHorseType = CardType.ChiTu | CardType.DaYuan | CardType.ZiXing;
export type TreasureType = CardType.WoodenOx;
export type EquipCardType = WeaponType | ArmorType | DefenseHorseType | AttackHorseType | TreasureType;
