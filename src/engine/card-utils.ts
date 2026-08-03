import { CardType } from "./cards.js";
import {
  ArmorType,
  AttackHorseType,
  DefenseHorseType,
  EquipCardType,
  Player,
  TreasureType,
  WeaponType,
} from "./types.js";

export function isWeaponCard(cardType: CardType): cardType is WeaponType {
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

export function isArmorCard(cardType: CardType): cardType is ArmorType {
  return (
    cardType === CardType.EightDiagram ||
    cardType === CardType.VineArmor ||
    cardType === CardType.SilverLion
  );
}

export function isSlashCard(cardType: CardType): boolean {
  return cardType === CardType.Slash || cardType === CardType.FireSlash;
}

export function isDefenseHorseCard(cardType: CardType): cardType is DefenseHorseType {
  return cardType === CardType.Dilu || cardType === CardType.JueYing || cardType === CardType.ZhuaHuangFeiDian;
}

export function isAttackHorseCard(cardType: CardType): cardType is AttackHorseType {
  return cardType === CardType.ChiTu || cardType === CardType.DaYuan || cardType === CardType.ZiXing;
}

export function isTreasureCard(cardType: CardType): cardType is TreasureType {
  return cardType === CardType.WoodenOx;
}

export function isEquipCard(cardType: CardType): cardType is EquipCardType {
  return (
    isWeaponCard(cardType) ||
    isArmorCard(cardType) ||
    isDefenseHorseCard(cardType) ||
    isAttackHorseCard(cardType) ||
    isTreasureCard(cardType)
  );
}

export function isDelayedTrickCard(cardType: CardType): boolean {
  return cardType === CardType.Indulgence || cardType === CardType.SuppliesCut || cardType === CardType.Lightning;
}

export function isNonDelayedTrickCard(cardType: CardType): boolean {
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

export function cardNeedsTarget(cardType: CardType): boolean {
  return (
    isSlashCard(cardType) ||
    cardType === CardType.Dismantle ||
    cardType === CardType.Snatch ||
    cardType === CardType.Duel ||
    cardType === CardType.Collateral ||
    cardType === CardType.Indulgence ||
    cardType === CardType.SuppliesCut
  );
}

export function usableCardCount(player: Player): number {
  return player.hand.length + player.treasureCards.length;
}

export function hasRemovableCard(player: Player): boolean {
  return (
    player.hand.length > 0 ||
    player.weapon !== null ||
    player.armor !== null ||
    player.defenseHorse !== null ||
    player.attackHorse !== null ||
    player.treasure !== null
  );
}

export function countRemovableSelfCards(player: Player): number {
  return (
    player.hand.length +
    (player.weapon ? 1 : 0) +
    (player.armor ? 1 : 0) +
    (player.defenseHorse ? 1 : 0) +
    (player.attackHorse ? 1 : 0) +
    (player.treasure ? 1 : 0)
  );
}
