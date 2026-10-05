import { SanGuoGame } from "../engine/game.js";
import type { GameSnapshot, InteractionDecision, InteractionRequest, Player } from "../engine/game.js";
import { resolveGeneralByName } from "../engine/generals.js";
import type { RngFn } from "../engine/types.js";

/**
 * Headless 自对弈不变量断言（计划 Step 5 / M4）。
 *
 * 用途：给"引擎改动"和"外部武将包"提供同一条自动反馈通道——
 * 把一局牌从头打到尾，全程断言不变量，任何崩溃/卡死/状态自相矛盾都变成一条结构化违规记录，
 * 而不是等玩家在对局里踩到。
 *
 * 与真实对局的区别（有意为之，便于复现）：
 * - 全部座位 `isAI = true`，出牌决策走引擎内置启发式 `getBestAiDecision`；
 * - 座位交互由 `answerInteraction` 统一应答（可选效果一律发动），因此会走遍技能的交互分支；
 * - RNG 用 `mulberry32(seed)`，同一 seed 必然复现同一局。
 */

export type SelfPlayRule =
  | "crashed"
  | "turn-stuck"
  | "hp-over-max"
  | "alive-without-hp"
  | "dead-with-hp";

export type SelfPlayViolation = {
  game: number;
  seed: number;
  turn: number;
  rule: SelfPlayRule;
  message: string;
  /** 崩溃前最后几步的动作描述，便于定位是哪个技能炸的。 */
  context: string[];
};

export type SelfPlayReport = {
  games: number;
  steps: number;
  turns: number;
  /** 在 maxSteps 内正常分出胜负的局数。 */
  finished: number;
  violations: SelfPlayViolation[];
};

export type SelfPlayOptions = {
  games?: number;
  playerCount?: number;
  maxStepsPerGame?: number;
  seed?: number;
  /** 把该武将强制指派给所有座位（用于让外部武将包的技能一定被走到）。 */
  forceGeneral?: string;
  log?: (line: string) => void;
};

type Runtime = {
  players: Player[];
};

/**
 * 复刻服务器在每次动作后的收尾（`server.ts` 的断线托管路径）。
 *
 * `initNetworkGame` 会把 `staged` 置为 true：回合结束/下个回合都由宿主显式消费，
 * 引擎不会自动推进。自对弈要模拟联机环境，就必须自己走完这套"延迟结算"：
 * 死亡结算 → 跳过阵亡者的回合 → 挂起的回合结束 → 挂起的下个回合。
 */
const settleStagedTurn = async (game: SanGuoGame): Promise<void> => {
  const runtime = game as unknown as Runtime;
  // 反复消费直到既没有挂起的回合结束、也没有挂起的下一回合：
  // startTurn 自身也可能继续挂起（跳过出牌阶段 → 直接进弃牌阶段、或下个玩家已阵亡），
  // 单次消费会把局面停在"弃牌阶段但无人可动"的死角。上限防失控（连接跳过回合的极端局面）。
  for (let guard = 0; guard < 16; guard += 1) {
    await game.resolvePendingDeaths();
    await game.ensureTurnState();
    const enderId = game.consumePendingTurnEnd();
    if (enderId) {
      const ender = runtime.players.find((player) => player.id === enderId);
      // 阵亡者不再走回合结束流程（其回合已由 ensureTurnState 推进），否则会多推一位。
      if (ender?.alive) {
        await game.finishTurn(ender);
      }
    }
    if (!game.consumePendingNextTurn()) {
      break;
    }
    await game.startTurn();
  }
};

/** 确定性 RNG（同一 seed 必然复现）；不依赖 Math.random。 */
const mulberry32 = (seed: number): RngFn => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const PLAYER_NAMES = ["甲", "乙", "丙", "丁", "戊", "己"];

/** 统一应答：可选效果一律发动，其余请求取第一个候选；拿不到候选就 pass。 */
export const answerInteraction = (request: InteractionRequest): InteractionDecision => {
  if (request.kind === "optional-effect") {
    return { choice: "effect", enabled: true };
  }
  if (request.kind === "choose-suit") {
    return { choice: "suit", suit: request.suits[0] ?? "heart" };
  }
  if (request.kind === "collateral") {
    const victim = request.victims[0];
    const source = request.sources[0];
    if (victim) {
      return source ? { choice: "target", targetId: victim, sourceId: source.sourceId } : { choice: "target", targetId: victim };
    }
    return { choice: "pass" };
  }
  const source = request.sources[0];
  return source ? { choice: "card", sourceId: source.sourceId } : { choice: "pass" };
};

/** 状态指纹：用于判断一步动作有没有真的改变局面。 */
const stateSignature = (snapshot: GameSnapshot): string =>
  [
    snapshot.turn,
    snapshot.currentPlayerId,
    snapshot.phase,
    snapshot.deckCount,
    snapshot.discardCount,
    snapshot.players.map((player) => `${player.hp}/${player.hand.length}/${player.alive ? 1 : 0}`).join(","),
  ].join("|");

