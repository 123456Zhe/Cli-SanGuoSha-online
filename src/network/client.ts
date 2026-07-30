import { connect, Socket } from "node:net";
import { createInterface } from "node:readline/promises";
import { GameAction, InteractionRequest, RemovableCardOption } from "../engine/game.js";
import { ClientMessage, encodeMessage, NETWORK_PROTOCOL_VERSION, ServerMessage } from "./protocol.js";
import { JsonLineParser } from "./line-parser.js";

const valueOf = (name: string, fallback: string): string => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const port = Number.parseInt(valueOf("port", "9527"), 10);
const host = valueOf("host", "127.0.0.1");
const name = valueOf("name", `玩家${Math.floor(Math.random() * 1000)}`);
let socket: Socket = connect({ host, port });
let parser = new JsonLineParser<ServerMessage>();
const rl = createInterface({ input: process.stdin, output: process.stdout });
let asking = false;
let lastPlayers: Array<{ id: string; name: string }> = [];
let playerId: string | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
let left = false;
let _interacting = false;       // tracks if an interaction prompt is active
let _msgQueue: ServerMessage[] = [];  // sequential message queue
let _processingMsg = false;     // queue processing guard

const send = (message: ClientMessage): void => {
  if (!socket.destroyed) socket.write(encodeMessage(message));
};
const equipmentName = (value: string | null): string => value ?? "无";
const choose = async (prompt: string, count: number): Promise<number> => {
  while (true) {
    const picked = Number.parseInt((await rl.question(prompt)).trim(), 10) - 1;
    if (Number.isInteger(picked) && picked >= 0 && picked < count) return picked;
    console.log("请输入有效编号");
  }
};

const chooseTarget = async (action: Exclude<GameAction, { type: "end" }>, players: Array<{ id: string; name: string }>): Promise<string | undefined> => {
  if (!action.requiresTarget) return undefined;
  const targets = action.targets.map((id) => players.find((player) => player.id === id)).filter((player): player is { id: string; name: string } => Boolean(player));
  targets.forEach((target, index) => console.log(`${index + 1}. ${target.name}`));
  return targets[await choose("选择目标: ", targets.length)]?.id;
};

const chooseTargetCard = async (options: RemovableCardOption[] | undefined): Promise<string | undefined> => {
  if (!options || options.length === 0) return undefined;
  console.log("可选择目标的牌：");
  options.forEach((option, index) => console.log(`${index + 1}. ${option.label}`));
  return options[await choose("选择牌: ", options.length)]?.id;
};

const playerName = (id: string): string => lastPlayers.find((player) => player.id === id)?.name ?? id;

