export enum CardType {
  Slash = "杀",
  FireSlash = "火杀",
  ThunderSlash = "雷杀",
  Dodge = "闪",
  Peach = "桃",
  Wine = "酒",
  Dismantle = "过河拆桥",
  Snatch = "顺手牵羊",
  Duel = "决斗",
  ExNihilo = "无中生有",
  Barbarian = "南蛮入侵",
  ArrowRain = "万箭齐发",
  Collateral = "借刀杀人",
  Negate = "无懈可击",
  PeachGarden = "桃园结义",
  Harvest = "五谷丰登",
  FireAttack = "火攻",
  IronChain = "铁索连环",
  Crossbow = "诸葛连弩",
  FemaleSword = "雌雄双股剑",
  QinggangSword = "青釭剑",
  IceSword = "寒冰剑",
  SilverMoonSpear = "银月枪",
  GudingBlade = "古锭刀",
  SerpentSpear = "丈八蛇矛",
  GreenDragonBlade = "青龙偃月刀",
  RockCleavingAxe = "贯石斧",
  Halberd = "方天画戟",
  KylinBow = "麒麟弓",
  VermilionFan = "朱雀羽扇",
  EightDiagram = "八卦阵",
  RenWangShield = "仁王盾",
  VineArmor = "藤甲",
  SilverLion = "白银狮子",
  Dilu = "的卢",
  JueYing = "绝影",
  ZhuaHuangFeiDian = "爪黄飞电",
  HuaLiu = "骅骝",
  ChiTu = "赤兔",
  DaYuan = "大宛",
  ZiXing = "紫骍",
  WoodenOx = "木牛流马",
  // 延时锦囊
  Indulgence = "乐不思蜀",
  SuppliesCut = "兵粮寸断",
  Lightning = "闪电",
}

export type CardColor = "red" | "black" | "colorless";
export type CardSuit = "heart" | "diamond" | "club" | "spade" | "none";

export type Card = {
  id: string;
  type: CardType;
  color: CardColor;
  suit: CardSuit;
  rank: number;
};

const deckPattern: Array<{ type: CardType; color: CardColor }> = [];

const appendCards = (type: CardType, count: number, color: CardColor = "colorless"): void => {
  for (let i = 0; i < count; i += 1) {
    deckPattern.push({ type, color });
  }
};

// 牌堆构成遵循官方标准版（108）+ 军争篇（52），另加本项目的木牛流马（宝物），共 161 张。
// 花色为满足规则所需的近似分配（杀 9 红 21 黑、火杀全红、雷杀全黑、闪/桃全红），
// 同色内红桃/方片、黑桃/梅花按序号轮换，非基本牌花色轮换。
appendCards(CardType.Slash, 9, "red");
appendCards(CardType.Slash, 21, "black");
appendCards(CardType.FireSlash, 5, "red");
appendCards(CardType.ThunderSlash, 9, "black");
appendCards(CardType.Dodge, 24, "red");
appendCards(CardType.Peach, 12, "red");
appendCards(CardType.Wine, 4, "black");
appendCards(CardType.Wine, 1, "red");
appendCards(CardType.Dismantle, 6);
appendCards(CardType.Snatch, 5);
appendCards(CardType.Duel, 3);
appendCards(CardType.ExNihilo, 4);
appendCards(CardType.Barbarian, 3);
appendCards(CardType.ArrowRain, 1);
appendCards(CardType.Collateral, 2);
appendCards(CardType.Negate, 6);
appendCards(CardType.PeachGarden, 1);
appendCards(CardType.Harvest, 2);
appendCards(CardType.FireAttack, 3);
appendCards(CardType.IronChain, 6);
appendCards(CardType.Crossbow, 2);
appendCards(CardType.FemaleSword, 1);
appendCards(CardType.QinggangSword, 1);
appendCards(CardType.IceSword, 1);
appendCards(CardType.SilverMoonSpear, 1);
appendCards(CardType.GudingBlade, 1);
appendCards(CardType.SerpentSpear, 1);
appendCards(CardType.GreenDragonBlade, 1);
appendCards(CardType.RockCleavingAxe, 1);
appendCards(CardType.Halberd, 1);
appendCards(CardType.KylinBow, 1);
appendCards(CardType.VermilionFan, 1);
appendCards(CardType.EightDiagram, 2);
appendCards(CardType.RenWangShield, 1);
appendCards(CardType.VineArmor, 2);
appendCards(CardType.SilverLion, 1);
appendCards(CardType.Dilu, 1);
appendCards(CardType.JueYing, 1);
appendCards(CardType.ZhuaHuangFeiDian, 1);
appendCards(CardType.HuaLiu, 1);
appendCards(CardType.ChiTu, 1);
appendCards(CardType.DaYuan, 1);
appendCards(CardType.ZiXing, 1);
appendCards(CardType.WoodenOx, 1);
appendCards(CardType.Indulgence, 3);
appendCards(CardType.SuppliesCut, 2);
appendCards(CardType.Lightning, 2);

