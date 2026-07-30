import {
  GameAction,
  GameSnapshot,
  InteractionDecision,
  InteractionRequest,
  PlayerRole,
  RemovableCardOption,
} from "../engine/game.js";

export const NETWORK_PROTOCOL_VERSION = 4;

export type PublicPlayer = Omit<GameSnapshot["players"][number], "hand" | "role" | "treasureCards"> & {
  hand: GameSnapshot["players"][number]["hand"] | null;
  handCount: number;
  role: PlayerRole | "未知";
  treasureCards: GameSnapshot["players"][number]["treasureCards"] | null;
  treasureCardCount: number;
};

export type ClientSnapshot = Omit<GameSnapshot, "players"> & { players: PublicPlayer[] };

export type ClientMessage =
  | { type: "join"; name: string; version: number }
  | { type: "action"; actionIndex: number; targetId?: string; selectedCardId?: string }
  | { type: "reconnect"; playerId: string; version: number }
  | { type: "discard"; handIndex: number }
  | { type: "interaction"; decision: InteractionDecision }
  | { type: "leave" };

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

export const encodeMessage = (message: ClientMessage | ServerMessage): string => `${JSON.stringify(message)}\n`;

export const createClientSnapshot = (snapshot: GameSnapshot, viewerId: string): ClientSnapshot => ({
  ...snapshot,
  players: snapshot.players.map((player) => ({
    ...player,
    hand: player.id === viewerId ? player.hand : null,
    handCount: player.hand.length,
    role: player.id === viewerId || player.role === PlayerRole.Lord || !player.alive ? player.role : "未知",
    treasureCards: player.id === viewerId ? player.treasureCards : null,
    treasureCardCount: player.treasureCards.length,
  })),
});
