import { callJevSystemOne, isJevConfigured, JevAnswer, JevOptions, JevQuestion, resolveJevAcceptThreshold } from "./jev.js";
import { LocalAiEngine, RoleGuess } from "./local-engine.js";
import { RoundPromptContext } from "./prompt.js";
import {
  FastAdvisor,
  JudgeVerdict,
  RankedAction,
  SystemOneInteractionDecision,
  SystemOneTurnDecision,
} from "./system-one.js";
import { CardSource, GameAction, GameSnapshot, InteractionDecision, InteractionRequest, Player, PlayerRole } from "../engine/game.js";
import { buildMatchGeneralsText } from "./match-context.js";
import { writeAiLog } from "../devlog/ailog.js";

/**
 * JevAdvisor：hybrid 的判断层 = LLM + Jev（TypeSafe System One 决策模型）。
 *
 * 不依赖任何本地决策模型：
 * - 出牌前不做本地预排序（LLM 正常拿完整候选动作）；
 * - LLM 出牌后调用 Jev，一次请求同时问两件事：
 *   `decision_ok`（noul：这个决策合理吗）+ `best_action`（choice：那最优是哪个，带概率分布）；
 * - 否决时用 Jev 的 `best_action` 作为回退，绝不回退本地启发式。
 *
 * 可用性兜底：Jev 调用失败时放行 LLM 的决策（不否决、不阻塞），对局继续。
 * 决定层（decideTurn / decideInteraction）在 Jev 不可用时一律返回 null，
 * 由上层回退本地策略——绝不把"失败"当成一个决策结果返回（否则 AI 会假装正常、濒死时不求桃）。
 * 说明：Jev 官方标注英文准确率最高、CJK 可用但需自行验证，因此 instructions 用英文，
 * state 里的对局数据保持中文原名（武将/卡牌名无法翻译）。
 *
 * 熔断（防「Jev 卡住」）：连续失败 `JEV_FAILURE_THRESHOLD`（默认 3）次后，冷却
 * `JEV_COOLDOWN_MS`（默认 60 秒）内直接跳过 Jev——否则 Jev 挂掉时**每一次**决策
 * 都要白等一轮超时，整张桌子看起来就是卡死。冷却结束后自动放行一次探测调用，
 * 成功即恢复；期间 `getLastFailureReason()` 仍保留失败原因（不是"跳过"）。
 * 每次调用（成功/失败/跳过）都带耗时写入 `devlog/ai-log.md`，Jev 的耗时不再不可见。
 */
/** 单次 Jev 调用的观测记录（默认写 devlog，可注入以测试）。 */
export type JevCallLogEntry = {
  label: string;
  ok: boolean;
  skipped: boolean;
  elapsedMs: number;
  questionCount: number;
  answers?: Record<string, JevAnswer>;
  error?: string;
};

export type JevAdvisorDeps = {
  /** 日志出口；默认写 devlog/ai-log.md。 */
  log?: (entry: JevCallLogEntry) => void;
  /** 取当前时间；测试可注入假时钟验证熔断冷却。 */
  now?: () => number;
};

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 60_000;

export class JevAdvisor implements FastAdvisor {
  private readonly acceptThreshold: number;

  /** choice 问题的最大候选数（Jev 上限 255，这里截断以控制 token 与噪声）。 */
  private readonly maxCandidates: number;

  private lastFailureReason: string | null = null;

  private judgeCalls = 0;

  private judgeFailures = 0;

  /** 熔断期间被跳过的调用次数（Jev 不可用时不再逐个决策白等超时）。 */
  private skippedCalls = 0;

  private consecutiveFailures = 0;

  /** 熔断打开到该时刻（毫秒时间戳）；0 表示未熔断。 */
  private circuitOpenUntil = 0;

  private readonly failureThreshold: number;

  private readonly cooldownMs: number;

  private readonly log: (entry: JevCallLogEntry) => void;

  private readonly now: () => number;

  /** 身份推断账本（与规则助手/本地策略同源；syncRounds 喂战报，决策时读 guesses）。 */
  private readonly roleEngine: LocalAiEngine;