export const CARD_LIBRARY: Card[] = deckPattern.map((item, index) => {
  const suit: CardSuit = item.color === "red"
    ? (index % 2 === 0 ? "heart" : "diamond")
    : item.color === "black"
      ? (index % 2 === 0 ? "club" : "spade")
      : (["heart", "diamond", "club", "spade"] as const)[index % 4] ?? "spade";
  return {
    id: `${item.type}-${index + 1}`,
    type: item.type,
    color: suit === "heart" || suit === "diamond" ? "red" : "black",
    suit,
    rank: (index % 13) + 1,
  };
});

export const CARD_LIBRARY_SUMMARY: Array<{ type: CardType; count: number }> = [
  { type: CardType.Slash, count: 30 },
  { type: CardType.FireSlash, count: 5 },
  { type: CardType.ThunderSlash, count: 9 },
  { type: CardType.Dodge, count: 24 },
  { type: CardType.Peach, count: 12 },
  { type: CardType.Wine, count: 5 },
  { type: CardType.Dismantle, count: 6 },
  { type: CardType.Snatch, count: 5 },
  { type: CardType.Duel, count: 3 },
  { type: CardType.ExNihilo, count: 4 },
  { type: CardType.Barbarian, count: 3 },
  { type: CardType.ArrowRain, count: 1 },
  { type: CardType.Collateral, count: 2 },
  { type: CardType.Negate, count: 6 },
  { type: CardType.PeachGarden, count: 1 },
  { type: CardType.Harvest, count: 2 },
  { type: CardType.FireAttack, count: 3 },
  { type: CardType.IronChain, count: 6 },
  { type: CardType.Crossbow, count: 2 },
  { type: CardType.FemaleSword, count: 1 },
  { type: CardType.QinggangSword, count: 1 },
  { type: CardType.IceSword, count: 1 },
  { type: CardType.SilverMoonSpear, count: 1 },
  { type: CardType.GudingBlade, count: 1 },
  { type: CardType.SerpentSpear, count: 1 },
  { type: CardType.GreenDragonBlade, count: 1 },
  { type: CardType.RockCleavingAxe, count: 1 },
  { type: CardType.Halberd, count: 1 },
  { type: CardType.KylinBow, count: 1 },
  { type: CardType.VermilionFan, count: 1 },
  { type: CardType.EightDiagram, count: 2 },
  { type: CardType.RenWangShield, count: 1 },
  { type: CardType.VineArmor, count: 2 },
  { type: CardType.SilverLion, count: 1 },
  { type: CardType.Dilu, count: 1 },
  { type: CardType.JueYing, count: 1 },
  { type: CardType.ZhuaHuangFeiDian, count: 1 },
  { type: CardType.HuaLiu, count: 1 },
  { type: CardType.ChiTu, count: 1 },
  { type: CardType.DaYuan, count: 1 },
  { type: CardType.ZiXing, count: 1 },
  { type: CardType.WoodenOx, count: 1 },
  { type: CardType.Indulgence, count: 3 },
  { type: CardType.SuppliesCut, count: 2 },
  { type: CardType.Lightning, count: 2 },
];

export const createDeck = (): Card[] => [...CARD_LIBRARY];

export const shuffle = <T>(items: T[], rng: () => number): T[] => {
  const copied = [...items];
  for (let i = copied.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const current = copied[i];
    const target = copied[j];
    if (current === undefined || target === undefined) {
      continue;
    }
    copied[i] = target;
    copied[j] = current;
  }
  return copied;
};
