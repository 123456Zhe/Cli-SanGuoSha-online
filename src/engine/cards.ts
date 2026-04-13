export enum CardType {
  Slash = "杀",
  Dodge = "闪",
  Peach = "桃",
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
  Crossbow = "诸葛连弩",
  FemaleSword = "雌雄双股剑",
  QinggangSword = "青釭剑",
  IceSword = "寒冰剑",
  GudingBlade = "古锭刀",
  SerpentSpear = "丈八蛇矛",
  GreenDragonBlade = "青龙偃月刀",
  RockCleavingAxe = "贯石斧",
  Halberd = "方天画戟",
  KylinBow = "麒麟弓",
  EightDiagram = "八卦阵",
  RenwangShield = "仁王盾",
  VineArmor = "藤甲",
  SilverLion = "白银狮子",
  Dilu = "的卢",
  JueYing = "绝影",
  ZhuaHuangFeiDian = "爪黄飞电",
  ChiTu = "赤兔",
  DaYuan = "大宛",
  ZiXing = "紫骍",
  WoodenOx = "木牛流马",
}

export type CardColor = "red" | "black" | "colorless";

export type Card = {
  id: string;
  type: CardType;
  color: CardColor;
};

const deckPattern: Array<{ type: CardType; color: CardColor }> = [];

const appendCards = (type: CardType, count: number, color: CardColor = "colorless"): void => {
  for (let i = 0; i < count; i += 1) {
    deckPattern.push({ type, color });
  }
};

appendCards(CardType.Slash, 12, "red");
appendCards(CardType.Slash, 12, "black");
appendCards(CardType.Dodge, 6, "red");
appendCards(CardType.Dodge, 6, "black");
appendCards(CardType.Peach, 8, "red");
appendCards(CardType.Dismantle, 5);
appendCards(CardType.Snatch, 4);
appendCards(CardType.Duel, 3);
appendCards(CardType.ExNihilo, 4);
appendCards(CardType.Barbarian, 2);
appendCards(CardType.ArrowRain, 2);
appendCards(CardType.Collateral, 2);
appendCards(CardType.Negate, 4);
appendCards(CardType.PeachGarden, 2);
appendCards(CardType.Harvest, 2);
appendCards(CardType.Crossbow, 1);
appendCards(CardType.FemaleSword, 1);
appendCards(CardType.QinggangSword, 1);
appendCards(CardType.IceSword, 1);
appendCards(CardType.GudingBlade, 1);
appendCards(CardType.SerpentSpear, 1);
appendCards(CardType.GreenDragonBlade, 1);
appendCards(CardType.RockCleavingAxe, 1);
appendCards(CardType.Halberd, 1);
appendCards(CardType.KylinBow, 1);
appendCards(CardType.EightDiagram, 1);
appendCards(CardType.RenwangShield, 1);
appendCards(CardType.VineArmor, 1);
appendCards(CardType.SilverLion, 1);
appendCards(CardType.Dilu, 1);
appendCards(CardType.JueYing, 1);
appendCards(CardType.ZhuaHuangFeiDian, 1);
appendCards(CardType.ChiTu, 1);
appendCards(CardType.DaYuan, 1);
appendCards(CardType.ZiXing, 1);
appendCards(CardType.WoodenOx, 1);

export const CARD_LIBRARY: Card[] = deckPattern.map((item, index) => ({
  id: `${item.type}-${index + 1}`,
  type: item.type,
  color: item.color,
}));

export const CARD_LIBRARY_SUMMARY: Array<{ type: CardType; count: number }> = [
  { type: CardType.Slash, count: 24 },
  { type: CardType.Dodge, count: 12 },
  { type: CardType.Peach, count: 8 },
  { type: CardType.Dismantle, count: 5 },
  { type: CardType.Snatch, count: 4 },
  { type: CardType.Duel, count: 3 },
  { type: CardType.ExNihilo, count: 4 },
  { type: CardType.Barbarian, count: 2 },
  { type: CardType.ArrowRain, count: 2 },
  { type: CardType.Collateral, count: 2 },
  { type: CardType.Negate, count: 4 },
  { type: CardType.PeachGarden, count: 2 },
  { type: CardType.Harvest, count: 2 },
  { type: CardType.Crossbow, count: 1 },
  { type: CardType.FemaleSword, count: 1 },
  { type: CardType.QinggangSword, count: 1 },
  { type: CardType.IceSword, count: 1 },
  { type: CardType.GudingBlade, count: 1 },
  { type: CardType.SerpentSpear, count: 1 },
  { type: CardType.GreenDragonBlade, count: 1 },
  { type: CardType.RockCleavingAxe, count: 1 },
  { type: CardType.Halberd, count: 1 },
  { type: CardType.KylinBow, count: 1 },
  { type: CardType.EightDiagram, count: 1 },
  { type: CardType.RenwangShield, count: 1 },
  { type: CardType.VineArmor, count: 1 },
  { type: CardType.SilverLion, count: 1 },
  { type: CardType.Dilu, count: 1 },
  { type: CardType.JueYing, count: 1 },
  { type: CardType.ZhuaHuangFeiDian, count: 1 },
  { type: CardType.ChiTu, count: 1 },
  { type: CardType.DaYuan, count: 1 },
  { type: CardType.ZiXing, count: 1 },
  { type: CardType.WoodenOx, count: 1 },
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
