/**
 * useGameConnection — WebSocket 连接管理 + 消息队列 + 断线重连。
 *
 * 所有游戏状态都从这里流出，组件只需消费 reactive refs。
 */

import { ref, reactive, computed } from "vue";
import type {
  ClientMessage,
  ServerMessage,
  ClientSnapshot,
  GameAction,
  InteractionRequest,
  InteractionDecision,
  RemovableCardOption,
  PublicPlayer,
} from "../protocol.js";
import { PROTOCOL_VERSION } from "../protocol.js";

// ─── 常量 ───────────────────────────────────────────

const STORAGE_ID = "sgsPlayerId";
const STORAGE_NAME = "sgsPlayerName";
const STORAGE_MACHINE = "sgsMachineId";
const MAX_RECONNECT = 10;

// ─── 状态 ───────────────────────────────────────────

const statusText = ref("未连接");
const statusClass = ref("");
const connected = ref(false);
const playerId = ref<string | null>(localStorage.getItem(STORAGE_ID));
const playerName = ref(localStorage.getItem(STORAGE_NAME) ?? "");
const left = ref(false);

// 大厅
const inLobby = ref(false);
const lobbyPlayers = ref<Array<{ id: string; name: string }>>([]);
const roomSize = ref(0);

// 游戏状态
const snapshot = ref<ClientSnapshot | null>(null);
const actions = ref<GameAction[]>([]);
const removableCards = ref<Record<string, RemovableCardOption[]>>({});
const pendingDiscardCount = ref(0);
const logs = ref<string[]>([]);

// 交互
const interactionRequest = ref<InteractionRequest | null>(null);

// 结算
const gameOverMessage = ref("");
const gameOverVisible = ref(false);

// 私有
let ws: WebSocket | null = null;
let reconnectAttempts = 0;
let asking = false; // 操作区有表单在等待用户选择
const msgQueue: ServerMessage[] = [];
let processingMsg = false;

// ─── 工具 ───────────────────────────────────────────

const setStatus = (text: string, cls: string) => {
  statusText.value = text;
  statusClass.value = cls;
};

const machineId = (() => {
  let id = localStorage.getItem(STORAGE_MACHINE);
  if (!id) {
    id = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(STORAGE_MACHINE, id);
  }
  return id;
})();