  constructor(
    private readonly rulesText: string,
    private readonly options: JevOptions = {},
    deps: JevAdvisorDeps = {},
  ) {
    this.acceptThreshold = resolveJevAcceptThreshold();
    const raw = Number.parseInt(process.env.JEV_MAX_CANDIDATES ?? "", 10);
    this.maxCandidates = Number.isInteger(raw) && raw > 0 ? Math.min(raw, 255) : 40;
    const threshold = Number.parseInt(process.env.JEV_FAILURE_THRESHOLD ?? "", 10);
    this.failureThreshold = Number.isInteger(threshold) && threshold > 0 ? threshold : DEFAULT_FAILURE_THRESHOLD;
    const cooldown = Number.parseInt(process.env.JEV_COOLDOWN_MS ?? "", 10);
    this.cooldownMs = Number.isFinite(cooldown) && cooldown >= 0 ? cooldown : DEFAULT_COOLDOWN_MS;
    this.log = deps.log ?? this.writeDefaultLog.bind(this);
    this.now = deps.now ?? Date.now;
    this.roleEngine = new LocalAiEngine(rulesText);
  }

  /** 是否已配置 Jev（server/app 用它决定是否启用 Jev 判断层）。 */
  static isConfigured(): boolean {
    return isJevConfigured();
  }

  getLastFailureReason(): string | null {
    return this.lastFailureReason;
  }

  getStats(): {
    judgeCalls: number;
    judgeFailures: number;
    skippedCalls: number;
    circuitOpen: boolean;
  } {
    return {
      judgeCalls: this.judgeCalls,
      judgeFailures: this.judgeFailures,
      skippedCalls: this.skippedCalls,
      circuitOpen: this.isCircuitOpen(),
    };
  }

  reset(): void {
    this.lastFailureReason = null;
    this.consecutiveFailures = 0;
    this.circuitOpenUntil = 0;
  }

  /** 熔断是否打开（Jev 刚连续失败，冷却期内跳过调用）。 */
  private isCircuitOpen(): boolean {
    return this.now() < this.circuitOpenUntil;
  }

  /** 默认日志出口：写进 devlog/ai-log.md，Jev 的耗时/失败从此可见。 */
  private writeDefaultLog(entry: JevCallLogEntry): void {
    const detail = entry.skipped
      ? `(熔断跳过，未调用) ${entry.error ?? ""}`.trim()
      : entry.ok
        ? JSON.stringify(entry.answers)
        : `(失败) ${entry.error ?? ""}`;
    writeAiLog({
      provider: "jev",
      model: this.options.model ?? process.env.JEV_MODEL ?? "jev",
      stage: `jev-${entry.label}`,
      playerId: "-",
      playerName: "-",
      prompt: [{ role: "user", content: `questions=${entry.questionCount} elapsed=${entry.elapsedMs}ms` }],
      responseText: detail,
      ...(entry.ok ? {} : { error: entry.error ?? "Jev 调用失败" }),
    });
  }

  /** 跨回合记忆只用于身份推断账本（决策仍只看当前 state + guesses）。 */
  syncRounds(contexts: RoundPromptContext[]): void {
    this.roleEngine.syncPreviousRounds(contexts);
  }

  /** 不做本地预排序：返回空列表，LLM 拿到完整候选自行决策。 */
  rankTurnActions(
    _snapshot: GameSnapshot,
    _playerId: string,
    _actions: GameAction[],
  ): RankedAction[] {
    return [];
  }

