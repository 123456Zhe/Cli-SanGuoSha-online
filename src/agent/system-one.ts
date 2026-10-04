import { CardType } from "../engine/cards.js";
import { isEquipCard, isSlashCard } from "../engine/card-utils.js";
import {
  CardSource,
  GameAction,
  GameSnapshot,
  InteractionDecision,
  InteractionRequest,
  Player,
  PlayerRole,
} from "../engine/game.js";

/**
 * System-One：为 PPO/蒸馏预留的快思考 AI 接口。
 *
 * 设计目标：
 * 1) 纯函数 + 同步 + 零 I/O：`decideTurn` / `decideInteraction` 只读 snapshot 与候选动作，
 *    毫秒级返回，可直接塞进自对弈/批量仿真循环；
 * 2) 与现有决策链同构：输出与 `LocalAiEngine.decide` / `GameAiLoop.decideInteraction`
 *    一致的结构，可直接接入 `pickAiTurnDecision` 的回退位；
 * 3) 特征/打分显式暴露：`extractFeatures` 输出向量 + 字段名，供 PPO 做 state 编码、
 *    供 Judge 模型做打分，供蒸馏脚本做样本过滤。
 */

export type SystemOneTurnDecision = {
  action: GameAction;
  targetId?: string;
  confidence: number;
  reason: string;
};

export type SystemOneInteractionDecision = {
  decision: InteractionDecision;
  confidence: number;
  reason: string;
};

export type SystemOneFeatureVector = {
  names: string[];
  values: number[];
};

/** 身份视角：一名玩家相对自己的阵营关系。 */
export type RelationTag = "self" | "ally" | "enemy" | "unknown-traitor";

/** Judge 门控容忍分差：LLM 决策与 System-One 最优分差在此范围内即放行。 */
export const JUDGE_TURN_SCORE_GAP = 3;

const DEFAULT_MAX_MEMORY_EVENTS = 60;

export type SystemOneConfig = {
  /** 短期事件记忆上限（身份推断/近期攻防用），默认 60。 */
  maxMemoryEvents: number;
  /** Judge 门控容忍分差，默认 3；越大越宽容 LLM 的非常规打法。 */
  judgeScoreGap: number;
};

/**
 * 从环境变量读取 System-One 配置（.env / 进程环境均可）。
 * 注意：若配置了 JEV_*，快思考层会改用 Jev API（见 jev-advisor.ts），这些本地参数只作为兜底。
 */
export const readSystemOneConfig = (): SystemOneConfig => {
  const memory = Number.parseInt(process.env.SG_SYSTEM_ONE_MAX_MEMORY ?? "", 10);
  const gap = Number.parseFloat(process.env.SG_SYSTEM_ONE_JUDGE_GAP ?? "");
  return {
    maxMemoryEvents: Number.isInteger(memory) && memory > 0 ? memory : DEFAULT_MAX_MEMORY_EVENTS,
    judgeScoreGap: Number.isFinite(gap) && gap >= 0 ? gap : JUDGE_TURN_SCORE_GAP,
  };
};

/** 同步或异步皆可（本地 System-One 是同步的，Jev API 是异步的）。 */
export type MaybePromise<T> = T | Promise<T>;

export type RankedAction = {
  action: GameAction;
  targetId?: string;
  score: number;
  reason: string;
};

export type JudgeVerdict = {
  accepted: boolean;
  score: number;
  bestScore: number;
  /** 否决时可用作回退的最佳动作（由判断层给出，例如 Jev 的 choice 结果）。 */
  fallback?: { action: GameAction; targetId?: string };
};

/**
 * 快思考/判断层统一接口：既可以是本地启发式（SystemOneAgent），
 * 也可以是远端判断模型 API（JevAdvisor）。ai.ts 只依赖这个接口。
 */