const handleInteraction = async (request: InteractionRequest): Promise<void> => {
  _interacting = true;
  try {
  if (request.kind === "respond") {
    console.log(`\n${request.reason}`);
    request.sources.forEach((source, index) => console.log(`${index + 1}. ${source.label}`));
    console.log(`${request.sources.length + 1}. 不应对`);
    const picked = await choose("请选择: ", request.sources.length + 1);
    const source = request.sources[picked];
    send({ type: "interaction", decision: source ? { choice: "card", sourceId: source.sourceId } : { choice: "pass" } });
    return;
  }
  if (request.kind === "collateral") {
    console.log(`\n${request.reason}`);
    request.victims.forEach((victimId, index) => console.log(`${index + 1}. 对 ${playerName(victimId)} 使用杀`));
    if (request.allowHandOverWeapon) console.log(`${request.victims.length + 1}. 交出武器`);
    const count = request.victims.length + (request.allowHandOverWeapon ? 1 : 0);
    const picked = await choose("请选择: ", count);
    const victimId = request.victims[picked];
    if (victimId) {
      if (request.sources.length > 1) {
        console.log("选择用于响应的杀：");
        request.sources.forEach((source, index) => console.log(`${index + 1}. ${source.label}`));
        const sourcePicked = await choose("请选择: ", request.sources.length);
        const source = request.sources[sourcePicked];
        send({ type: "interaction", decision: { choice: "target", targetId: victimId, ...(source ? { sourceId: source.sourceId } : {}) } });
      } else {
        send({ type: "interaction", decision: { choice: "target", targetId: victimId } });
      }
    } else {
      send({ type: "interaction", decision: { choice: "pass" } });
    }
    return;
  }
  if (request.kind === "choose-suit") {
    const suitLabels: Record<string, string> = { heart: "红桃", diamond: "方片", club: "梅花", spade: "黑桃" };
    console.log(`\n${request.reason}`);
    request.suits.forEach((suit, index) => console.log(`${index + 1}. 声明${suitLabels[suit] ?? suit}`));
    const picked = await choose("请选择: ", request.suits.length);
    const suit = request.suits[picked] ?? request.suits[0] ?? "heart";
    send({ type: "interaction", decision: { choice: "suit", suit } });
    return;
  }
  if (request.kind === "choose-discard") {
    console.log(`\n${request.reason}`);
    request.sources.forEach((source, index) => console.log(`${index + 1}. ${source.label}`));
    if (request.allowPass) {
      console.log(`${request.sources.length + 1}. ${request.passLabel ?? "放弃"}`);
    }
    const count = request.sources.length + (request.allowPass ? 1 : 0);
    const picked = await choose("请选择: ", count);
    const source = request.sources[picked];
    send({ type: "interaction", decision: source ? { choice: "card", sourceId: source.sourceId } : { choice: "pass" } });
    return;
  }
  if (request.kind === "optional-effect") {
    console.log(`\n${request.reason}`);
    console.log("1. 发动\n2. 不发动");
    send({ type: "interaction", decision: { choice: "effect", enabled: await choose("请选择: ", 2) === 0 } });
    return;
  }
  console.log("未处理的交互类型：%s", (request as { kind: string }).kind);
  } finally {
    _interacting = false;
  }
};

// Sequential message queue: prevents concurrent message processing
// so e.g. state updates never clear() over an interaction prompt.
const enqueueMessage = (msg: ServerMessage): void => {
  _msgQueue.push(msg);
  if (!_processingMsg) processNextMessage();
};

const processNextMessage = async (): Promise<void> => {
  if (_processingMsg || _msgQueue.length === 0) return;
  _processingMsg = true;
  try {
    const msg = _msgQueue.shift();
    if (msg) await handle(msg);
  } finally {
    _processingMsg = false;
    processNextMessage();
  }
};

