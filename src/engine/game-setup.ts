/**
 * 建局与会话初始化：默认人机局、联机局、玩家/身份/武将分配。
 *
 * 从 `game.ts` 拆出，遵循仓库既有的 context-interface 约定：
 * 首参是 `GameSetupContext`，`game.ts` 以 `this as unknown as GameSetupContext` 传入；
 * 拆出模块之间不互相 import（跨模块调用一律走 context）。
 */

const defaultInitOptions: GameInitOptions = {
  playerCount: 3,
  aiCount: 2,
  openingHandCount: 4,
  humanName: "主公",
  humanRole: PlayerRole.Lord,
  humanGeneral: "孙策",
};

import { Card, createDeck, shuffle } from "./cards.js";
import { buildRoleList, getAiName, getRoleDistribution, pickRandomUnusedGeneral, resolveGeneralByName } from "./generals.js";
import {
  GameInitOptions,
  GeneralDefinition,
  NetworkPlayerConfig,
  Player,
  PlayerRole,
  ResponseKind,
  SkillName,
  TurnPhase,
} from "./types.js";

export type GameSetupContext = {
  applyLordBonus(): void;
  buildRoleList(playerCount: number): PlayerRole[];
  createPlayer(id: string, name: string, isAI: boolean, general: GeneralDefinition, role: PlayerRole): Player;
  currentPlayerIndex: number;
  deck: Card[];
  discardPile: Card[];
  drawCards(playerId: string, count: number): number;
  getAiName(index: number): string;
  getRoleDistribution(roles: PlayerRole[]): { rebel: number; loyalist: number; traitor: number };
  normalizeInitOptions(options: Partial<GameInitOptions>): GameInitOptions;
  optionalEffectDecisions: Map<string, boolean>;
  pendingNextTurn: boolean;
  pendingTurnEndPlayer: string | null;
  phase: TurnPhase;
  pickRandomUnusedGeneral(usedGeneralNames: Set<string>): GeneralDefinition;
  players: Player[];
  resolveGeneralByName(generalName: string): GeneralDefinition;
  responsePolicyByPlayer: Map<string, Partial<Record<ResponseKind, boolean>>>;
  responseSelectionByPlayer: Map<string, Partial<Record<ResponseKind, string>>>;
  rng: () => number;
  round: number;
  roundStartIndex: number;
  skillCountsThisTurn: Map<string, Map<SkillName, number>>;
  skillFlagsThisTurn: Map<string, Set<SkillName>>;
  skillUsedThisRound: Map<string, Set<SkillName>>;
  skillUsedThisTurn: Map<string, Set<SkillName>>;
  slashPlayedThisTurn: boolean;
  slashUsedThisTurn: boolean;
  staged: boolean;
  startTurn(): Promise<string[]>;
  turn: number;
  wineBuffPlayerIds: Set<string>;
  wineUsedPlayerIds: Set<string>;
  winner: "human" | "ai" | "draw" | null;
};

export async function initDefaultGame(ctx: GameSetupContext, options: Partial<GameInitOptions> = {}): Promise<string[]> {
  const initOptions = ctx.normalizeInitOptions(options);
  const roleList = ctx.buildRoleList(initOptions.playerCount);
  const distribution = ctx.getRoleDistribution(roleList);
  const humanRole = roleList.includes(initOptions.humanRole) ? initOptions.humanRole : PlayerRole.Lord;
  const humanGeneralDefinition = ctx.resolveGeneralByName(initOptions.humanGeneral);
  const rolePool = [...roleList];
  const humanRoleIndex = rolePool.indexOf(humanRole);
  if (humanRoleIndex >= 0) {
    rolePool.splice(humanRoleIndex, 1);
  }

  ctx.players = [ctx.createPlayer("human", initOptions.humanName, false, humanGeneralDefinition, humanRole)];
  const usedGeneralNames = new Set<string>([humanGeneralDefinition.name]);
  for (let i = 0; i < rolePool.length; i += 1) {
    const role = rolePool[i] ?? PlayerRole.Rebel;
    const general = ctx.pickRandomUnusedGeneral(usedGeneralNames);
    usedGeneralNames.add(general.name);
    ctx.players.push(ctx.createPlayer(`ai-${i + 1}`, `玩家${ctx.getAiName(i)}`, true, general, role));
  }
  ctx.applyLordBonus();
  ctx.deck = shuffle(createDeck(), ctx.rng);
  ctx.discardPile = [];
  ctx.currentPlayerIndex = ctx.players.findIndex((player) => player.role === PlayerRole.Lord && player.alive);
  if (ctx.currentPlayerIndex < 0) {
    ctx.currentPlayerIndex = 0;
  }
  ctx.turn = 1;
  ctx.round = 1;
  ctx.roundStartIndex = ctx.currentPlayerIndex;
  ctx.phase = TurnPhase.Draw;
  ctx.winner = null;
  ctx.slashUsedThisTurn = false;
  ctx.slashPlayedThisTurn = false;
  ctx.wineBuffPlayerIds = new Set();
  ctx.wineUsedPlayerIds = new Set();
  ctx.skillUsedThisTurn = new Map();
  ctx.skillUsedThisRound = new Map();
  ctx.skillCountsThisTurn = new Map();
  ctx.skillFlagsThisTurn = new Map();
  ctx.responsePolicyByPlayer.clear();
  ctx.responseSelectionByPlayer.clear();
  ctx.optionalEffectDecisions.clear();

  const logs = [
    `对局开始：${initOptions.playerCount} 人局`,
    `身份配比：反贼${distribution.rebel} 忠臣${distribution.loyalist} 内奸${distribution.traitor}`,
    `你的身份：${humanRole}`,
    `你的武将：${humanGeneralDefinition.name}`,
    `初始手牌：每人 ${initOptions.openingHandCount} 张`,
    "发牌中...",
  ];
  for (const player of ctx.players) {
    const drawn = ctx.drawCards(player.id, initOptions.openingHandCount);
    logs.push(`${player.name}[${player.general}] 获得 ${drawn} 张手牌`);
  }
  logs.push(...(await ctx.startTurn()));
  return logs;
}