export interface FastAdvisor {
  reset(): void;
  syncRounds(contexts: Array<{ displayLines: string[] }>): void;
  /** 仅本地实现提供（供 PPO/蒸馏取特征）；Jev 等远端判断层可不实现。 */
  extractFeatures?(snapshot: GameSnapshot, playerId: string): SystemOneFeatureVector;
  decideTurn(snapshot: GameSnapshot, playerId: string, actions: GameAction[]): MaybePromise<SystemOneTurnDecision | null>;
  decideInteraction(
    snapshot: GameSnapshot,
    playerId: string,
    request: InteractionRequest,
  ): MaybePromise<SystemOneInteractionDecision | null>;
  rankTurnActions(snapshot: GameSnapshot, playerId: string, actions: GameAction[]): MaybePromise<RankedAction[]>;
  judgeTurnDecision(
    snapshot: GameSnapshot,
    playerId: string,
    actions: GameAction[],
    decision: { action: GameAction; targetId?: string } | null | undefined,
  ): MaybePromise<JudgeVerdict>;
  judgeInteractionDecision(
    snapshot: GameSnapshot,
    playerId: string,
    request: InteractionRequest,
    decision: InteractionDecision | null | undefined,
  ): MaybePromise<boolean>;
}

const ENEMY_PRIOR: Record<PlayerRole, PlayerRole[]> = {
  [PlayerRole.Lord]: [PlayerRole.Rebel, PlayerRole.Traitor],
  [PlayerRole.Loyalist]: [PlayerRole.Rebel, PlayerRole.Traitor],
  [PlayerRole.Rebel]: [PlayerRole.Lord, PlayerRole.Loyalist],
  [PlayerRole.Traitor]: [PlayerRole.Lord, PlayerRole.Loyalist, PlayerRole.Rebel],
};

export class SystemOneAgent implements FastAdvisor {
  private readonly recentEvents: string[] = [];

  private readonly identityGuess = new Map<string, PlayerRole>();

  private maxMemoryEvents: number;

  private judgeScoreGap: number;

  constructor(maxMemoryEvents = DEFAULT_MAX_MEMORY_EVENTS, judgeScoreGap = JUDGE_TURN_SCORE_GAP) {
    this.maxMemoryEvents = maxMemoryEvents > 0 ? maxMemoryEvents : DEFAULT_MAX_MEMORY_EVENTS;
    this.judgeScoreGap = judgeScoreGap >= 0 ? judgeScoreGap : JUDGE_TURN_SCORE_GAP;
  }

  /** 从 SG_SYSTEM_ONE_* 环境变量构造（server/app 统一入口）。 */
  static createFromEnv(): SystemOneAgent {
    const config = readSystemOneConfig();
    return new SystemOneAgent(config.maxMemoryEvents, config.judgeScoreGap);
  }

  setJudgeScoreGap(gap: number): void {
    if (Number.isFinite(gap) && gap >= 0) {
      this.judgeScoreGap = gap;
    }
  }

  getJudgeScoreGap(): number {
    return this.judgeScoreGap;
  }

  reset(): void {
    this.recentEvents.length = 0;
    this.identityGuess.clear();
  }

  syncRounds(contexts: Array<{ displayLines: string[] }>): void {
    for (const round of contexts) {
      for (const line of round.displayLines) {
        this.observeEvent(line);
      }
    }
  }

  observeEvent(text: string): void {
    const line = text.trim();
    if (!line) {
      return;
    }
    this.recentEvents.push(line);
    if (this.recentEvents.length > this.maxMemoryEvents) {
      this.recentEvents.splice(0, this.recentEvents.length - this.maxMemoryEvents);
    }
    this.trackIdentityFromEvent(line);
  }

  /** 出牌决策：同步快思考，调用方保证 playerId 是当前行动玩家。 */
  decideTurn(snapshot: GameSnapshot, playerId: string, actions: GameAction[]): SystemOneTurnDecision | null {
    const ranked = this.rankTurnActions(snapshot, playerId, actions);
    const best = ranked[0];
    if (!best) {
      return null;
    }
    return {
      action: best.action,
      ...(best.targetId ? { targetId: best.targetId } : {}),
      confidence: this.toConfidence(best.score),
      reason: best.reason,
    };
  }

