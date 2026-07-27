import { CardType } from "../engine/cards.js";
import { GameAction, GameSnapshot, PlayerRole, SanGuoGame } from "../engine/game.js";
import { RoundPromptContext } from "./prompt.js";

type RoleScore = {
  lord: number;
  loyalist: number;
  rebel: number;
  traitor: number;
};

type PlayerBehavior = {
  aggressive: number;
  supportive: number;
  attackedLord: number;
  attackedRebel: number;
  attackedLoyalist: number;
  attackedTraitor: number;
  usedSlash: number;
  usedDodge: number;
  usedNegate: number;
};

type CardPrediction = {
  slash: number;
  dodge: number;
  negate: number;
};

export type LocalAiDecision = {
  action: GameAction;
  targetId?: string;
  insight: string;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const initRoleScore = (): RoleScore => ({
  lord: 0,
  loyalist: 0,
  rebel: 0,
  traitor: 0,
});

const initBehavior = (): PlayerBehavior => ({
  aggressive: 0,
  supportive: 0,
  attackedLord: 0,
  attackedRebel: 0,
  attackedLoyalist: 0,
  attackedTraitor: 0,
  usedSlash: 0,
  usedDodge: 0,
  usedNegate: 0,
});

const normalizeName = (raw: string): string => raw.trim();

export class LocalAiEngine {
  private readonly rulesText: string;

  private memory: RoundPromptContext[];

  private readonly processedRounds: Set<number>;

  private readonly behaviorByName: Map<string, PlayerBehavior>;

  private readonly roleScoreByName: Map<string, RoleScore>;

  constructor(rulesText: string) {
    this.rulesText = rulesText;
    this.memory = [];
    this.processedRounds = new Set();
    this.behaviorByName = new Map();
    this.roleScoreByName = new Map();
  }

  reset(): void {
    this.memory = [];
    this.processedRounds.clear();
    this.behaviorByName.clear();
    this.roleScoreByName.clear();
  }

  syncPreviousRounds(contexts: RoundPromptContext[]): void {
    this.memory = contexts.slice(-3);
    for (const round of this.memory) {
      if (this.processedRounds.has(round.round)) {
        continue;
      }
      this.processRoundContext(round);
      this.processedRounds.add(round.round);
    }
  }

  decide(game: SanGuoGame, playerId: string): LocalAiDecision | null {
    const snapshot = game.getSnapshot();
    const self = snapshot.players.find((item) => item.id === playerId);
    if (!self || !self.alive || !self.isAI || snapshot.currentPlayerId !== playerId) {
      return null;
    }
    const actions = game.getPlayableActions(playerId);
    if (actions.length === 0) {
      return null;
    }
    let bestDecision: LocalAiDecision | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const action of actions) {
      const evaluated = this.evaluateAction(snapshot, self.id, self.role, action);
      if (evaluated.score > bestScore) {
        bestScore = evaluated.score;
        bestDecision = evaluated.targetId
          ? {
              action,
              targetId: evaluated.targetId,
              insight: evaluated.insight,
            }
          : {
              action,
              insight: evaluated.insight,
            };
      }
    }
    return bestDecision;
  }

  private processRoundContext(round: RoundPromptContext): void {
    for (const line of round.displayLines) {
      this.processDisplayLine(line);
    }
  }

  private processDisplayLine(line: string): void {
    const attacked = line.match(/^(.+?) 对 (.+?) 使用(.+)$/);
    if (attacked?.[1] && attacked[2] && attacked[3]) {
      const actor = normalizeName(attacked[1]);
      const target = normalizeName(attacked[2]);
      const cardName = attacked[3];
      const behavior = this.ensureBehavior(actor);
      behavior.aggressive += 1;
      if (cardName.includes(CardType.Slash)) {
        behavior.usedSlash += 1;
      }
      this.applyRoleEvidenceByAttack(actor, target, 1.1);
      return;
    }
    const usedSlash = line.match(/^(.+?) 打出杀/);
    if (usedSlash?.[1]) {
      const behavior = this.ensureBehavior(normalizeName(usedSlash[1]));
      behavior.usedSlash += 1;
      return;
    }
    const usedDodge = line.match(/^(.+?) 打出闪/);
    if (usedDodge?.[1]) {
      const behavior = this.ensureBehavior(normalizeName(usedDodge[1]));
      behavior.usedDodge += 1;
      return;
    }
    const usedNegate = line.match(/^(.+?) 打出无懈可击/);
    if (usedNegate?.[1]) {
      const behavior = this.ensureBehavior(normalizeName(usedNegate[1]));
      behavior.usedNegate += 1;
      return;
    }
    const usePeach = line.match(/^(.+?) 使用桃/);
    if (usePeach?.[1]) {
      const behavior = this.ensureBehavior(normalizeName(usePeach[1]));
      behavior.supportive += 1;
    }
  }

  private applyRoleEvidenceByAttack(actorName: string, targetName: string, weight: number): void {
    const actorBehavior = this.ensureBehavior(actorName);
    if (targetName.includes("主公")) {
      actorBehavior.attackedLord += 1;
      const actorRoleScore = this.ensureRoleScore(actorName);
      actorRoleScore.rebel += 1.8 * weight;
      actorRoleScore.traitor += 0.2 * weight;
      actorRoleScore.loyalist -= 1.2 * weight;
      return;
    }
    if (targetName.includes("忠臣")) {
      actorBehavior.attackedLoyalist += 1;
      const actorRoleScore = this.ensureRoleScore(actorName);
      actorRoleScore.rebel += 0.9 * weight;
      actorRoleScore.loyalist -= 0.6 * weight;
      return;
    }
    if (targetName.includes("反贼")) {
      actorBehavior.attackedRebel += 1;
      const actorRoleScore = this.ensureRoleScore(actorName);
      actorRoleScore.loyalist += 0.9 * weight;
      actorRoleScore.rebel -= 0.6 * weight;
      return;
    }
    if (targetName.includes("内奸")) {
      actorBehavior.attackedTraitor += 1;
      const actorRoleScore = this.ensureRoleScore(actorName);
      actorRoleScore.lord += 0.3 * weight;
      actorRoleScore.loyalist += 0.3 * weight;
      actorRoleScore.rebel += 0.3 * weight;
    }
  }

  private ensureBehavior(name: string): PlayerBehavior {
    const existed = this.behaviorByName.get(name);
    if (existed) {
      return existed;
    }
    const next = initBehavior();
    this.behaviorByName.set(name, next);
    return next;
  }

  private ensureRoleScore(name: string): RoleScore {
    const existed = this.roleScoreByName.get(name);
    if (existed) {
      return existed;
    }
    const next = initRoleScore();
    this.roleScoreByName.set(name, next);
    return next;
  }

  private predictRole(snapshot: GameSnapshot, playerId: string): PlayerRole {
    const player = snapshot.players.find((item) => item.id === playerId);
    if (!player) {
      return PlayerRole.Rebel;
    }
    if (player.role === PlayerRole.Lord) {
      return PlayerRole.Lord;
    }
    const roleScore = this.ensureRoleScore(player.name);
    const behavior = this.ensureBehavior(player.name);
    const handFactor = Math.min(player.hand.length, 6) * 0.1;
    const scoreByRole: Array<{ role: PlayerRole; score: number }> = [
      { role: PlayerRole.Loyalist, score: roleScore.loyalist + behavior.supportive * 0.5 + handFactor * 0.2 },
      { role: PlayerRole.Rebel, score: roleScore.rebel + behavior.aggressive * 0.2 + behavior.attackedLord * 0.8 },
      { role: PlayerRole.Traitor, score: roleScore.traitor + handFactor * 0.4 },
    ];
    scoreByRole.sort((a, b) => b.score - a.score);
    return scoreByRole[0]?.role ?? PlayerRole.Rebel;
  }

  private isAlly(selfRole: PlayerRole, otherRole: PlayerRole): boolean {
    if (selfRole === PlayerRole.Lord || selfRole === PlayerRole.Loyalist) {
      return otherRole === PlayerRole.Lord || otherRole === PlayerRole.Loyalist;
    }
    if (selfRole === PlayerRole.Rebel) {
      return otherRole === PlayerRole.Rebel;
    }
    return false;
  }

  private predictCards(playerName: string, handCount: number): CardPrediction {
    const behavior = this.ensureBehavior(playerName);
    const slash = clamp(0.15 + handCount * 0.11 + behavior.aggressive * 0.04 + behavior.usedSlash * 0.05, 0.05, 0.95);
    const dodge = clamp(0.18 + handCount * 0.09 + behavior.usedDodge * 0.08, 0.05, 0.9);
    const negate = clamp(0.06 + handCount * 0.05 + behavior.usedNegate * 0.12, 0.03, 0.85);
    return { slash, dodge, negate };
  }

  private evaluateAction(
    snapshot: GameSnapshot,
    selfId: string,
    selfRole: PlayerRole,
    action: GameAction,
  ): { score: number; targetId?: string; insight: string } {
    if (action.type === "end") {
      return { score: -2, insight: "结束回合" };
    }
    const self = snapshot.players.find((item) => item.id === selfId);
    if (!self) {
      return { score: -1, insight: "无可用角色信息" };
    }
    if (action.type === "skill") {
      const targetEval = action.requiresTarget
        ? this.pickTargetForAction(snapshot, selfRole, action.targets, "skill")
        : { score: 0, targetId: undefined, roleGuess: "", cardPrediction: { slash: 0, dodge: 0, negate: 0 } };
      const hpUrgency = self.hp <= 2 ? 2.5 : 0.5;
      const skillScore = 4 + hpUrgency + targetEval.score;
      const skillInsight = targetEval.targetId
        ? `技能压制 ${targetEval.roleGuess}，目标牌预判 杀${targetEval.cardPrediction.slash.toFixed(2)} 闪${targetEval.cardPrediction.dodge.toFixed(2)} 无懈${targetEval.cardPrediction.negate.toFixed(2)}`
        : "技能收益";
      return targetEval.targetId
        ? {
            score: skillScore,
            targetId: targetEval.targetId,
            insight: skillInsight,
          }
        : {
            score: skillScore,
            insight: skillInsight,
          };
    }
    const card = self.hand[action.cardIndex];
    if (!card) {
      return { score: -5, insight: "牌信息缺失" };
    }
    const cardType = card.type;
    const targetEval = action.requiresTarget
      ? this.pickTargetForAction(snapshot, selfRole, action.targets, cardType)
      : { score: 0, targetId: undefined, roleGuess: "", cardPrediction: { slash: 0, dodge: 0, negate: 0 } };
    let baseScore = 0;
    if (cardType === CardType.Peach) {
      baseScore = self.hp <= 2 ? 12 : self.hp < self.maxHp ? 6 : -2;
    } else if (cardType === CardType.ExNihilo) {
      baseScore = 9;
    } else if (cardType === CardType.Slash || cardType === CardType.FireSlash) {
      baseScore = 8 + (1 - targetEval.cardPrediction.dodge) * 3;
    } else if (cardType === CardType.Duel) {
      baseScore = 7 + (1 - targetEval.cardPrediction.slash) * 2;
    } else if (cardType === CardType.Dismantle || cardType === CardType.Snatch) {
      baseScore = 7 + targetEval.score * 0.6;
    } else if (cardType === CardType.Barbarian) {
      baseScore = this.evaluateMassCard(snapshot, selfRole, "slash");
    } else if (cardType === CardType.ArrowRain) {
      baseScore = this.evaluateMassCard(snapshot, selfRole, "dodge");
    } else if (cardType === CardType.PeachGarden || cardType === CardType.Harvest) {
      baseScore = this.evaluateGroupBenefit(snapshot, selfRole);
    } else if (
      cardType === CardType.Crossbow ||
      cardType === CardType.FemaleSword ||
      cardType === CardType.QinggangSword ||
      cardType === CardType.IceSword ||
      cardType === CardType.GudingBlade ||
      cardType === CardType.SerpentSpear ||
      cardType === CardType.GreenDragonBlade ||
      cardType === CardType.RockCleavingAxe ||
      cardType === CardType.Halberd ||
      cardType === CardType.KylinBow ||
      cardType === CardType.EightDiagram ||
      cardType === CardType.VineArmor ||
      cardType === CardType.SilverLion ||
      cardType === CardType.Dilu ||
      cardType === CardType.JueYing ||
      cardType === CardType.ZhuaHuangFeiDian ||
      cardType === CardType.ChiTu ||
      cardType === CardType.DaYuan ||
      cardType === CardType.ZiXing ||
      cardType === CardType.WoodenOx
    ) {
      baseScore = 5;
    } else if (cardType === CardType.Negate || cardType === CardType.Dodge) {
      baseScore = -3;
    } else {
      baseScore = 2;
    }
    const score = baseScore + targetEval.score;
    const insight = targetEval.targetId
      ? `目标${targetEval.roleGuess}，预判牌 杀${targetEval.cardPrediction.slash.toFixed(2)} 闪${targetEval.cardPrediction.dodge.toFixed(2)} 无懈${targetEval.cardPrediction.negate.toFixed(2)}`
      : "收益动作";
    return targetEval.targetId
      ? {
          score,
          targetId: targetEval.targetId,
          insight,
        }
      : {
          score,
          insight,
        };
  }

  private pickTargetForAction(
    snapshot: GameSnapshot,
    selfRole: PlayerRole,
    targets: string[],
    cardType: CardType | "skill",
  ): {
    score: number;
    targetId?: string;
    roleGuess: string;
    cardPrediction: CardPrediction;
  } {
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestId: string | undefined;
    let bestRole = "";
    let bestPrediction: CardPrediction = { slash: 0, dodge: 0, negate: 0 };
    for (const targetId of targets) {
      const target = snapshot.players.find((item) => item.id === targetId);
      if (!target || !target.alive) {
        continue;
      }
      const roleGuess = this.predictRole(snapshot, target.id);
      const ally = this.isAlly(selfRole, roleGuess);
      const prediction = this.predictCards(target.name, target.hand.length);
      let score = ally ? -14 : 8;
      score += (4 - Math.max(target.hp, 0)) * 1.8;
      score += target.hand.length * 0.35;
      if (cardType === CardType.Slash || cardType === CardType.FireSlash || cardType === CardType.ArrowRain) {
        score += (1 - prediction.dodge) * 3;
      }
      if (cardType === CardType.Duel || cardType === CardType.Barbarian) {
        score += (1 - prediction.slash) * 2.2;
      }
      if (cardType === CardType.Dismantle || cardType === CardType.Snatch) {
        score += target.hand.length * 0.7 + prediction.negate * 0.9;
      }
      if (cardType === "skill") {
        score += 1.8;
      }
      if (score > bestScore) {
        bestScore = score;
        bestId = target.id;
        bestRole = roleGuess;
        bestPrediction = prediction;
      }
    }
    return bestId
      ? { score: bestScore, targetId: bestId, roleGuess: bestRole, cardPrediction: bestPrediction }
      : { score: bestScore, roleGuess: bestRole, cardPrediction: bestPrediction };
  }

  private evaluateMassCard(snapshot: GameSnapshot, selfRole: PlayerRole, counter: "slash" | "dodge"): number {
    let score = 0;
    for (const player of snapshot.players) {
      if (!player.alive) {
        continue;
      }
      const predictedRole = this.predictRole(snapshot, player.id);
      const ally = this.isAlly(selfRole, predictedRole);
      const cardPrediction = this.predictCards(player.name, player.hand.length);
      const resist = counter === "slash" ? cardPrediction.slash : cardPrediction.dodge;
      const value = (1 - resist) * (4 - Math.max(player.hp, 0) + 1);
      score += ally ? -value * 0.9 : value * 1.2;
    }
    return score;
  }

  private evaluateGroupBenefit(snapshot: GameSnapshot, selfRole: PlayerRole): number {
    let score = 0;
    for (const player of snapshot.players) {
      if (!player.alive) {
        continue;
      }
      const predictedRole = this.predictRole(snapshot, player.id);
      const ally = this.isAlly(selfRole, predictedRole);
      const missingHp = Math.max(0, player.maxHp - player.hp);
      const value = missingHp > 0 ? 1.6 : 0.4;
      score += ally ? value : -value * 0.6;
    }
    return score;
  }

  getMemorySummary(): string {
    const rounds = this.memory.map((item) => item.round).join(",");
    const hasRules = this.rulesText.length > 0;
    return `memoryRounds=${rounds || "none"} rulesLoaded=${hasRules ? "yes" : "no"}`;
  }
}