export async function initNetworkGame(ctx: GameSetupContext, playerConfigs: NetworkPlayerConfig[], openingHandCount = 4, startImmediately = true): Promise<string[]> {
  if (playerConfigs.length < 2 || playerConfigs.length > 6) {
    throw new Error("联机人数必须在 2 到 6 人之间");
  }
  const ids = new Set(playerConfigs.map((player) => player.id));
  if (ids.size !== playerConfigs.length) {
    throw new Error("联机玩家 ID 不能重复");
  }
  const roles = ctx.buildRoleList(playerConfigs.length);
  const shuffledRoles = shuffle(roles, ctx.rng);
  const usedGeneralNames = new Set<string>();
  // 调试指定武将：按座位顺序先到先得，随机分配永远优先让位于显式指定；
  // 未知武将/被重复指定一律报错，绝不静默换人（否则玩家以为选上了实际没生效）。
  const pickGeneralFor = (config: NetworkPlayerConfig, index: number): GeneralDefinition => {
    if (config.general === undefined) {
      return ctx.pickRandomUnusedGeneral(usedGeneralNames);
    }
    const general = ctx.resolveGeneralByName(config.general);
    if (usedGeneralNames.has(general.name)) {
      throw new Error(`联机建局失败：武将「${general.name}」被指定了多次（座位 ${index + 1}：${config.name}）`);
    }
    return general;
  };
  ctx.players = playerConfigs.map((config, index) => {
    const general = pickGeneralFor(config, index);
    usedGeneralNames.add(general.name);
    return ctx.createPlayer(config.id, config.name, config.isAI ?? false, general, shuffledRoles[index] ?? PlayerRole.Rebel);
  });
  ctx.applyLordBonus();
  ctx.deck = shuffle(createDeck(), ctx.rng);
  ctx.discardPile = [];
  ctx.currentPlayerIndex = ctx.players.findIndex((player) => player.role === PlayerRole.Lord);
  ctx.currentPlayerIndex = Math.max(0, ctx.currentPlayerIndex);
  ctx.turn = 1;
  ctx.round = 1;
  ctx.roundStartIndex = ctx.currentPlayerIndex;
  ctx.phase = TurnPhase.Draw;
  ctx.winner = null;
  ctx.slashUsedThisTurn = false;
  ctx.slashPlayedThisTurn = false;
  ctx.wineBuffPlayerIds = new Set();
  ctx.wineUsedPlayerIds = new Set();
  ctx.skillUsedThisTurn = new Map();
  ctx.skillUsedThisRound = new Map();
  ctx.skillCountsThisTurn = new Map();
  ctx.skillFlagsThisTurn = new Map();
  ctx.responsePolicyByPlayer.clear();
  ctx.responseSelectionByPlayer.clear();
  ctx.optionalEffectDecisions.clear();

  const handCount = Math.min(6, Math.max(3, Math.floor(openingHandCount)));
  const logs = [`联机对局开始：${playerConfigs.length} 人局`, `初始手牌：每人 ${handCount} 张`];
  ctx.staged = true;
  ctx.pendingNextTurn = false;
  ctx.pendingTurnEndPlayer = null;
  for (const player of ctx.players) {
    const drawn = ctx.drawCards(player.id, handCount);
    logs.push(`${player.name}[${player.general}] 获得 ${drawn} 张手牌`);
  }
  if (startImmediately) logs.push(...(await ctx.startTurn()));
  return logs;
}

export function normalizeInitOptions(ctx: GameSetupContext, options: Partial<GameInitOptions>): GameInitOptions {
  const playerCountSource = options.playerCount ?? ((options.aiCount ?? defaultInitOptions.aiCount) + 1);
  const playerCount = Math.min(6, Math.max(2, Math.floor(playerCountSource)));
  const aiCount = playerCount - 1;
  const openingHandCount = options.openingHandCount ?? defaultInitOptions.openingHandCount;
  const humanName = options.humanName ?? defaultInitOptions.humanName;
  const humanRole = options.humanRole ?? defaultInitOptions.humanRole;
  const humanGeneral = options.humanGeneral ?? defaultInitOptions.humanGeneral;
  return {
    playerCount,
    aiCount,
    openingHandCount: Math.min(6, Math.max(3, Math.floor(openingHandCount))),
    humanName,
    humanRole,
    humanGeneral,
  };
}

export function createPlayer(ctx: GameSetupContext, id: string, name: string, isAI: boolean, general: GeneralDefinition, role: PlayerRole,): Player {
  return {
    id,
    name,
    role,
    gender: general.gender,
    general: general.name,
    skills: [...general.skills],
    isAI,
    hp: general.maxHp,
    maxHp: general.maxHp,
    hand: [],
    weapon: null,
    armor: null,
    defenseHorse: null,
    attackHorse: null,
    treasure: null,
    treasureCards: [],
    delayedTricks: [],
    alive: true,
    faceDown: false,
    chained: false,
  };
}

  /** 主公 +1 体力上限：总人数 ≥ 4 时生效（rules.md §3.4）。 */
export function applyLordBonus(ctx: GameSetupContext): void {
  if (ctx.players.length < 4) {
    return;
  }
  const lord = ctx.players.find((player) => player.role === PlayerRole.Lord);
  if (!lord) {
    return;
  }
  lord.maxHp += 1;
  lord.hp += 1;
}