const collectInvariantViolations = (
  snapshot: GameSnapshot,
  report: SelfPlayViolation[],
  seen: Set<SelfPlayRule>,
  gameIndex: number,
  seed: number,
  context: string[],
  /** true = 延迟结算（濒死/胜负）已消费完，可以断言"体力与生死自洽"。 */
  settled: boolean,
): void => {
  const push = (rule: SelfPlayRule, message: string): void => {
    if (seen.has(rule)) {
      return;
    }
    seen.add(rule);
    report.push({ game: gameIndex, seed, turn: snapshot.turn, rule, message, context: [...context] });
  };
  for (const player of snapshot.players) {
    if (player.hp > player.maxHp) {
      push("hp-over-max", `${player.name}（${player.general}）体力 ${player.hp} 超过上限 ${player.maxHp}`);
    }
    // 体力为 0 但尚未结算濒死是有意为之的中间态（setDeferDyingResolution），只在结算后判定。
    if (settled && player.alive && player.hp <= 0) {
      push("alive-without-hp", `${player.name}（${player.general}）存活但体力为 ${player.hp}`);
    }
    if (settled && !player.alive && player.hp > 0) {
      push("dead-with-hp", `${player.name}（${player.general}）已阵亡但体力为 ${player.hp}`);
    }
  }
};

const playOneGame = async (
  options: Required<Pick<SelfPlayOptions, "playerCount" | "maxStepsPerGame" | "seed">> & SelfPlayOptions,
  gameIndex: number,
  seed: number,
  violations: SelfPlayViolation[],
): Promise<{ steps: number; turns: number; finished: boolean }> => {
  const game = new SanGuoGame(mulberry32(seed));
  await game.initNetworkGame(
    PLAYER_NAMES.slice(0, options.playerCount).map((name, index) => ({ id: `p${index}`, name, isAI: true })),
    4,
    true,
  );
  const runtime = game as unknown as Runtime;
  if (options.forceGeneral) {
    const general = resolveGeneralByName(options.forceGeneral);
    for (const player of runtime.players) {
      player.general = general.name;
      player.skills = [...general.skills];
      player.gender = general.gender;
      player.maxHp = general.maxHp;
      player.hp = general.maxHp;
    }
  }
  for (const player of runtime.players) {
    game.setDecisionHandler(player.id, answerInteraction);
  }
  // 与联机主机一致：濒死结算延迟到宿主消费（见 settleStagedTurn）。
  game.setDeferDyingResolution(true);

  const seen = new Set<SelfPlayRule>();
  const context: string[] = [];
  let steps = 0;
  let stall = 0;
  let lastSignature = "";

  while (steps < options.maxStepsPerGame) {
    // 先消费上一步挂起的延迟结算（死亡/回合结束/下个回合），与联机模式一致。
    await settleStagedTurn(game);

    const snapshot = game.getSnapshot();
    collectInvariantViolations(snapshot, violations, seen, gameIndex, seed, context, true);
    if (snapshot.winner !== null) {
      return { steps, turns: snapshot.turn, finished: true };
    }
    steps += 1;
    const signature = stateSignature(snapshot);
    if (signature === lastSignature) {
      stall += 1;
    } else {
      stall = 0;
      lastSignature = signature;
    }
    if (stall > 12) {
      const current = snapshot.players.find((player) => player.id === snapshot.currentPlayerId);
      violations.push({
        game: gameIndex,
        seed,
        turn: snapshot.turn,
        rule: "turn-stuck",
        message: `连续 12 步局面无变化，回合卡在 ${current?.name ?? snapshot.currentPlayerId}（${snapshot.phase}）`,
        context: [...context],
      });
      break;
    }

    // 连续几步没进展就强制结束出牌阶段，避免启发式反复挑同一个被拒绝的动作。
    const decision = stall >= 3 ? null : game.getBestAiDecision(snapshot.currentPlayerId);
    const action = decision?.action ?? game.getPlayableActions(snapshot.currentPlayerId).find((item) => item.type === "end");
    if (!action) {
      violations.push({
        game: gameIndex,
        seed,
        turn: snapshot.turn,
        rule: "turn-stuck",
        message: `${snapshot.currentPlayerId} 在 ${snapshot.phase} 无任何可执行动作`,
        context: [...context],
      });
      break;
    }
    try {
      const logs = await game.playAction(snapshot.currentPlayerId, action, decision?.targetId);
      const description = logs[logs.length - 1] ?? action.label;
      context.push(`[T${snapshot.turn}] ${snapshot.currentPlayerId} ${description}`);
      if (context.length > 6) {
        context.shift();
      }
    } catch (error) {
      const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
      violations.push({
        game: gameIndex,
        seed,
        turn: snapshot.turn,
        rule: "crashed",
        message: `执行「${action.label}」时抛错：${message}`,
        context: [...context],
      });
      break;
    }
    collectInvariantViolations(game.getSnapshot(), violations, seen, gameIndex, seed, context, false);
  }

  const finalSnapshot = game.getSnapshot();
  return { steps, turns: finalSnapshot.turn, finished: finalSnapshot.winner !== null };
};

export async function runSelfPlay(options: SelfPlayOptions = {}): Promise<SelfPlayReport> {
  const resolved = {
    ...options,
    games: options.games ?? 3,
    playerCount: Math.min(6, Math.max(2, options.playerCount ?? 4)),
    maxStepsPerGame: options.maxStepsPerGame ?? 400,
    seed: options.seed ?? 20240101,
  };
  const violations: SelfPlayViolation[] = [];
  let steps = 0;
  let turns = 0;
  let finished = 0;

  for (let index = 0; index < resolved.games; index += 1) {
    const seed = resolved.seed + index * 7919;
    const result = await playOneGame(resolved, index, seed, violations);
    steps += result.steps;
    turns += result.turns;
    if (result.finished) {
      finished += 1;
    }
    resolved.log?.(`[selfplay] 第 ${index + 1}/${resolved.games} 局（seed=${seed}）：${result.steps} 步 / 第 ${result.turns} 回合`);
  }

  return { games: resolved.games, steps, turns, finished, violations };
}
