import { CardType } from "./cards.js";
import { isEquipCard, isSlashCard } from "./card-utils.js";
import { GameAction, Player, SkillName } from "./types.js";

export type AiHeuristicsContext = {
  mustGetPlayer(id: string): Player;
};

export function shouldEquip(player: Player, cardType: CardType): boolean {
  // 原实现逐分支判断武器/防具/马/宝物，等价于装备牌即应装备
  return isEquipCard(cardType);
}

export function pickBestTarget(ctx: AiHeuristicsContext, targets: string[]): string | undefined {
  const candidates = targets
    .map((id) => ctx.mustGetPlayer(id))
    .sort((a, b) => a.hp - b.hp || a.hand.length - b.hand.length);
  return candidates[0]?.id;
}

export function pickBestAiAction(ctx: AiHeuristicsContext, actions: GameAction[], playerId: string): GameAction | null {
  const player = ctx.mustGetPlayer(playerId);
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
    return card ? isSlashCard(card.type) : false;
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
    return shouldEquip(player, card.type);
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