  /**
   * Judge 门控用：返回全部候选动作的打分排名（已按分降序）。
   * LLM 只需在该候选集上做选择/否决，不用从零推理整局，prompt 更短、解析更稳。
   */
  rankTurnActions(
    snapshot: GameSnapshot,
    playerId: string,
    actions: GameAction[],
  ): RankedAction[] {
    const self = snapshot.players.find((item) => item.id === playerId);
    if (!self || !self.alive || snapshot.currentPlayerId !== playerId || actions.length === 0) {
      return [];
    }
    return actions
      .map((action) => {
        const scored = this.scoreAction(snapshot, self, action);
        return { action, ...(scored.targetId ? { targetId: scored.targetId } : {}), score: scored.score, reason: scored.reason };
      })
      .sort((a, b) => b.score - a.score);
  }

  /** Judge 门控用：System-One 对某个 LLM 决策的接受度（0~1），低于阈值则否决回退。 */
  judgeTurnDecision(
    snapshot: GameSnapshot,
    playerId: string,
    actions: GameAction[],
    decision: { action: GameAction; targetId?: string } | null | undefined,
  ): JudgeVerdict {
    const ranked = this.rankTurnActions(snapshot, playerId, actions);
    const best = ranked[0];
    if (!decision || !best) {
      return { accepted: false, score: Number.NEGATIVE_INFINITY, bestScore: best?.score ?? Number.NEGATIVE_INFINITY };
    }
    const matched = ranked.find((item) => this.isSameScoredAction(item.action, decision.action));
    const score = matched?.score ?? Number.NEGATIVE_INFINITY;
    const fallback = best.targetId ? { action: best.action, targetId: best.targetId } : { action: best.action };
    return {
      accepted: score >= best.score - this.judgeScoreGap,
      score,
      bestScore: best.score,
      fallback,
    };
  }

  /** Judge 门控用：交互决策是否与快思考一致（保命响应必须出牌、无懈不乱交）。 */
  judgeInteractionDecision(
    snapshot: GameSnapshot,
    playerId: string,
    request: InteractionRequest,
    decision: InteractionDecision | null | undefined,
  ): boolean {
    if (request.kind === "choose-suit") {
      return true;
    }
    const fast = this.decideInteraction(snapshot, playerId, request)?.decision ?? null;
    if (!fast || !decision) {
      return decision === null || fast === null;
    }
    if (fast.choice === "pass" || decision.choice === "pass") {
      return fast.choice === decision.choice;
    }
    if (request.kind === "respond" && (request.responseKind === "peach" || request.responseKind === "slash")) {
      return decision.choice === "card";
    }
    return true;
  }

  /** 交互决策（响应杀/闪/无懈、弃牌、借刀杀人、技能发动等）：同步快思考。 */
  decideInteraction(snapshot: GameSnapshot, playerId: string, request: InteractionRequest): SystemOneInteractionDecision | null {
    const self = snapshot.players.find((item) => item.id === playerId);
    if (!self || !self.alive) {
      return null;
    }
    if (request.kind === "choose-suit") {
      return null;
    }
    if (request.kind === "optional-effect") {
      return { decision: { choice: "effect", enabled: false }, confidence: 0.6, reason: "默认不发动可选技能" };
    }
    if (request.kind === "collateral") {
      const targetId = this.pickHostileTarget(snapshot, self, request.victims);
      if (targetId) {
        const firstSlash = request.sources[0];
        return {
          decision: firstSlash
            ? { choice: "target", targetId, sourceId: firstSlash.sourceId }
            : { choice: "target", targetId },
          confidence: 0.7,
          reason: `借刀指向敌方 ${targetId}`,
        };
      }
      return { decision: { choice: "pass" }, confidence: 0.5, reason: "无可借刀敌方" };
    }
    if (request.kind === "choose-discard") {
      const sourceId = this.pickDiscardSource(request.sources, request.count);
      if (sourceId) {
        return { decision: { choice: "card", sourceId }, confidence: 0.65, reason: "弃低价值牌" };
      }
      return { decision: { choice: "pass" }, confidence: 0.4, reason: "无可弃牌" };
    }
    const mustRespond = request.responseKind === "peach" || (request.responseKind === "slash" && self.hp <= 1);
    const usable = request.sources[0];
    if (usable && (mustRespond || request.responseKind !== "negate")) {
      return { decision: { choice: "card", sourceId: usable.sourceId }, confidence: 0.8, reason: `响应${request.responseKind}` };
    }
    if (usable && request.responseKind === "negate" && this.shouldNegate(snapshot, self)) {
      return { decision: { choice: "card", sourceId: usable.sourceId }, confidence: 0.7, reason: "关键锦囊反制" };
    }
    return { decision: { choice: "pass" }, confidence: 0.5, reason: "保留手牌" };
  }

