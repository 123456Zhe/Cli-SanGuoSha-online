/**
 * Hybrid 战略规划缓存（LLM 规划只在自己回合阻塞，响应决策永不等待）。
 *
 * 联机实测的教训：hybrid 的「局内响应决策」过去会先 `await` 一次完整的 LLM 战略规划，
 * 于是对手打出一张杀之后，整张桌子要等 10~190 秒才等到 AI 的闪/无懈/桃。
 * 从玩家视角就是「Jev 卡住了」——决策层明明是 Jev，卡住的却是它前面的那次 LLM 规划。
 *
 * 现在的语义：
 * - `ensure`（AI 自己的回合开始）：允许阻塞等 LLM，失败回退策略记忆 → 上一回合旧规划；
 * - `peek`（响应决策：闪/桃/无懈/借刀/弃牌…）：只读缓存与兜底，需要时**后台**预热，
 *   绝不让人等 LLM——响应必须是秒级的。
 * 同一玩家同一回合只飞一次 LLM 调用（后台预热与回合开始共享同一个 in-flight Promise），
 * 失败一律静默（上层本来就有本地策略兜底）。
 */
export class HybridPlanCache<TContext = unknown> {
  /** playerId -> 最近一次规划（带回合号，用于判断是否本回合）。 */
  private readonly plans = new Map<string, { turn: number; plan: string }>();

  /** `${playerId}@${turn}` -> 正在飞行的 LLM 规划调用。 */
  private readonly inflight = new Map<string, Promise<string | undefined>>();

  constructor(
    private readonly fetchPlan: (playerId: string, context: TContext) => Promise<string | undefined>,
  ) {}

  /** 阻塞获取（AI 自己的回合开始）：缓存 → LLM → fallback → 上一回合的旧规划。 */
  async ensure(
    playerId: string,
    turn: number,
    fallback: string | undefined,
    context: TContext,
  ): Promise<string | undefined> {
    const cached = this.fresh(playerId, turn);
    if (cached !== undefined) {
      return cached;
    }
    const fetched = await this.startFetch(playerId, turn, context);
    return fetched ?? fallback ?? this.stale(playerId);
  }

  /**
   * 非阻塞获取（响应决策）：命中本回合缓存就返回，否则返回兜底（策略记忆 → 旧规划），
   * 同时在后台预热本回合规划。**绝不 await LLM**。
   */
  peek(playerId: string, turn: number, fallback: string | undefined, context: TContext): string | undefined {
    const cached = this.fresh(playerId, turn);
    if (cached !== undefined) {
      return cached;
    }
    void this.startFetch(playerId, turn, context);
    return fallback ?? this.stale(playerId);
  }

  /** 本回合已缓存的规划（调试/测试用）。 */
  cached(playerId: string, turn: number): string | undefined {
    return this.fresh(playerId, turn);
  }

  private fresh(playerId: string, turn: number): string | undefined {
    const entry = this.plans.get(playerId);
    return entry && entry.turn === turn ? entry.plan : undefined;
  }

  private stale(playerId: string): string | undefined {
    return this.plans.get(playerId)?.plan;
  }

  /** 同一玩家同一回合只飞一次；任何失败都吞掉（返回 undefined），绝不产生未处理拒绝。 */
  private startFetch(playerId: string, turn: number, context: TContext): Promise<string | undefined> {
    const key = `${playerId}@${turn}`;
    const existing = this.inflight.get(key);
    if (existing) {
      return existing;
    }
    const promise = (async (): Promise<string | undefined> => {
      try {
        const plan = await this.fetchPlan(playerId, context);
        if (plan) {
          this.plans.set(playerId, { turn, plan });
          return plan;
        }
        return undefined;
      } catch {
        return undefined;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, promise);
    return promise;
  }
}
