import type { SkillHooksContext } from "./skill-hooks.js";
import type { SkillUseContext } from "./skills.js";
import type { SkillKind, SkillConversion, SkillRules, SkillTargetIntent } from "./skill-registry.js";
import type { Player, SkillEventPayload, SkillId, SkillTrigger } from "./types.js";

/**
 * 外部武将包技能的运行时契约与全局注册表。
 *
 * 这里只放类型与内存注册表（无 I/O），loader 见 `general-pack.ts`。
 * 注册表挂到 `globalThis` 的固定键上：热重载会重建整个 `src/engine` 模块图，
 * 挂在模块局部变量里会随旧图一起失效，挂 globalThis 则新图仍读到同一份数据。
 */

/** 外部技能可用到的引擎能力集合；运行时就是存活的 `SanGuoGame` 实例本身。 */
export type SkillModuleCtx = SkillUseContext & SkillHooksContext;

/** 触发钩子：收到 ctx 后自行用 `ctx.hasSkill(...)` 判断归属，与内置钩子写法一致。 */
export type PackSkillHook = (
  ctx: SkillModuleCtx,
  payload: SkillEventPayload,
  logs: string[],
) => void | Promise<void>;

/** 一个技能的完整声明（JSON 声明式或代码模块都归一到此结构）。 */
export type SkillModule = {
  id: SkillId;
  displayName: string;
  kind: SkillKind;
  /** 必填：AI 与 UI 的唯一来源。 */
  description: string;
  triggers?: SkillTrigger[];
  optional?: boolean;
  priority?: number;
  requiresTarget?: boolean;
  label?: string;
  /** 主动技能的目标取向（供 AI 选择目标；缺省视为 `any`）。 */
  targetIntent?: SkillTargetIntent;
  /** 声明式规则数值/豁免（Phase 3 谓词层消费；见 skill-registry.ts 的 SkillRules）。 */
  rules?: SkillRules;
  /**
   * 手牌上限修正：纯函数，只读传入的 `player`（返回 0/正数表示抬高上限）。
   * 用于"手牌上限 +X"里 X 是运行时变量（如已损失体力值）的场景——静态数值请用 `rules.handLimitDelta`。
   */
  handLimit?: (player: Player) => number;
  /** 当牌转换（Phase 7）：把满足 `from` 的牌当作 `to` 使用或打出；一个技能可声明多条（龙魂 4 条）。 */
  conversions?: SkillConversion[];
  /**
   * 当牌转换的门控（Phase 8）：只对带 `conversions` 的代码技能有意义。引擎在枚举可玩转换
   * （出牌阶段）与响应来源时调用，返回 false 则该条转换不出现；结算时再复算一次，不信任客户端。
   * 必须纯（只读），否则 UI 与引擎会算出不同结果。用于"每回合限次/消耗标记"类限制。
   */
  canUseConversion?(ctx: SkillModuleCtx, player: Player, conversion: SkillConversion): boolean;
  /**
   * 当牌转换结算后的钩子（Phase 8）：转换成功使用/打出后调用一次，用于扣费
   * （如移去 1 枚标记、记一次"本回合已用过该牌名"）。
   */
  onConversionUsed?(ctx: SkillModuleCtx, player: Player, conversion: SkillConversion, logs: string[]): void | Promise<void>;
  canUse?(ctx: SkillModuleCtx, player: Player): boolean;
  getTargets?(ctx: SkillModuleCtx, player: Player): string[];
  play?(ctx: SkillModuleCtx, player: Player, targetId?: string): Promise<string[]>;
  onTrigger?: Partial<Record<SkillTrigger, PackSkillHook>>;
  /**
   * 全局钩子（Phase 8）：默认钩子只在事件相关玩家（actor/target/source）拥有该技能时触发；
   * 置 `true` 后，每次事件都触发，钩子需自行在 `ctx.players` 里定位持有者（如武庫要监听
   * \"其他角色失去装备\"——失去者不是持有者，默认过滤会把它拦掉）。只给确实需要监听他人
   * 事件的技能开，钩子内仍须先判持有者再做事，否则会在无关事件上空转。
   */
  globalHook?: boolean;
};

export type PackSkillEntry = SkillModule & { generalName: string };

type PackRegistry = { skills: Map<SkillId, PackSkillEntry> };

const REGISTRY_KEY = "__sanguoPackRegistry__";

const getRegistry = (): PackRegistry => {
  const holder = globalThis as unknown as { [REGISTRY_KEY]?: PackRegistry };
  const existed = holder[REGISTRY_KEY];
  if (existed) {
    return existed;
  }
  const created: PackRegistry = { skills: new Map<SkillId, PackSkillEntry>() };
  holder[REGISTRY_KEY] = created;
  return created;
};

export function registerPackSkill(entry: PackSkillEntry): void {
  getRegistry().skills.set(entry.id, entry);
}

export function getPackSkill(id: SkillId): PackSkillEntry | undefined {
  return getRegistry().skills.get(id);
}

export function getPackSkills(): PackSkillEntry[] {
  return [...getRegistry().skills.values()];
}

export function getPackHooksFor(trigger: SkillTrigger): PackSkillEntry[] {
  return getPackSkills().filter((entry) => typeof entry.onTrigger?.[trigger] === "function");
}

export function resetPackSkills(): void {
  getRegistry().skills.clear();
}
