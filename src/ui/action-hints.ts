import { CardType } from "../engine/cards.js";
import { GameAction } from "../engine/game.js";

export function extractCardTypeFromAction(action: Extract<GameAction, { type: "play" }>): CardType | null {
  const label = action.label;
  const allCardTypes = Object.values(CardType);
  const picked = allCardTypes.find((cardType) => label.includes(cardType));
  return picked ?? null;
}

export function getActionHint(action: GameAction): string {
  if (action.type === "end") {
    return "结束当前出牌阶段并进入弃牌/结算流程";
  }
  if (action.type === "skill") {
    if (action.label.includes("强袭")) {
      return "弃1张牌并对1名目标造成1点伤害（每回合限一次）";
    }
    if (action.label.includes("制衡")) {
      return "弃任意张牌并摸等量牌（每回合限一次）";
    }
    if (action.label.includes("青囊")) {
      return "弃1张手牌令1名角色回复1点体力（每回合限一次）";
    }
    if (action.label.includes("苦肉")) {
      return "失去1点体力并摸2张牌";
    }
    return "发动武将技能获得额外收益";
  }
  if (action.label.includes("木牛流马下的")) {
    return "从木牛流马中打出寄存牌，并按该牌原效果结算";
  }
  const cardType = extractCardTypeFromAction(action);
  if (!cardType) {
    return action.requiresTarget ? "使用此牌并选择目标" : "使用此牌立即生效";
  }
  if (cardType === CardType.Slash) {
    return "对1名角色造成1点伤害（可被闪抵消）";
  }
  if (cardType === CardType.Peach) {
    return "回复1点体力";
  }
  if (cardType === CardType.Duel) {
    return "与你指定目标轮流打出杀，先断者受1点伤害";
  }
  if (cardType === CardType.Dismantle) {
    return "弃置目标区域内1张牌";
  }
  if (cardType === CardType.Snatch) {
    return "获得目标区域内1张牌";
  }
  if (cardType === CardType.ExNihilo) {
    return "摸2张牌";
  }
  if (cardType === CardType.PeachGarden) {
    return "所有存活角色各回复1点体力";
  }
  if (cardType === CardType.Harvest) {
    return "所有存活角色各摸1张牌";
  }
  if (cardType === CardType.Barbarian) {
    return "其他角色需打出杀，否则受到1点伤害";
  }
  if (cardType === CardType.ArrowRain) {
    return "其他角色需打出闪，否则受到1点伤害";
  }
  if (cardType === CardType.Collateral) {
    return "指定装备武器角色对其攻击范围内目标出杀，否则其武器被弃置";
  }
  if (cardType === CardType.Negate) {
    return "抵消一张锦囊牌对单个目标的生效";
  }
  if (cardType === CardType.Crossbow) {
    return "武器：攻击范围2，出牌阶段可无限次使用杀";
  }
  if (cardType === CardType.FemaleSword) {
    return "武器：攻击范围2；异性目标响应杀后，随机弃其1手牌或你摸1张";
  }
  if (cardType === CardType.QinggangSword) {
    return "武器：攻击范围2；你使用的杀无视目标防具";
  }
  if (cardType === CardType.IceSword) {
    return "武器：攻击范围2；杀将造成伤害时可改为弃目标2张牌";
  }
  if (cardType === CardType.GudingBlade) {
    return "武器：攻击范围2；目标无手牌时，你的杀伤害+1";
  }
  if (cardType === CardType.SerpentSpear) {
    return "武器：攻击范围3；可弃2张手牌当1张杀使用";
  }
  if (cardType === CardType.GreenDragonBlade) {
    return "武器：攻击范围3；杀被闪后可追加再出1张杀";
  }
  if (cardType === CardType.RockCleavingAxe) {
    return "武器：攻击范围3；杀被闪后可弃2张牌令此杀仍命中";
  }
  if (cardType === CardType.Halberd) {
    return "武器：攻击范围4；最后一张手牌为杀时可额外指定至多2个目标";
  }
  if (cardType === CardType.KylinBow) {
    return "武器：攻击范围5；杀造成伤害后可弃置目标坐骑";
  }
  if (cardType === CardType.EightDiagram) {
    return "防具：受杀时有概率视为自动打出闪";
  }
  if (cardType === CardType.VineArmor) {
    return "防具：普通杀、南蛮入侵、万箭齐发对你无效";
  }
  if (cardType === CardType.SilverLion) {
    return "防具：受到超过1点伤害时改为1点；失去此防具时回复1点体力";
  }
  if (cardType === CardType.Dilu || cardType === CardType.JueYing || cardType === CardType.ZhuaHuangFeiDian) {
    return "防御马：其他角色计算到你的距离+1，更不容易被指定为目标";
  }
  if (cardType === CardType.ChiTu || cardType === CardType.DaYuan || cardType === CardType.ZiXing) {
    return "进攻马：你计算到其他角色的距离-1，更容易命中远处目标";
  }
  if (cardType === CardType.WoodenOx) {
    return "宝物：可寄存手牌并转移给其他角色，也可直接使用寄存牌";
  }
  return action.requiresTarget ? "使用装备或锦囊并选择目标" : "使用装备牌并立即生效";
}