  /** 无 LLM 时的兜底出牌：交给 Jev 的 choice 结果（不依赖本地模型）。 */
  async decideTurn(
    snapshot: GameSnapshot,
    playerId: string,
    actions: GameAction[],
    plan?: string,
  ): Promise<SystemOneTurnDecision | null> {
    // 候选按"动作×目标"展开：Jev 选中的就是最终目标，不再取 targets[0]
    //（曾经取第一个，座位顺序下主公经常中枪）。
    const candidates = expandActionCandidates(actions, this.maxCandidates);
    if (candidates.length === 0) {
      return null;
    }
    const guesses = this.roleEngine.getRoleGuesses(snapshot, playerId);
    const criteria = buildActionCriteria(candidates);
    const answers = await this.askJev(
      {
        ...decisionsState(snapshot, playerId, candidates, undefined, plan, guesses),
        match_skills: buildMatchGeneralsText(snapshot),
      },
      {
        best_action: {
          type: "choice",
          instructions: bestActionInstruction(snapshot, playerId, guesses),
          criteria,
        },
      },
      "decideTurn",
    );
    if (!answers) {
      // Jev 不可用：返回 null，由上层回退本地策略/启发式。
      // 绝不能在这里随便挑一个动作——否则失败会被当成"Jev 的决策"，日志与 modelUsed 都会说谎。
      return null;
    }
    const picked = pickActionFromAnswer(answers.best_action, candidates);
    if (!picked) {
      // Jev 有响应但解析不出可用动作，同样交回上层决定。
      return null;
    }
    return {
      action: picked.action,
      ...(picked.targetId ? { targetId: picked.targetId } : {}),
      confidence: picked.probability,
      reason: "Jev choice",
    };
  }

  /** 无 LLM 时的兜底响应：问 Jev 该不该出，出则取第一个可用来源。 */
  async decideInteraction(
    snapshot: GameSnapshot,
    playerId: string,
    request: InteractionRequest,
    plan?: string,
  ): Promise<SystemOneInteractionDecision | null> {
    if (request.kind === "choose-suit") {
      return null;
    }
    const answers = await this.askJev(
      {
        ...interactionState(snapshot, playerId, request, plan),
        match_skills: buildMatchGeneralsText(snapshot),
      },
      {
        should_respond: { type: "noul", instructions: interactionInstruction },
      },
      "decideInteraction",
    );
    if (!answers) {
      // Jev 不可用：返回 null 让上层走本地策略/默认响应。
      // 这里曾经固定返回 pass——那会让 AI 在濒死求桃、必闪时"主动放弃"，比引擎默认行为更差。
      return null;
    }
    const answer = answers.should_respond;
    if (!answer) {
      // 响应缺少 should_respond 字段：视为不可用，交回上层。
      return null;
    }
    if (answer.type === "noul" && answer.noul >= this.acceptThreshold && "sources" in request) {
      const source = (request.sources as CardSource[])[0];
      if (source) {
        return { decision: { choice: "card", sourceId: source.sourceId }, confidence: answer.noul, reason: "Jev noul" };
      }
    }
    // 这是 Jev 给出的明确判断（noul 低于阈值），不是调用失败：按不出牌处理。
    return { decision: { choice: "pass" }, confidence: 0.5, reason: "Jev 默认放弃" };
  }

  /**
   * 出牌 Judge：一次 Jev 请求同时问 decision_ok（noul）与 best_action（choice）。
   * 否决时把 Jev 给出的最优动作放进 fallback，供上层直接回退。
   */
  async judgeTurnDecision(
    snapshot: GameSnapshot,
    playerId: string,
    actions: GameAction[],
    decision: { action: GameAction; targetId?: string } | null | undefined,
  ): Promise<JudgeVerdict> {
    if (!decision) {
      return { accepted: false, score: 0, bestScore: 0 };
    }
    const candidates = expandActionCandidates(actions, this.maxCandidates);
    const criteria = buildActionCriteria(candidates);
    const guesses = this.roleEngine.getRoleGuesses(snapshot, playerId);
    const proposedEntry = findCandidateIndex(candidates, decision.action, decision.targetId);
    const proposed = proposedEntry >= 0 ? describeCandidate(candidates[proposedEntry] as ActionCandidate) : proposedActionText(decision);
    const questions: Record<string, JevQuestion> = {
      decision_ok: {
        type: "noul",
        instructions:
          "Given the game state, is the proposed action a reasonable decision for this player? " +
          "The action is already legal, so judge strategy only. " +
          "Answer no if it harms the player's own faction, wastes a key card (桃/无懈可击/闪) for no gain, " +
          "targets an ally, or throws the game.",
        criteria: {
          true: "A sane, justifiable move for this player's faction and situation",
          false: "Clearly bad: self-harming, allied-targeting, or wasteful",
        },
      },
      ...(Object.keys(criteria).length > 0
        ? {
            best_action: {
              type: "choice" as const,
              instructions: bestActionInstruction(snapshot, playerId, guesses),
              criteria,
            },
          }
        : {}),
    };
    const answers = await this.askJev(
      {
        ...decisionsState(snapshot, playerId, candidates, proposed, undefined, guesses),
        match_skills: buildMatchGeneralsText(snapshot),
      },
      questions,
      "judgeTurnDecision",
    );
    if (!answers) {
      return { accepted: true, score: 0, bestScore: 0 };
    }
    const ok = answers.decision_ok;
    const accepted = ok?.type === "noul" ? ok.noul >= this.acceptThreshold : true;
    const best = pickActionFromAnswer(answers.best_action, candidates);
    const proposedProbability = probabilityOf(answers.best_action, proposedEntry >= 0 ? `action_${proposedEntry + 1}` : null);
    return {
      accepted,
      score: proposedProbability,
      bestScore: best?.probability ?? 0,
      ...(best ? { fallback: best.targetId ? { action: best.action, targetId: best.targetId } : { action: best.action } } : {}),
    };
  }