const handle = async (message: ServerMessage): Promise<void> => {
  if (message.type === "welcome") {
    console.log(`已加入房间，你的 ID：${message.playerId}`);
    playerId = message.playerId;
    reconnectAttempts = 0;
  }
  else if (message.type === "lobby") console.log(`等待玩家 (${message.players.length}/${message.roomSize})：${message.players.map((p) => p.name).join("、")}`);
  else if (message.type === "error") console.error(`错误：${message.message}`);
  else if (message.type === "closed") {
    console.log(message.message);
    left = true;
    socket.end();
  }
  else if (message.type === "player_disconnected") { console.log(`${message.playerName} 已断线，${message.waitTimeSeconds}s 内可重连`); }
  else if (message.type === "player_reconnected") { console.log(`${message.playerName} 已重连`); }
  else if (message.type === "reconnect_ok") {
    console.log(`已重连，你的 ID：${message.playerId}`);
    playerId = message.playerId;
    reconnectAttempts = 0;
  }
  else if (message.type === "interaction") {
    await handleInteraction(message.request);
  }
  else if (message.type === "state") {
    lastPlayers = message.snapshot.players.map((player) => ({ id: player.id, name: player.name }));
    if (!_interacting) {
      console.clear();
    } else {
      console.log("\n--- 状态更新 (技能询问中) ---");
    }
    console.log(message.logs.map((line) => `- ${line}`).join("\n"));
    console.log("\n战场：");
    for (const player of message.snapshot.players) {
      const cards = player.hand ? player.hand.map((card) => card.type).join("、") || "无" : `${player.handCount} 张`;
      console.log(`${player.id === message.snapshot.currentPlayerId ? ">" : " "} ${player.name} [${player.general}]  身份:${player.role}  体力:${Math.max(0, player.hp)}/${player.maxHp}  手牌:${cards}  状态:${player.faceDown ? "翻面" : "正面"}`);
      console.log(`  装备 | 武器:${equipmentName(player.weapon)} | 防具:${equipmentName(player.armor)} | 进攻马:${equipmentName(player.attackHorse)} | 防御马:${equipmentName(player.defenseHorse)} | 宝物:${equipmentName(player.treasure)}`);
    }
    if (message.snapshot.gameOver) { console.log(`\n游戏结束：${message.snapshot.winner}`); return; }
    if (asking || (message.actions.length === 0 && message.pendingDiscardCount === 0)) { console.log("\n等待其他玩家行动..."); return; }
    asking = true;
    try {
      if (message.pendingDiscardCount > 0) {
        const me = message.snapshot.players.find((player) => player.id === message.snapshot.currentPlayerId);
        const usable = [...(me?.hand ?? []).map((card) => card.type), ...(me?.treasureCards ?? []).map((card) => `${card.type}（木牛流马）`)];
        usable.forEach((label, index) => console.log(`${index + 1}. ${label}`));
        send({ type: "discard", handIndex: await choose(`弃置一张牌（还需 ${message.pendingDiscardCount} 张）: `, usable.length) });
      } else {
        console.log("\n可执行动作：");
        message.actions.forEach((action, index) => console.log(`${index + 1}. ${action.label}`));
        const actionIndex = await choose("选择动作: ", message.actions.length);
        const action = message.actions[actionIndex];
        if (!action) return;
        const targetId = action.type === "end" ? undefined : await chooseTarget(action, message.snapshot.players);
        const selectedCardId = targetId ? await chooseTargetCard(message.removableCards[targetId]) : undefined;
        send({ type: "action", actionIndex, ...(targetId ? { targetId } : {}), ...(selectedCardId ? { selectedCardId } : {}) });
      }
    } finally { asking = false; }
  }
};

const attemptReconnect = async (): Promise<void> => {
  if (left || !playerId) {
    console.log("连接已断开，你可以重新运行客户端尝试重连");
    return;
  }
  reconnectAttempts += 1;
  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    console.log(`重连失败 (${MAX_RECONNECT_ATTEMPTS} 次均失败)`);
    return;
  }
  const delay = Math.min(500 * Math.pow(2, reconnectAttempts - 1), 15000);
  console.log(`连接断开，尝试重连 (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})，${delay}ms 后...`);
  await new Promise<void>((resolve) => setTimeout(resolve, delay));
  try {
    socket = connect({ host, port, timeout: 5000 });
    parser = new JsonLineParser<ServerMessage>();
    bindSocket(socket, parser);
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.once("connect", resolve);
    });
    console.log("重连成功");
    reconnectAttempts = 0;
  } catch (error) {
    console.error(`重连失败：${(error as Error).message}`);
    void attemptReconnect();
  }
};

const bindSocket = (s: Socket, p: JsonLineParser<ServerMessage>): void => {
  s.setEncoding("utf8");
  s.on("connect", () => {
    if (playerId) {
      s.write(encodeMessage({ type: "reconnect", playerId, version: NETWORK_PROTOCOL_VERSION }));
    } else {
      send({ type: "join", name, version: NETWORK_PROTOCOL_VERSION });
    }
  });
  s.on("data", (chunk: string) => { for (const message of p.push(chunk)) enqueueMessage(message); });
  s.on("error", (error: Error) => { console.error(`连接失败：${error.message}`); void rl.close(); });
  s.on("close", () => { if (!left) void attemptReconnect(); });
};

bindSocket(socket, parser);
