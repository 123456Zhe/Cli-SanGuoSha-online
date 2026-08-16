/**
 * 分层策略记忆（Strategy Memory）。
 *
 * 把回合末策略复盘从「单条自由文本覆盖」升级为三层结构 + 执行回看：
 * - L1 战术笔记（tactical）：下一回合的可执行动作，每次复盘覆写；
 * - L2 战略方针（doctrine）：跨回合持久认知（身份推断/阵营目标/资源纪律），
 *   每次复盘按「新信息优先」确定性增量合并；
 * - L3 经验教训（lessons）：滚动队列，由执行回看提炼，最多 LESSONS_MAX_COUNT 条；
 * - 执行回看（lastExecution）：上轮计划执行情况的单条评价。
 *
 * 注入决策 prompt 时用 composePromptBlock() 组合成有界 Markdown 块，
 * 避免像旧实现那样把整段自由文本无差别塞入每个 prompt。
 */

export const TACTICAL_NOTE_MAX_LENGTH = 300;

export const DOCTRINE_MAX_LENGTH = 400;

export const EXECUTION_MAX_LENGTH = 120;

export const LESSON_MAX_LENGTH = 120;

export const LESSONS_MAX_COUNT = 2;

export const STRATEGY_BLOCK_MAX_LENGTH = 1000;

/** 一次复盘调用的结构化输出（解析自 LLM 返回的 JSON）。 */
export type StrategyReviewResult = {
  execution: string;
  lesson: string;
  tactical: string;
  doctrineUpdate: string;
};

export class StrategyMemory {
  /** L1 战术笔记：下一回合可执行动作（每次复盘覆写）。 */
  tactical = "";

  /** L2 战略方针：跨回合持久认知（每次复盘增量合并）。 */
  doctrine = "";

  /** L3 经验教训：滚动队列，最多 LESSONS_MAX_COUNT 条。 */
  lessons: string[] = [];

  /** 上轮计划执行回看评价（单条，覆盖更新）。 */
  lastExecution = "";

  /** 上次成功复盘所在轮次；0 表示尚未复盘。 */
  lastReviewRound = 0;

  get isEmpty(): boolean {
    return !this.tactical && !this.doctrine && this.lessons.length === 0 && !this.lastExecution;
  }

  /** 应用一次复盘输出：确定性合并 + 截断，所有字段有界。 */
  applyReviewResult(result: StrategyReviewResult, reviewRound: number): void {
    const trim = (text: string, max: number): string => text.trim().slice(0, max);
    const tactical = trim(result.tactical, TACTICAL_NOTE_MAX_LENGTH);
    if (tactical) {
      this.tactical = tactical;
    }
    this.lastExecution = trim(result.execution, EXECUTION_MAX_LENGTH);
    this.doctrine = mergeDoctrine(this.doctrine, trim(result.doctrineUpdate, DOCTRINE_MAX_LENGTH));
    const lesson = trim(result.lesson, LESSON_MAX_LENGTH);
    // 去重相邻重复教训，避免队列被同一条填满
    if (lesson && lesson !== this.lessons[this.lessons.length - 1]) {
      this.lessons = [...this.lessons, lesson].slice(-LESSONS_MAX_COUNT);
    }
    this.lastReviewRound = reviewRound;
  }

  /** 组装注入决策 prompt 的有界 Markdown 块；空记忆返回空串。 */
  composePromptBlock(): string {
    if (this.isEmpty) {
      return "";
    }
    const sections: string[] = [];
    if (this.doctrine) {
      sections.push(`【战略方针·跨回合】${this.doctrine}`);
    }
    if (this.lastExecution) {
      sections.push(`【上轮执行】${this.lastExecution}`);
    }
    if (this.lessons.length > 0) {
      sections.push(`【经验教训】\n${this.lessons.map((item) => `- ${item}`).join("\n")}`);
    }
    if (this.tactical) {
      sections.push(`【上回合战术】${this.tactical}`);
    }
    return `你上回合末的策略笔记（分层记忆）：\n${sections.join("\n")}`.slice(0, STRATEGY_BLOCK_MAX_LENGTH);
  }
}

/**
 * 战略方针合并：新信息优先（update 在前），合并后超出上限时从旧方针尾部裁剪，
 * 保证最新结论不被挤掉、旧认知逐步衰减。确定性、可测试。
 */
export const mergeDoctrine = (oldDoctrine: string, update: string): string => {
  const oldText = oldDoctrine.trim();
  const updateText = update.trim();
  if (!updateText || updateText === "不变") {
    return oldText.slice(0, DOCTRINE_MAX_LENGTH);
  }
  if (!oldText) {
    return updateText.slice(0, DOCTRINE_MAX_LENGTH);
  }
  return `${updateText}；${oldText}`.slice(0, DOCTRINE_MAX_LENGTH);
};

const normalizeJson = (text: string): string => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  return text.trim();
};

const parseJsonObject = (text: string): Record<string, unknown> | null => {
  const payload = normalizeJson(text);
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    const objectMatch = payload.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
      return null;
    }
    try {
      const parsed = JSON.parse(objectMatch[0]) as Record<string, unknown>;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
};

/** 解析复盘输出 JSON；execution 与 tactical 必须是字符串且至少一个非空，否则视为不可用。 */
export const parseStrategyReview = (text: string): StrategyReviewResult | null => {
  const parsed = parseJsonObject(text);
  if (!parsed) {
    return null;
  }
  if (typeof parsed.execution !== "string" || typeof parsed.tactical !== "string") {
    return null;
  }
  const execution = parsed.execution;
  const tactical = parsed.tactical;
  if (!execution && !tactical) {
    return null;
  }
  return {
    execution,
    lesson: typeof parsed.lesson === "string" ? parsed.lesson : "",
    tactical,
    doctrineUpdate: typeof parsed.doctrineUpdate === "string" ? parsed.doctrineUpdate : "",
  };
};