  /** 交互 Judge：问 Jev「这张牌该不该打」（保命响应不应放弃）。失败时放行 LLM 决策。 */
  async judgeInteractionDecision(
    snapshot: GameSnapshot,
    playerId: string,
    request: InteractionRequest,
    decision: InteractionDecision | null | undefined,
  ): Promise<boolean> {
    if (!decision || request.kind === "choose-suit") {
      return true;
    }
    const questions: Record<string, JevQuestion> = {
      should_respond: {
        type: "noul",
        instructions: interactionInstruction,
        criteria: {
          true: "Playing the card now is correct",
          false: "Better to pass and keep the card",
        },
      },
    };
    const answers = await this.askJev(
      {
        ...interactionState(snapshot, playerId, request),
        proposed_decision: describeInteractionChoice(decision),
        match_skills: buildMatchGeneralsText(snapshot),
      },
      questions,
      "judgeInteractionDecision",
    );
    if (!answers) {
      return true;
    }
    const answer = answers.should_respond;
    return answer?.type === "noul" ? answer.noul >= this.acceptThreshold : true;
  }

  /**
   * 单次 Jev 判断调用：返回 null 表示失败或被熔断跳过（调用方按"放行"处理，不阻塞对局）。
   * 连续失败达到阈值时打开熔断，冷却期内不再发起请求——避免 Jev 挂掉后每个决策都白等超时。
   */
  private async askJev(
    state: Record<string, unknown>,
    questions: Record<string, JevQuestion>,
    label: string,
  ): Promise<Record<string, JevAnswer> | null> {
    const questionCount = Object.keys(questions).length;
    const startedAt = this.now();
    if (this.isCircuitOpen()) {
      this.skippedCalls += 1;
      this.log({
        label,
        ok: false,
        skipped: true,
        elapsedMs: 0,
        questionCount,
        ...(this.lastFailureReason ? { error: this.lastFailureReason } : {}),
      });
      return null;
    }
    this.judgeCalls += 1;
    try {
      const result = await callJevSystemOne({ ...state, rules: this.rulesText }, questions, this.options);
      this.consecutiveFailures = 0;
      this.circuitOpenUntil = 0;
      this.lastFailureReason = null;
      this.log({ label, ok: true, skipped: false, elapsedMs: this.now() - startedAt, questionCount, answers: result.answers });
      return result.answers;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.judgeFailures += 1;
      this.consecutiveFailures += 1;
      this.lastFailureReason = reason;
      if (this.consecutiveFailures >= this.failureThreshold) {
        this.circuitOpenUntil = this.now() + this.cooldownMs;
      }
      this.log({ label, ok: false, skipped: false, elapsedMs: this.now() - startedAt, questionCount, error: reason });
      return null;
    }
  }
}

const interactionInstruction =
  "Should this player play the proposed card to respond right now? " +
  "Answer yes for life-saving responses (求桃, 残血应闪/应杀). " +
  "Answer no for wasting key cards (无懈可击/闪) with no real threat.";

/** 展开后的候选：目标已定死，Jev 选中哪个就是哪个，不再二次解释。 */
export type ActionCandidate = {
  action: GameAction;
  targetId?: string;
};