  /** 弃牌决策：返回 handIndex 列表，按价值从低到高弃到体力上限。 */
  decideDiscard(snapshot: GameSnapshot, playerId: string, count: number): number[] {
    const self = snapshot.players.find((item) => item.id === playerId);
    if (!self || count <= 0) {
      return [];
    }
    return self.hand
      .map((card, handIndex) => ({ handIndex, value: this.cardKeepValue(card.type, self) }))
      .sort((a, b) => a.value - b.value)
      .slice(0, count)
      .map((item) => item.handIndex)
      .sort((a, b) => a - b);
  }

  /** PPO state 编码 / Judge 打分 / 蒸馏样本过滤共用：self + 全场态势特征。 */
  extractFeatures(snapshot: GameSnapshot, playerId: string): SystemOneFeatureVector {
    const self = snapshot.players.find((item) => item.id === playerId);
    const names = [
      "self_hp_ratio",
      "self_hand",
      "self_is_lord",
      "self_is_traitor",
      "alive_count",
      "enemies_alive",
      "allies_alive",
      "weakest_enemy_hp",
      "strongest_enemy_hand",
      "min_ally_hp",
      "self_has_peach",
      "self_has_slash",
      "self_has_negate",
      "self_has_dodge",
      "recent_attack_on_self",
    ];
    if (!self) {
      return { names, values: names.map(() => 0) };
    }
    const alive = snapshot.players.filter((item) => item.alive);
    const enemies = alive.filter((item) => this.relationOf(self, item) === "enemy");
    const allies = alive.filter((item) => this.relationOf(self, item) === "ally");
    const enemyHps = enemies.map((item) => item.hp);
    const allyHps = allies.map((item) => item.hp);
    const values = [
      self.maxHp > 0 ? self.hp / self.maxHp : 0,
      Math.min(self.hand.length, 12) / 12,
      self.role === PlayerRole.Lord ? 1 : 0,
      self.role === PlayerRole.Traitor ? 1 : 0,
      Math.min(alive.length, 6) / 6,
      Math.min(enemies.length, 5) / 5,
      Math.min(allies.length, 4) / 4,
      enemyHps.length > 0 ? Math.min(...enemyHps) / 4 : 1,
      enemies.length > 0 ? Math.min(Math.max(...enemies.map((item) => item.hand.length)), 10) / 10 : 0,
      allyHps.length > 0 ? Math.min(...allyHps) / 4 : 1,
      self.hand.some((card) => card.type === CardType.Peach) ? 1 : 0,
      self.hand.some((card) => isSlashCard(card.type)) ? 1 : 0,
      self.hand.some((card) => card.type === CardType.Negate) ? 1 : 0,
      self.hand.some((card) => card.type === CardType.Dodge) ? 1 : 0,
      this.recentEvents.some((line) => line.includes("使用") && line.includes(self.name)) ? 1 : 0,
    ];
    return { names, values };
  }

  relationOf(self: Player, other: Player): RelationTag {
    if (other.id === self.id) {
      return "self";
    }
    if (!other.alive) {
      return "unknown-traitor";
    }
    if (other.role === PlayerRole.Lord) {
      return self.role === PlayerRole.Lord || self.role === PlayerRole.Loyalist ? "ally" : "enemy";
    }
    if (self.role === PlayerRole.Lord || self.role === PlayerRole.Loyalist) {
      if (other.role === PlayerRole.Loyalist) {
        return "ally";
      }
      if (other.role === PlayerRole.Rebel) {
        return "enemy";
      }
      return "unknown-traitor";
    }
    if (self.role === PlayerRole.Rebel) {
      const guessed = this.identityGuess.get(other.name);
      if (other.role === PlayerRole.Rebel || guessed === PlayerRole.Rebel) {
        return "ally";
      }
      return "enemy";
    }
    const guessed = this.identityGuess.get(other.name);
    if (guessed && !ENEMY_PRIOR[self.role]?.includes(guessed)) {
      return "ally";
    }
    return other.alive && other.id !== self.id ? "unknown-traitor" : "enemy";
  }