// 宿主嵌入模式（如 PolyChat 插件）
const win = window as unknown as Record<string, unknown>;
const HOSTED = Boolean(win.__SG_WS_PATH__);
const wsPath = win.__SG_WS_PATH__ as string | undefined;
const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${wsPath || "/ws"}`;

// ─── 消息队列 ───────────────────────────────────────

const enqueue = (message: ServerMessage) => {
  msgQueue.push(message);
  if (!processingMsg) processNext();
};

const processNext = async () => {
  if (processingMsg || msgQueue.length === 0) return;
  processingMsg = true;
  try {
    const msg = msgQueue.shift();
    if (msg) await handle(msg);
  } finally {
    processingMsg = false;
    processNext();
  }
};

// ─── 消息分发 ───────────────────────────────────────

const handle = async (message: ServerMessage) => {
  switch (message.type) {
    case "welcome":
    case "reconnect_ok":
      playerId.value = message.playerId;
      localStorage.setItem(STORAGE_ID, message.playerId);
      if (playerName.value) localStorage.setItem(STORAGE_NAME, playerName.value);
      reconnectAttempts = 0;
      setStatus(message.type === "welcome" ? "已加入" : "已重连，控制权已交还", "ok");
      inLobby.value = false;
      break;

    case "lobby":
      inLobby.value = true;
      gameOverVisible.value = false;
      lobbyPlayers.value = message.players;
      roomSize.value = message.roomSize;
      break;

    case "error":
      logs.value = [...logs.value, `错误：${message.message}`];
      if (message.message.includes("没有找到可重连的玩家")) {
        playerId.value = null;
        localStorage.removeItem(STORAGE_ID);
      }
      break;

    case "closed":
      left.value = true;
      setStatus("连接已关闭", "err");
      logs.value = [...logs.value, message.message];
      break;

    case "player_disconnected":
      logs.value = [
        ...logs.value,
        `${message.playerName} 断线了，AI 已托管其座位，可随时重连取回控制权`,
      ];
      break;

    case "player_reconnected":
      logs.value = [...logs.value, `${message.playerName} 已重连`];
      break;

    case "interaction":
      interactionRequest.value = message.request;
      break;

    case "state":
      snapshot.value = message.snapshot;
      actions.value = message.actions;
      removableCards.value = message.removableCards;
      pendingDiscardCount.value = message.pendingDiscardCount;
      logs.value = message.logs;
      inLobby.value = false;

      if (message.snapshot.gameOver) {
        clearActions();
        return;
      }
      if (asking) return; // 表单已就绪，不覆盖
      if (message.pendingDiscardCount > 0) return;
      if (message.actions.length > 0) return;
      break;

    case "game_over":
      gameOverMessage.value = message.message;
      gameOverVisible.value = true;
      break;

    case "game_restarting":
      gameOverVisible.value = false;
      break;
  }
};

// ─── 发送 ───────────────────────────────────────────

const send = (message: ClientMessage) => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
};

const sendDecision = (decision: InteractionDecision) =>
  send({ type: "interaction", decision });

const clearActions = () => {
  actions.value = [];
  asking = false;
};

// ─── 连接 / 重连 ────────────────────────────────────

const connect = () => {
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    connected.value = true;
    setStatus("已连接", "ok");
    reconnectAttempts = 0;
    send({ type: "source", machineId });

    if (playerId.value) {
      send({ type: "reconnect", playerId: playerId.value, version: PROTOCOL_VERSION });
    } else if (playerName.value) {
      send({ type: "join", name: playerName.value, version: PROTOCOL_VERSION });
    } else if (HOSTED) {
      autoJoinWithHostedName();
    }
  };

  ws.onmessage = (event) => {
    let message: ServerMessage;
    try {
      message = JSON.parse(event.data) as ServerMessage;
    } catch {
      return;
    }
    enqueue(message);
  };

  ws.onclose = () => {
    connected.value = false;
    handleSocketClosed();
  };

  ws.onerror = () => {
    connected.value = false;
  };
};

const handleSocketClosed = () => {
  if (left.value) {
    setStatus("已离开", "warn");
    return;
  }
  if (!playerId.value) {
    setStatus("连接断开", "warn");
    return;
  }
  reconnectAttempts += 1;
  if (reconnectAttempts > MAX_RECONNECT) {
    setStatus("重连失败", "err");
    return;
  }
  const delay = Math.min(500 * Math.pow(2, reconnectAttempts - 1), 15_000);
  setStatus(`连接断开，${delay / 1000}s 后重连（${reconnectAttempts}/${MAX_RECONNECT}）`, "warn");
  setTimeout(connect, delay);
};

// 宿主自动加入
const autoJoinWithHostedName = () => {
  fetch("/api/sanguosha/me", { headers: { accept: "application/json" } })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      const name = (data && data.username) || null;
      if (name) {
        playerName.value = name;
        localStorage.setItem(STORAGE_NAME, name);
        playerId.value = null;
        localStorage.removeItem(STORAGE_ID);
        if (ws && ws.readyState === WebSocket.OPEN) {
          send({ type: "join", name, version: PROTOCOL_VERSION });
        }
      }
    })
    .catch(() => {});
};

// ─── 公开操作 ───────────────────────────────────────

const joinGame = (name: string) => {
  playerName.value = name;
  localStorage.setItem(STORAGE_NAME, name);
  playerId.value = null;
  localStorage.removeItem(STORAGE_ID);
  if (ws && ws.readyState === WebSocket.OPEN) {
    send({ type: "join", name, version: PROTOCOL_VERSION });
  } else {
    connect();
  }
};

const sendAction = (actionIndex: number, targetId?: string, selectedCardId?: string) => {
  asking = false;
  send({ type: "action", actionIndex, targetId, selectedCardId });
};

const sendDiscard = (handIndex: number) => {
  asking = false;
  send({ type: "discard", handIndex });
};

const setAsking = (value: boolean) => {
  asking = value;
};

const confirmNext = () => {
  send({ type: "confirm_next" });
};

// ─── 暴露 ───────────────────────────────────────────

export function useGameConnection() {
  const myPlayer = computed<PublicPlayer | null>(() => {
    if (!snapshot.value || !playerId.value) return null;
    return snapshot.value.players.find((p) => p.id === playerId.value) ?? null;
  });

  const playerNameOf = (id: string): string => {
    const p = snapshot.value?.players.find((pp) => pp.id === id);
    return p?.name ?? id;
  };

  const isMyTurn = computed(() => {
    return snapshot.value?.currentPlayerId === playerId.value && !snapshot.value?.gameOver;
  });

  return {
    // 状态
    statusText,
    statusClass,
    connected,
    playerId,
    playerName,
    left,
    inLobby,
    lobbyPlayers,
    roomSize,
    snapshot,
    actions,
    removableCards,
    pendingDiscardCount,
    logs,
    interactionRequest,
    gameOverMessage,
    gameOverVisible,
    asking,

    // 计算
    myPlayer,
    playerNameOf,
    isMyTurn,

    // 操作
    connect,
    joinGame,
    sendAction,
    sendDiscard,
    sendDecision,
    setAsking,
    clearActions,
    confirmNext,
  };
}