/**
 * 把可玩动作按"动作×目标"展开（有目标动作每个目标占一项）。
 * 曾经只按动作枚举、命中后取 targets[0]——座位顺序下主公经常排第一，
 * 杀出去落到主公头上，而 Jev 从头到尾没见过这个选择。
 */
export const expandActionCandidates = (actions: GameAction[], max: number): ActionCandidate[] => {
  const out: ActionCandidate[] = [];
  for (const action of actions) {
    if (action.type !== "end" && action.requiresTarget && action.targets.length > 0) {
      for (const targetId of action.targets) {
        out.push({ action, targetId });
        if (out.length >= max) {
          return out;
        }
      }
    } else {
      out.push({ action });
      if (out.length >= max) {
        return out;
      }
    }
  }
  return out;
};

export const describeCandidate = (candidate: ActionCandidate): string => {
  if (candidate.action.type === "end") {
    return "结束出牌阶段";
  }
  const kind = candidate.action.type === "skill" ? "发动技能" : "使用";
  return `${kind} ${candidate.action.label}${candidate.targetId ? `（目标：${candidate.targetId}）` : ""}`;
};

/** 在展开候选中定位 LLM 决策（动作相同 + 目标相同），找不到返回 -1。 */
export const findCandidateIndex = (
  candidates: ActionCandidate[],
  action: GameAction,
  targetId?: string,
): number =>
  candidates.findIndex(
    (entry) => sameAction(entry.action, action) && (entry.targetId ?? undefined) === (targetId ?? undefined),
  );

/** LLM 决策不在候选里时的兜底描述（Judge 的 proposed_decision 用）。 */
const proposedActionText = (decision: { action: GameAction; targetId?: string }): string =>
  describeCandidate({ action: decision.action, ...(decision.targetId ? { targetId: decision.targetId } : {}) });

export const buildActionCriteria = (candidates: ActionCandidate[]): Record<string, string> => {
  const criteria: Record<string, string> = {};
  candidates.forEach((candidate, index) => {
    criteria[`action_${index + 1}`] = describeCandidate(candidate);
  });
  return criteria;
};

export const pickActionFromAnswer = (
  answer: JevAnswer | undefined,
  candidates: ActionCandidate[],
): { action: GameAction; targetId?: string; probability: number } | null => {
  if (!answer || answer.type !== "choice") {
    return null;
  }
  const index = Number.parseInt(answer.choice.replace(/^action_/, ""), 10) - 1;
  const candidate = candidates[index];
  if (!candidate) {
    return null;
  }
  const probability = answer.probabilities?.[answer.choice] ?? answer.confidence ?? 0;
  return candidate.targetId
    ? { action: candidate.action, targetId: candidate.targetId, probability }
    : { action: candidate.action, probability };
};

const probabilityOf = (answer: JevAnswer | undefined, key: string | null): number => {
  if (!answer || answer.type !== "choice" || !key) {
    return 0;
  }
  return answer.probabilities?.[key] ?? 0;
};

const sameAction = (left: GameAction, right: GameAction): boolean => {
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
};

/** 构造给 Jev 的 state：结构化对局快照 + 候选动作（+ 待审核决策 + 身份推断）。 */
const decisionsState = (
  snapshot: GameSnapshot,
  playerId: string,
  candidates: ActionCandidate[],
  proposed?: string,
  plan?: string,
  guesses: RoleGuess[] = [],
): Record<string, unknown> => ({
  acting_player: describePlayerContext(snapshot, playerId),
  players: snapshot.players.map((player) => describePlayer(player, playerId)),
  legal_actions: candidates.map((candidate, index) => ({ id: `action_${index + 1}`, action: describeCandidate(candidate) })),
  ...(proposed ? { proposed_decision: proposed } : {}),
  ...(plan ? { strategic_plan: plan } : {}),
  role_guesses: describeRoleGuesses(guesses),
});