  private isSameScoredAction(left: GameAction, right: GameAction): boolean {
    if (left.type !== right.type) {
      return false;
    }
    if (left.type === "end" && right.type === "end") {
      return true;
    }
    if (left.type === "skill" && right.type === "skill") {
      return left.skill === right.skill && left.label === right.label;
    }
    if (left.type === "play" && right.type === "play") {
      return left.cardIndex === right.cardIndex && left.label === right.label;
    }
    return false;
  }

  private scoreAction(
    snapshot: GameSnapshot,
    self: Player,
    action: GameAction,
  ): { score: number; targetId?: string; reason: string } {
    if (action.type === "end") {
      return { score: -5 + self.hand.length * 0.1, reason: "结束出牌" };
    }
    if (action.type === "skill") {
      const target = action.requiresTarget ? this.pickHostileTarget(snapshot, self, action.targets) : undefined;
      const urgency = self.hp <= 2 ? 3 : 0.5;
      return {
        score: 4 + urgency + (target ? 2 : -3),
        ...(target ? { targetId: target } : {}),
        reason: target ? `技能压制 ${target}` : "无目标技能",
      };
    }
    const card = self.hand[action.cardIndex];
    if (!card) {
      return { score: -10, reason: "手牌越界" };
    }
    const target = action.requiresTarget ? this.pickTargetForCard(snapshot, self, action.targets, card.type) : undefined;
    if (action.requiresTarget && !target) {
      return { score: -8, reason: "无合法目标" };
    }
    const base = this.cardPlayValue(card.type, self, snapshot, target);
    const targetBonus = target ? this.targetBonus(snapshot, target) : 0;
    return {
      score: base + targetBonus,
      ...(target ? { targetId: target } : {}),
      reason: target ? `${card.type} -> ${target}` : `使用${card.type}`,
    };
  }

  private cardPlayValue(cardType: CardType, self: Player, snapshot: GameSnapshot, targetId?: string): number {
    if (cardType === CardType.Peach) {
      if (self.hp <= 1) {
        return 14;
      }
      if (self.hp <= 2) {
        return 10;
      }
      return self.hp < self.maxHp ? 5 : -4;
    }
    if (cardType === CardType.Wine && self.hand.some((card) => isSlashCard(card.type))) {
      return 7;
    }
    if (isSlashCard(cardType)) {
      return targetId ? 8 : 2;
    }
    if (cardType === CardType.Duel) {
      return targetId ? 7 : 1;
    }
    if (cardType === CardType.ExNihilo) {
      return 9;
    }
    if (cardType === CardType.Barbarian || cardType === CardType.ArrowRain) {
      return this.massTrickValue(snapshot, self, cardType === CardType.Barbarian ? "slash" : "dodge");
    }
    if (cardType === CardType.PeachGarden || cardType === CardType.Harvest) {
      return this.groupBenefitValue(snapshot, self);
    }
    if (cardType === CardType.Dismantle || cardType === CardType.Snatch) {
      return targetId ? 7 : 0;
    }
    if (cardType === CardType.Collateral || cardType === CardType.FireAttack || cardType === CardType.IronChain) {
      return targetId ? 6 : 0;
    }
    if (isEquipCard(cardType)) {
      return 5;
    }
    if (cardType === CardType.Dodge || cardType === CardType.Negate) {
      return -4;
    }
    return 2;
  }

  private pickTargetForCard(snapshot: GameSnapshot, self: Player, targets: string[], cardType: CardType): string | undefined {
    if (cardType === CardType.Peach || cardType === CardType.PeachGarden) {
      const allies = targets
        .map((id) => snapshot.players.find((item) => item.id === id))
        .filter((item): item is Player => Boolean(item?.alive) && item !== undefined && this.relationOf(self, item) === "ally")
        .sort((a, b) => a.hp - b.hp);
      return allies[0]?.id ?? (this.relationOf(self, self) === "self" && targets.includes(self.id) ? self.id : undefined);
    }
    return this.pickHostileTarget(snapshot, self, targets);
  }

