import { CardType } from "../engine/cards.js";
import { isArmorCard, isAttackHorseCard, isDefenseHorseCard, isSlashCard, isTreasureCard, isWeaponCard } from "../engine/card-utils.js";
import { CardSource, GameAction, GameSnapshot, InteractionDecision, InteractionRequest, PlayerRole, SanGuoGame } from "../engine/game.js";
import { resolveSkillDescriptor } from "../engine/skill-registry.js";
import { FREE_BENEFIT_EFFECTS, HARMFUL_TRICKS } from "./system-one.js";
import { buildMatchGeneralsText } from "./match-context.js";
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

export type LocalAiInteractionDecision = {
  decision: InteractionDecision;
  insight: string;
};

/** 助手/复盘用的身份猜测：只基于行为账本，绝不读隐藏身份（见 visibleRole 约定）。 */
export type RoleGuess = {
  playerId: string;
  name: string;
  /** 公开身份（自己/主公/已阵亡）直接给真实值；其余为推断值。 */
  role: PlayerRole;
  inferred: boolean;
  confidence: "high" | "medium" | "low";
  reasons: string[];
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

  private maxContextRounds: number;

  /** 联机断线托管：允许对 isAI=false 的人类座位做出牌决策。 */
  private allowNonAiSeats = false;

  /** 本局在场武将技能文本（与 LLM/Jev 同源，见 match-context.ts）。 */
  private matchGeneralsText = "";

  /** 生成 matchGeneralsText 用的快照签名，避免每步重算。 */
  private matchGeneralsKey = "";

  /** 本局在场技能数（去重），用于 getMemorySummary 诊断。 */
  private matchSkillCount = 0;

  constructor(rulesText: string) {
    this.rulesText = rulesText;
    this.memory = [];
    this.processedRounds = new Set();
    this.behaviorByName = new Map();
    this.roleScoreByName = new Map();
    this.maxContextRounds = 30;
  }

  setMaxContextRounds(rounds: number): void {
    if (Number.isInteger(rounds) && rounds > 0) {
      this.maxContextRounds = rounds;
    }
  }

  /** 联机断线托管用：允许对 isAI=false 的人类座位做决策。 */
  setAllowNonAiSeats(enabled: boolean): void {
    this.allowNonAiSeats = enabled;
  }

  reset(): void {
    this.memory = [];
    this.processedRounds.clear();
    this.behaviorByName.clear();
    this.roleScoreByName.clear();
    this.matchGeneralsText = "";
    this.matchGeneralsKey = "";
    this.matchSkillCount = 0;
  }

  /**
   * 本局在场武将技能文本（与 LLM / Jev 看到的同源，见 `match-context.ts`）。
   * 本地策略没有 LLM，因此这份文本的用途是：让 `evaluateAction` 能按技能元数据（targetIntent 等）
   * 选对目标，并让 `getMemorySummary()` 能报告"本局认识哪些武将技能"。
   */
  getMatchGeneralsText(): string {
    return this.matchGeneralsText;
  }

  /** 按快照刷新在场武将技能文本；只有武将/技能集合变化时才重算。 */
  private refreshMatchGenerals(snapshot: GameSnapshot): void {
    const key = snapshot.players.map((player) => `${player.general}:${player.skills.join("|")}`).join(";");
    if (key === this.matchGeneralsKey) {
      return;
    }
    this.matchGeneralsKey = key;
    this.matchGeneralsText = buildMatchGeneralsText(snapshot);
    this.matchSkillCount = new Set(snapshot.players.flatMap((player) => player.skills)).size;
  }

  syncPreviousRounds(contexts: RoundPromptContext[]): void {
    this.memory = contexts.slice(-this.maxContextRounds);
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
    if (!self || !self.alive || (!self.isAI && !this.allowNonAiSeats) || snapshot.currentPlayerId !== playerId) {
      return null;
    }
    const actions = game.getPlayableActions(playerId);
    if (actions.length === 0) {
      return null;
    }
    this.refreshMatchGenerals(snapshot);
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

  /**
   * 响应决策（simple 驱动的交互入口，供服务端 decideInteractionAi 调用）。
   * 身份判断只用**可见信息**（自己 / 主公 / 已阵亡）+ 行为推断（`visibleRole`/`predictRole`）：
   * 桃只救自己和推断出的队友、无懈看清再交、决斗智能出杀、白嫖技能自动发动、
   * 借刀选推断出的敌方、弃低价值牌。**不得读 `player.role`**（那会让 AI 明牌作弊）。
   */
  decideInteraction(
    snapshot: GameSnapshot,
    playerId: string,
    request: InteractionRequest,
  ): LocalAiInteractionDecision | null {
    const self = snapshot.players.find((item) => item.id === playerId);
    if (!self || !self.alive) {
      return null;
    }
    const selfRole = self.role;
    if (request.kind === "choose-suit") {
      return null;
    }
    if (request.kind === "optional-effect") {
      const enabled = this.shouldActivateEffect(self, request.effect);
      return {
        decision: { choice: "effect", enabled },
        insight: enabled ? `发动${request.effect}（无代价收益）` : `不发动${request.effect}`,
      };
    }
    if (request.kind === "collateral") {
      const targetId = this.pickCollateralVictim(snapshot, self, request.victims);
      if (targetId) {
        const firstSlash = request.sources[0];
        return {
          decision: firstSlash
            ? { choice: "target", targetId, sourceId: firstSlash.sourceId }
            : { choice: "target", targetId },
          insight: `借刀指向手牌最少的敌方`,
        };
      }
      return { decision: { choice: "pass" }, insight: "无可借刀敌方" };
    }
    if (request.kind === "choose-discard") {
      const sourceId = this.pickDiscardSource(request.sources);
      if (sourceId) {
        return { decision: { choice: "card", sourceId }, insight: "弃低价值牌" };
      }
      return { decision: { choice: "pass" }, insight: "无可弃牌" };
    }
    const usable = request.sources[0];
    if (request.responseKind === "peach") {
      const dying = snapshot.players.find((item) => item.id === request.trigger.actorId);
      const ally = !dying || dying.id === self.id || this.isAlly(selfRole, this.visibleRole(snapshot, self.id, dying));
      if (usable && ally) {
        return {
          decision: { choice: "card", sourceId: usable.sourceId },
          insight: dying && dying.id !== self.id ? "桃救队友" : "桃自救",
        };
      }
      return { decision: { choice: "pass" }, insight: "不救敌人" };
    }
    if (request.responseKind === "slash") {
      const slashCount = self.hand.filter((card) => isSlashCard(card.type)).length;
      const duelist = snapshot.players.find((item) => item.id === request.trigger.actorId);
      const lethal = duelist !== undefined && duelist.hp <= 1 && !this.isAlly(selfRole, this.visibleRole(snapshot, self.id, duelist));
      if (usable && (self.hp <= 1 || slashCount >= 2 || (lethal && slashCount >= 1))) {
        return { decision: { choice: "card", sourceId: usable.sourceId }, insight: "决斗出杀" };
      }
      return { decision: { choice: "pass" }, insight: "决斗留杀" };
    }
    if (request.responseKind === "dodge") {
      if (usable) {
        return { decision: { choice: "card", sourceId: usable.sourceId }, insight: "出闪" };
      }
      return { decision: { choice: "pass" }, insight: "无闪" };
    }
    if (usable && this.shouldNegate(snapshot, self, request)) {
      return { decision: { choice: "card", sourceId: usable.sourceId }, insight: "关键锦囊反制" };
    }
    return { decision: { choice: "pass" }, insight: "保留手牌" };
  }

  private shouldActivateEffect(self: { hand: Array<{ id: string }>; hp: number }, effect: string): boolean {
    if (FREE_BENEFIT_EFFECTS.has(effect)) {
      return true;
    }
    if (effect === "克己" || effect.endsWith("/克己")) {
      return self.hand.length > self.hp;
    }
    return false;
  }

  private pickCollateralVictim(
    snapshot: GameSnapshot,
    self: { id: string; role: PlayerRole },
    victims: string[],
  ): string | undefined {
    const hostiles = victims
      .map((id) => snapshot.players.find((item) => item.id === id))
      .filter(
        (item): item is NonNullable<typeof item> =>
          item !== undefined && item.alive && !this.isAlly(self.role, this.visibleRole(snapshot, self.id, item)),
      );
    if (hostiles.length === 0) {
      return undefined;
    }
    hostiles.sort((a, b) => a.hand.length - b.hand.length || b.hp - a.hp);
    return hostiles[0]?.id;
  }

  private shouldNegate(
    snapshot: GameSnapshot,
    self: { id: string; hp: number; role: PlayerRole },
    request: Extract<InteractionRequest, { kind: "respond" }>,
  ): boolean {
    const trick = request.trigger.cardName;
    const actor = snapshot.players.find((item) => item.id === request.trigger.actorId);
    const actorIsAlly = actor !== undefined && (actor.id === self.id || this.isAlly(self.role, this.visibleRole(snapshot, self.id, actor)));
    if (trick === (CardType.PeachGarden as string) || trick === (CardType.Harvest as string)) {
      return this.groupTrickNetEnemyGain(snapshot, self.id, self.role) > 0;
    }
    if (trick === (CardType.ExNihilo as string)) {
      // 无中生有只补使用者自己：只反制敌人的补牌，不反制队友的。
      return !actorIsAlly;
    }
    if (HARMFUL_TRICKS.has(trick)) {
      return !actorIsAlly;
    }
    return self.hp <= 2;
  }

  private groupTrickNetEnemyGain(snapshot: GameSnapshot, selfId: string, selfRole: PlayerRole): number {
    let net = 0;
    for (const player of snapshot.players) {
      if (!player.alive) {
        continue;
      }
      const ally = this.isAlly(selfRole, this.visibleRole(snapshot, selfId, player));
      const missing = Math.max(0, player.maxHp - player.hp);
      const gain = missing > 0 ? missing : 0.3;
      net += ally ? -gain : gain * 0.7;
    }
    return net;
  }

  /** 弃牌选价值最低的一张（桃/闪/无懈优先保留，装备次之）。 */
  private pickDiscardSource(sources: CardSource[]): string | undefined {
    if (sources.length === 0) {
      return undefined;
    }
    const valueOf = (cardType?: CardType): number => {
      if (cardType === CardType.Peach) return 100;
      if (cardType === CardType.Dodge) return 80;
      if (cardType === CardType.Negate) return 70;
      if (cardType === CardType.ExNihilo) return 60;
      if (cardType !== undefined && isSlashCard(cardType)) return 40;
      return 10;
    };
    const ranked = [...sources].sort((a, b) => valueOf(a.card?.type) - valueOf(b.card?.type));
    return ranked[0]?.sourceId;
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

  /**
   * 视角内**可见**的身份：自己、主公、已阵亡玩家是公开信息（与客户端 `createClientSnapshot` 和
   * LLM 侧 `prompt.maskRole` 同口径）；其余存活玩家的身份**只能靠行为推断**（`predictRole`）。
   * 绝不读 `player.role` —— 否则 AI 就是明牌作弊（在线对局里等于开天眼）。
   */
  private visibleRole(
    snapshot: GameSnapshot,
    selfId: string,
    player: { id: string; role: PlayerRole; alive: boolean },
  ): PlayerRole {
    if (player.id === selfId || player.role === PlayerRole.Lord || !player.alive) {
      return player.role;
    }
    return this.predictRole(snapshot, player.id);
  }

  /**
   * 玩家助手用的身份猜测表（以 viewerId 为视角）。
   * 公开信息（自己/主公/已阵亡）直接给真实身份；其余只读行为账本推断，
   * 与局内决策同一口径，调用前先 `syncPreviousRounds` 同步战报。
   */
  getRoleGuesses(snapshot: GameSnapshot, viewerId: string): RoleGuess[] {
    return snapshot.players.map((player) => {
      if (player.id === viewerId || player.role === PlayerRole.Lord || !player.alive) {
        return { playerId: player.id, name: player.name, role: player.role, inferred: false, confidence: "high" as const, reasons: [] };
      }
      const behavior = this.ensureBehavior(player.name);
      const roleScore = this.ensureRoleScore(player.name);
      const handFactor = Math.min(player.hand.length, 6) * 0.1;
      const scored = [
        { role: PlayerRole.Loyalist, score: roleScore.loyalist + behavior.supportive * 0.5 + handFactor * 0.2 },
        { role: PlayerRole.Rebel, score: roleScore.rebel + behavior.aggressive * 0.2 + behavior.attackedLord * 0.8 },
        { role: PlayerRole.Traitor, score: roleScore.traitor + handFactor * 0.4 },
      ].sort((a, b) => b.score - a.score);
      const best = scored[0] ?? { role: PlayerRole.Rebel, score: 0 };
      const margin = best.score - (scored[1]?.score ?? 0);
      const reasons: string[] = [];
      if (behavior.attackedLord > 0) reasons.push(`攻击主公${behavior.attackedLord}次`);
      if (behavior.attackedLoyalist > 0) reasons.push(`攻击忠臣${behavior.attackedLoyalist}次`);
      if (behavior.attackedRebel > 0) reasons.push(`攻击反贼${behavior.attackedRebel}次`);
      if (behavior.supportive > 0) reasons.push(`支援（用桃）${behavior.supportive}次`);
      if (behavior.aggressive > 0 && behavior.attackedLord === 0) reasons.push(`主动出击${behavior.aggressive}次`);
      return {
        playerId: player.id,
        name: player.name,
        role: best.role,
        inferred: true,
        confidence: margin >= 2 ? "high" : margin >= 0.5 ? "medium" : "low",
        reasons,
      };
    });
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
      // 技能元数据来自注册表（内置 + 外部武将包同一入口）：
      // targetIntent 决定这是"打敌人"还是"支援队友"的技能，避免把青囊/结姻/仁德丢到敌方身上。
      const descriptor = resolveSkillDescriptor(action.skill);
      const skillName = descriptor.displayName ?? action.skill;
      const allyTarget = descriptor.targetIntent === "ally";
      const targetEval = action.requiresTarget
        ? this.pickTargetForAction(snapshot, selfRole, action.targets, allyTarget ? "skill-ally" : "skill")
        : { score: 0, targetId: undefined, roleGuess: "", cardPrediction: { slash: 0, dodge: 0, negate: 0 } };
      const hpUrgency = self.hp <= 2 ? 2.5 : 0.5;
      const skillScore = 4 + hpUrgency + targetEval.score;
      const skillInsight = targetEval.targetId
        ? `技能${skillName}${allyTarget ? "支援" : "压制"} ${targetEval.roleGuess}，目标牌预判 杀${targetEval.cardPrediction.slash.toFixed(2)} 闪${targetEval.cardPrediction.dodge.toFixed(2)} 无懈${targetEval.cardPrediction.negate.toFixed(2)}`
        : `技能${skillName}收益`;
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
    } else if (cardType === CardType.Wine) {
      // 酒杀连招：有杀在手时酒排 10.5（高于常规杀），保证先喝酒再出杀；无杀喝酒等于白给。
      baseScore = self.hand.some((card) => isSlashCard(card.type)) ? 10.5 : -2;
    } else if (cardType === CardType.ExNihilo) {
      baseScore = 9;
    } else if (isSlashCard(cardType)) {
      // 手里有酒时杀稍降，让酒先行打出连招；酒喝完后杀恢复。
      const hasWine = self.hand.some((card) => card.type === CardType.Wine);
      baseScore = (hasWine ? 7.5 : 8) + (1 - targetEval.cardPrediction.dodge) * 3;
    } else if (cardType === CardType.Duel) {
      baseScore = 7 + (1 - targetEval.cardPrediction.slash) * 2;
    } else if (cardType === CardType.Dismantle || cardType === CardType.Snatch) {
      baseScore = 7 + targetEval.score * 0.6;
      // 目标有装备时拆/顺价值大增（诸葛连弩/八卦阵这种关键装备必须拆）。
      const target = targetEval.targetId ? snapshot.players.find((item) => item.id === targetEval.targetId) : undefined;
      if (target && (target.weapon !== null || target.armor !== null || target.attackHorse !== null || target.defenseHorse !== null)) {
        baseScore += 3;
      }
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
      // 别重复占槽：同槽位已有装备时再装等于白扔一张牌。
      baseScore = this.equipSlotOccupied(self, cardType) ? 0 : 5;
    } else if (cardType === CardType.Negate || cardType === CardType.Dodge) {
      baseScore = -3;
    } else {
      baseScore = 2;
    }
    const score = baseScore + targetEval.score + this.lethalBonus(snapshot, selfRole, targetEval.targetId, cardType);
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

  /** 斩杀加成：能直接带走 1 血敌方时 +6，优先补刀。 */
  private lethalBonus(
    snapshot: GameSnapshot,
    selfRole: PlayerRole,
    targetId: string | undefined,
    cardType: CardType,
  ): number {
    if (!targetId) {
      return 0;
    }
    const isDamage =
      isSlashCard(cardType) ||
      cardType === CardType.Duel ||
      cardType === CardType.Barbarian ||
      cardType === CardType.ArrowRain ||
      cardType === CardType.FireAttack;
    if (!isDamage) {
      return 0;
    }
    const target = snapshot.players.find((item) => item.id === targetId);
    if (!target || target.hp > 1) {
      return 0;
    }
    return this.isAlly(selfRole, this.predictRole(snapshot, targetId)) ? 0 : 6;
  }

  /** 装备槽位是否已被占用（武器/防具/马/宝物各一槽）。 */
  private equipSlotOccupied(
    self: { weapon: unknown; armor: unknown; attackHorse: unknown; defenseHorse: unknown; treasure: unknown },
    cardType: CardType,
  ): boolean {
    if (isWeaponCard(cardType)) {
      return self.weapon !== null;
    }
    if (isArmorCard(cardType)) {
      return self.armor !== null;
    }
    if (isAttackHorseCard(cardType)) {
      return self.attackHorse !== null;
    }
    if (isDefenseHorseCard(cardType)) {
      return self.defenseHorse !== null;
    }
    if (isTreasureCard(cardType)) {
      return self.treasure !== null;
    }
    return false;
  }

  private pickTargetForAction(
    snapshot: GameSnapshot,
    selfRole: PlayerRole,
    targets: string[],
    cardType: CardType | "skill" | "skill-ally",
  ): {
    score: number;
    targetId?: string;
    roleGuess: string;
    cardPrediction: CardPrediction;
  } {
    // `skill-ally`：支援型技能（青囊/结姻/仁德/制霸），利好队友、绝不主动丢给敌人。
    const allySkill = cardType === "skill-ally";
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
      let score = allySkill ? (ally ? 8 : -14) : ally ? -14 : 8;
      if (allySkill) {
        // 支援型技能：优先把回复/牌交给损失体力最多的己方。
        score += (target.maxHp - target.hp) * 2.2;
      } else {
        score += (4 - Math.max(target.hp, 0)) * 1.8;
        score += target.hand.length * 0.35;
      }
      if (cardType === CardType.Slash || cardType === CardType.FireSlash || cardType === CardType.ArrowRain) {
        score += (1 - prediction.dodge) * 3;
      }
      if (cardType === CardType.Duel || cardType === CardType.Barbarian) {
        score += (1 - prediction.slash) * 2.2;
      }
      if (cardType === CardType.Dismantle || cardType === CardType.Snatch) {
        score += target.hand.length * 0.7 + prediction.negate * 0.9;
      }
      if (cardType === "skill" || allySkill) {
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
    return `memoryRounds=${rounds || "none"} rulesLoaded=${hasRules ? "yes" : "no"} matchSkills=${this.matchSkillCount}`;
  }
}
