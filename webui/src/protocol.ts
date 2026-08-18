/**
 * 客户端协议类型 — 与 src/network/protocol.ts 保持同步（NETWORK_PROTOCOL_VERSION = 4）。
 * 此文件不依赖 Node.js API，纯类型 + 常量，供 Vue 组件与 composable 共用。
 */

export const PROTOCOL_VERSION = 4;

// ─── 卡牌 ───────────────────────────────────────────

export type CardColor = "red" | "black";

export type CardSuit = "heart" | "diamond" | "club" | "spade";

export interface Card {
  id: string;
  type: string;
  color: CardColor;
  suit: CardSuit;
  rank: number;
}

// ─── 玩家（公开视图，客户端不看到对手手牌） ──────────

export interface PublicPlayer {
  id: string;
  name: string;
  role: string; // "主公" | "忠臣" | "反贼" | "内奸" | "未知"
  gender: string;
  general: string;
  kingdom: string;
  skills: string[];
  isAI: boolean;
  hp: number;
  maxHp: number;
  hand: Card[] | null; // 仅自己的手牌
  handCount: number;
  weapon: string | null;
  armor: string | null;
  attackHorse: string | null;
  defenseHorse: string | null;
  treasure: string | null;
  treasureCards: Card[] | null;
  treasureCardCount: number;
  delayedTricks: Array<{ cardType: string; sourcePlayerId: string }>;
  alive: boolean;
  faceDown: boolean;
}

// ─── 快照 ───────────────────────────────────────────

export interface ClientSnapshot {
  turn: number;
  currentPlayerId: string;
  phase: string;
  players: PublicPlayer[];
  gameOver: boolean;
  winner: "human" | "ai" | "draw" | null;
  deckCount: number;
  discardCount: number;
}

// ─── 动作 & 目标 ────────────────────────────────────

export interface GameAction {
  label: string;
  type: string;
  requiresTarget: boolean;
  targets: string[];
}

export interface RemovableCardOption {
  id: string;
  label: string;
}

// ─── 交互请求（union） ───────────────────────────────

export type InteractionRequest =
  | {
      kind: "respond";
      requestId: number;
      responderId: string;
      trigger: { cardName: string; actorId: string };
      responseKind: string;
      sources: Array<{ sourceId: string; label: string }>;
      allowPass: true;
      reason: string;
    }
  | {
      kind: "collateral";
      requestId: number;
      targetId: string;
      actorId: string;
      victims: string[];
      sources: Array<{ sourceId: string; label: string }>;
      allowHandOverWeapon: boolean;
      reason: string;
    }
  | {
      kind: "choose-discard";
      requestId: number;
      playerId: string;
      reason: string;
      sources: Array<{ sourceId: string; label: string }>;
      count: number;
      allowPass: boolean;
      passLabel?: string;
    }
  | {
      kind: "choose-suit";
      requestId: number;
      playerId: string;
      reason: string;
      suits: string[];
    }
  | {
      kind: "optional-effect";
      requestId: number;
      playerId: string;
      effect: string;
      reason: string;
    };

// ─── 交互决策 ───────────────────────────────────────

export type InteractionDecision =
  | { choice: "pass" }
  | { choice: "card"; sourceId: string }
  | { choice: "target"; targetId: string; sourceId?: string }
  | { choice: "suit"; suit: string }
  | { choice: "effect"; enabled: boolean };

// ─── 客户端 → 服务端 消息 ────────────────────────────

export type ClientMessage =
  | { type: "join"; name: string; version: number }
  | { type: "action"; actionIndex: number; targetId?: string; selectedCardId?: string }
  | { type: "reconnect"; playerId: string; version: number }
  | { type: "discard"; handIndex: number }
  | { type: "interaction"; decision: InteractionDecision }
  | { type: "leave" }
  | { type: "confirm_next" }
  | { type: "source"; machineId: string; ip?: string };

// ─── 服务端 → 客户端 消息 ────────────────────────────

export type ServerMessage =
  | { type: "welcome"; playerId: string; roomSize: number }
  | { type: "reconnect_ok"; playerId: string }
  | { type: "lobby"; players: Array<{ id: string; name: string }>; roomSize: number }
  | { type: "player_disconnected"; playerName: string; waitTimeSeconds: number }
  | { type: "player_reconnected"; playerName: string }
  | { type: "interaction"; request: InteractionRequest }
  | {
      type: "state";
      snapshot: ClientSnapshot;
      actions: GameAction[];
      removableCards: Record<string, RemovableCardOption[]>;
      pendingDiscardCount: number;
      logs: string[];
    }
  | { type: "error"; message: string }
  | { type: "closed"; message: string }
  | { type: "game_over"; winner: "human" | "ai" | "draw" | null; message: string }
  | { type: "game_restarting"; message: string };