/** 身份推断喂给 Jev：公开的直给，隐藏的只给行为结论（与规则助手同一账本）。 */
const describeRoleGuesses = (guesses: RoleGuess[]): string[] =>
  guesses.map((guess) => {
    if (!guess.inferred) {
      return `${guess.name}: ${guess.role} (public knowledge)`;
    }
    const basis = guess.reasons.length > 0 ? ` based on ${guess.reasons.join("; ")}` : " (no clear behavior yet)";
    return `${guess.name}: guessed ${guess.role} (confidence ${guess.confidence})${basis}`;
  });

const interactionState = (
  snapshot: GameSnapshot,
  playerId: string,
  request: InteractionRequest,
  plan?: string,
): Record<string, unknown> => ({
  response_player: describePlayerContext(snapshot, playerId),
  players: snapshot.players.map((player) => describePlayer(player, playerId)),
  interaction: {
    kind: request.kind,
    response_kind: "responseKind" in request ? request.responseKind : undefined,
    reason: request.reason,
    available_sources: "sources" in request ? request.sources.map((source) => source.label).join(", ") : "none",
  },
  ...(plan ? { strategic_plan: plan } : {}),
});

const describePlayerContext = (snapshot: GameSnapshot, playerId: string): string => {
  const self = snapshot.players.find((item) => item.id === playerId);
  if (!self) {
    return "unknown";
  }
  return `${self.name}（身份${self.role}，武将${self.general}，体力${self.hp}/${self.maxHp}，手牌${self.hand.length}）`;
};

const describePlayer = (player: Player, viewerId: string): string => {
  const role = player.id === viewerId || player.role === PlayerRole.Lord || !player.alive ? player.role : "未知";
  if (!player.alive) {
    return `${player.name}（${role}，已阵亡）`;
  }
  const equip = [player.weapon, player.armor, player.defenseHorse, player.attackHorse, player.treasure]
    .filter(Boolean)
    .join("/");
  return `${player.name}（${role}，武将${player.general}，体力${player.hp}/${player.maxHp}，手牌${player.hand.length}${equip ? `，装备${equip}` : ""}）`;
};

/**
 * 出牌 choice 问题的指令：阵营约束 + 目标已定死声明。
 * 曾经这里只有一句话，导致 Jev 不知道谁是敌人、也不知道目标不可改——
 * 忠臣/内奸杀主公大多出自这一问。
 */
export const bestActionInstruction = (
  snapshot: GameSnapshot,
  playerId: string,
  guesses: RoleGuess[],
): string => {
  const self = snapshot.players.find((player) => player.id === playerId);
  const lord = snapshot.players.find((player) => player.role === PlayerRole.Lord);
  const lines = [
    "Which single action is best for this player right now?",
    "Each option already includes its FIXED target in parentheses: choosing an option also chooses that target, you cannot retarget.",
    "Targeting an ally or the wrong faction loses the game for your side; when in doubt prefer 结束出牌阶段 (end turn) over attacking an unknown player.",
  ];
  if (self) {
    lines.push(`You are ${self.name}, role ${self.role}.`);
  }
  if (lord && self && self.id !== lord.id) {
    if (self.role === PlayerRole.Loyalist) {
      lines.push(`The lord is ${lord.name}: NEVER choose an action targeting the lord, you are on the same side.`);
    } else if (self.role === PlayerRole.Rebel) {
      lines.push(`The lord ${lord.name} is your enemy: prefer actions targeting the lord or known rebels' enemies.`);
    } else {
      lines.push(`The lord is ${lord.name}: do not attack the lord unless role_guesses give high-confidence rebel cover.`);
    }
  }
  const inferred = guesses.filter((guess) => guess.inferred);
  if (inferred.length > 0) {
    lines.push(`Suspected identities: ${inferred.map((guess) => `${guess.name}=${guess.role}(${guess.confidence})`).join(", ")}.`);
  }
  return lines.join(" ");
};

const describeInteractionChoice = (decision: InteractionDecision): string => {
  if (decision.choice === "pass") {
    return "放弃（pass）";
  }
  if (decision.choice === "card") {
    return `打出牌 ${decision.sourceId}`;
  }
  if (decision.choice === "target") {
    return `指定目标 ${decision.targetId}`;
  }
  if (decision.choice === "suit") {
    return `声明花色 ${decision.suit}`;
  }
  return `发动效果 ${decision.enabled ? "是" : "否"}`;
};