  private pickHostileTarget(snapshot: GameSnapshot, self: Player, targets: string[]): string | undefined {
    let bestId: string | undefined;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const id of targets) {
      const target = snapshot.players.find((item) => item.id === id);
      if (!target || !target.alive || target.id === self.id) {
        continue;
      }
      const relation = this.relationOf(self, target);
      let score = relation === "enemy" ? 10 : relation === "unknown-traitor" ? 2 : -20;
      score += (4 - Math.max(target.hp, 0)) * 2 + Math.min(target.hand.length, 8) * 0.3;
      if (score > bestScore) {
        bestScore = score;
        bestId = target.id;
      }
    }
    return bestId;
  }

  private targetBonus(snapshot: GameSnapshot, targetId: string): number {
    const target = snapshot.players.find((item) => item.id === targetId);
    if (!target) {
      return 0;
    }
    return (4 - Math.max(target.hp, 0)) * 0.8 + Math.min(target.hand.length, 6) * 0.2;
  }

  private massTrickValue(snapshot: GameSnapshot, self: Player, counter: "slash" | "dodge"): number {
    let score = 0;
    for (const player of snapshot.players) {
      if (!player.alive || player.id === self.id) {
        continue;
      }
      const relation = this.relationOf(self, player);
      const value = 4 - Math.max(player.hp, 0) + 1 + (counter === "slash" ? 0.5 : 0);
      score += relation === "enemy" ? value : relation === "ally" ? -value : -value * 0.3;
    }
    return score;
  }

  private groupBenefitValue(snapshot: GameSnapshot, self: Player): number {
    let score = 1;
    for (const player of snapshot.players) {
      if (!player.alive) {
        continue;
      }
      const relation = this.relationOf(self, player);
      const missing = Math.max(0, player.maxHp - player.hp);
      score += relation === "ally" ? missing * 1.5 : relation === "enemy" ? -missing : -0.3;
    }
    return score;
  }

  private shouldNegate(snapshot: GameSnapshot, self: Player): boolean {
    const threatening = snapshot.players.some(
      (item) => item.alive && item.id !== self.id && item.hand.length >= 4 && this.relationOf(self, item) !== "ally",
    );
    return self.hp <= 2 || threatening;
  }

  private pickDiscardSource(sources: CardSource[], count: number): string | undefined {
    if (sources.length === 0) {
      return undefined;
    }
    const ranked = [...sources].sort((a, b) => this.sourceKeepValue(a) - this.sourceKeepValue(b));
    if (count > 1) {
      return ranked[0]?.sourceId;
    }
    return ranked[0]?.sourceId;
  }

  private sourceKeepValue(source: CardSource): number {
    if (!source.card) {
      return 3;
    }
    return this.cardKeepValue(source.card.type, undefined);
  }

  private cardKeepValue(cardType: CardType, self?: Player): number {
    if (cardType === CardType.Peach) {
      return self && self.hp <= 2 ? 100 : 60;
    }
    if (cardType === CardType.Dodge) {
      return 55;
    }
    if (cardType === CardType.Negate) {
      return 50;
    }
    if (isSlashCard(cardType)) {
      return 40;
    }
    if (cardType === CardType.Duel || cardType === CardType.Barbarian || cardType === CardType.ArrowRain) {
      return 38;
    }
    if (cardType === CardType.ExNihilo) {
      return 45;
    }
    if (isEquipCard(cardType)) {
      return 30;
    }
    if (cardType === CardType.Wine) {
      return 25;
    }
    return 10;
  }

  private trackIdentityFromEvent(line: string): void {
    const attacked = line.match(/^(.+?) 对 (.+?) 使用(.+)$/);
    if (attacked?.[1] && attacked[2]) {
      const actor = attacked[1].trim();
      const target = attacked[2].trim();
      if (target.includes("主公")) {
        this.identityGuess.set(actor, PlayerRole.Rebel);
      } else if (target.includes("反贼")) {
        const current = this.identityGuess.get(actor);
        if (current !== PlayerRole.Rebel) {
          this.identityGuess.set(actor, PlayerRole.Loyalist);
        }
      }
    }
  }

  private toConfidence(score: number): number {
    const clamped = Math.max(-10, Math.min(14, score));
    return Math.round(((clamped + 10) / 24) * 100) / 100;
  }
}
