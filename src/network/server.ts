import { createServer, Socket, Server } from "node:net";
import { randomInt } from "node:crypto";
import { GameAction, InteractionDecision, InteractionRequest, SanGuoGame } from "../engine/game.js";
import { ClientMessage, createClientSnapshot, encodeMessage, NETWORK_PROTOCOL_VERSION, ServerMessage } from "./protocol.js";
import { JsonLineParser } from "./line-parser.js";

type Peer = { id: string; name: string; socket: Socket; parser: JsonLineParser<ClientMessage> };
type PendingInteraction = {
  playerId: string;
  request: InteractionRequest;
  resolve: (decision: InteractionDecision) => void;
};
type DisconnectedInfo = { name: string; timer: ReturnType<typeof setTimeout> };

export type GameServerOptions = { host: string; port: number; playerCount: number; openingHandCount: number; reconnectTimeoutMs?: number };

const secureRng = (): number => randomInt(0, 0x1_0000_0000) / 0x1_0000_0000;

export class GameServer {
  private readonly game: SanGuoGame;
  private readonly peers = new Map<Socket, Peer>();
  private readonly logs: string[] = [];
  private started = false;
  private nextPlayerNumber = 1;
  private pendingAction: { peer: Peer; action: GameAction; targetId?: string; selectedCardId?: string } | null = null;
  private pendingInteraction: PendingInteraction | null = null;
  private readonly disconnected = new Map<string, DisconnectedInfo>();
  private readonly disconnectedIds = new Set<string>();
  private server: Server | null = null;

  private get reconnectTimeoutMs(): number {
    return this.options.reconnectTimeoutMs ?? 60_000;
  }

  constructor(private readonly options: GameServerOptions, game = new SanGuoGame(secureRng)) {
    this.game = game;
    this.game.setDeferDyingResolution(true);
  }

  listen(): Promise<number> {
    const server = createServer((socket) => this.accept(socket));
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.options.port, this.options.host, () => {
        console.log(`联机房间已启动：${this.options.host}:${this.options.port}，等待 ${this.options.playerCount} 名玩家`);
        resolve((server.address() as { port: number } | null)?.port ?? this.options.port);
      });
    });
  }

  async close(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => {
      this.server!.close(() => {
        for (const peer of this.peers.values()) peer.socket.end();
        this.clearDisconnected();
        resolve();
      });
    });
  }

  getDisconnectedIds(): string[] {
    return Array.from(this.disconnectedIds);
  }

  clearDisconnected(): void {
    for (const entry of this.disconnected.values()) clearTimeout(entry.timer);
    this.disconnected.clear();
    this.disconnectedIds.clear();
  }

  private accept(socket: Socket): void {
    const parser = new JsonLineParser<ClientMessage>();
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      try {
        for (const message of parser.push(chunk)) this.handle(socket, parser, message);
      } catch {
        this.send(socket, { type: "error", message: "消息格式无效" });
      }
    });
    socket.on("close", () => this.disconnect(socket));
    socket.on("error", () => this.disconnect(socket));
  }

  private handle(socket: Socket, parser: JsonLineParser<ClientMessage>, message: ClientMessage): void {
    if (message.type === "reconnect") {
      this.handleReconnect(socket, parser, message.playerId, message.version);
      return;
    }
    if (message.type === "join") {
      this.handleJoin(socket, parser, message.name, message.version);
      return;
    }
    const peer = this.peers.get(socket);
    if (!peer || !this.started) return;
    if (message.type === "leave") {
      this.broadcast({ type: "player_disconnected", playerName: peer.name, waitTimeSeconds: this.reconnectTimeoutMs / 1000 });
      this.send(socket, { type: "closed", message: "你已主动退出房间，仍可在超时内重连" });
      this.disconnect(socket, true);
    } else if (message.type === "action") {
      void this.handleAction(peer, message);
    } else if (message.type === "discard") {
      void this.handleDiscard(peer, message.handIndex);
    } else if (message.type === "interaction") {
      this.handleInteraction(peer, message.decision);
    }
  }

  private handleJoin(socket: Socket, parser: JsonLineParser<ClientMessage>, name: string, version: number): void {
    if (this.peers.has(socket) || this.peers.size >= this.options.playerCount) {
      this.send(socket, { type: "error", message: "房间已开始或已满" });
      return;
    }
    const trimmed = name.trim().slice(0, 20);
    if (!trimmed) {
      this.send(socket, { type: "error", message: "玩家名称不能为空" });
      return;
    }
    if (this.started) {
      const entry = Array.from(this.disconnected.entries()).find(([, info]) => info.name === trimmed);
      if (entry) {
        this.handleReconnect(socket, parser, entry[0], version);
        return;
      }
      this.send(socket, { type: "error", message: "房间已开始" });
      return;
    }
    if (version !== NETWORK_PROTOCOL_VERSION) {
      this.send(socket, { type: "error", message: "客户端协议版本不兼容" });
      socket.end();
      return;
    }
    let peerId = `online-${this.nextPlayerNumber++}`;
    try {
      const existingPlayer = this.game.getSnapshot().players.find((p) => p.name === trimmed);
      if (existingPlayer) peerId = existingPlayer.id;
    } catch {}
    const peer: Peer = { id: peerId, name: trimmed, socket, parser };
    this.peers.set(socket, peer);
    this.send(socket, { type: "welcome", playerId: peer.id, roomSize: this.options.playerCount });
    this.broadcastLobby();
    if (this.peers.size === this.options.playerCount) this.startGame();
  }

  private handleReconnect(socket: Socket, parser: JsonLineParser<ClientMessage>, playerId: string, version: number): void {
    if (version !== NETWORK_PROTOCOL_VERSION) {
      this.send(socket, { type: "error", message: "客户端协议版本不兼容" });
      socket.end();
      return;
    }
    const info = this.disconnected.get(playerId);
    if (!info) {
      this.send(socket, { type: "error", message: "没有找到可重连的玩家" });
      socket.end();
      return;
    }
    clearTimeout(info.timer);
    this.disconnected.delete(playerId);
    this.disconnectedIds.delete(playerId);
    const peer: Peer = { id: playerId, name: info.name, socket, parser };
    this.peers.set(socket, peer);
    this.send(socket, { type: "reconnect_ok", playerId });
    this.sendStateToPeer(peer);
    this.broadcastState();
    if (this.pendingInteraction?.playerId === playerId) {
      this.send(socket, { type: "interaction", request: this.pendingInteraction.request });
    }
    this.broadcast({ type: "player_reconnected", playerName: info.name });
    this.logs.push(`${info.name} 已重连`);
    console.log(`${info.name} 已重连`);
  }

  private startGame(): void {
    this.started = true;
    void (async () => {
      const snapshot = this.game.getSnapshot();
      if (snapshot.players.length === 0) {
        this.logs.push(
          ...(await this.game.initNetworkGame(
            Array.from(this.peers.values()).map(({ id, name }) => ({ id, name })),
            this.options.openingHandCount,
            false,
          )),
        );
      }
      for (const peer of this.peers.values()) {
        this.game.setDecisionHandler(peer.id, (request) => this.requestPeerDecision(peer.id, request));
      }
      this.beginTurn();
    })();
  }

  private requestPeerDecision(playerId: string, request: InteractionRequest): Promise<InteractionDecision> {
    return new Promise<InteractionDecision>((resolve) => {
      if (this.pendingInteraction) {
        this.pendingInteraction.resolve({ choice: "pass" });
      }
      this.pendingInteraction = { playerId, request, resolve };
      const peer = Array.from(this.peers.values()).find((item) => item.id === playerId);
      if (peer) {
        this.send(peer.socket, { type: "interaction", request });
      }
    });
  }

  private handleInteraction(peer: Peer, decision: InteractionDecision): void {
    const pending = this.pendingInteraction;
    if (!pending || pending.playerId !== peer.id) {
      this.send(peer.socket, { type: "error", message: "当前不需要你决策" });
      return;
    }
    this.pendingInteraction = null;
    pending.resolve(decision);
  }

  private beginTurn(): void {
    const current = this.game.getCurrentPlayer();
    void this.runTurnStart(current.id);
  }

  private async runTurnStart(playerId: string): Promise<void> {
    const effects = this.game.getTurnStartOptionalEffects(playerId);
    for (const effect of effects) {
      this.game.setOptionalEffectDecision(playerId, effect, false);
      const decision = await this.requestPeerDecision(playerId, {
        kind: "optional-effect",
        requestId: 0,
        playerId,
        effect: effect as string,
        reason: `摸牌阶段是否发动${effect}？`,
      });
      if (decision.choice === "effect") {
        this.game.setOptionalEffectDecision(playerId, effect, decision.enabled);
      }
    }
    const logs = await this.game.startTurn();
    this.logs.push(...logs);
    this.broadcastState();
  }

  private async handleAction(peer: Peer, message: Extract<ClientMessage, { type: "action" }>): Promise<void> {
    if (this.pendingAction || this.pendingInteraction) {
      this.send(peer.socket, { type: "error", message: "正在等待其他玩家响应" });
      return;
    }
    if (this.game.getCurrentPlayer().id !== peer.id) {
      this.send(peer.socket, { type: "error", message: "现在不是你的回合" });
      return;
    }
    const action = this.game.getPlayableActions(peer.id)[message.actionIndex];
    if (!action) {
      this.send(peer.socket, { type: "error", message: "动作已失效，请按最新状态重新选择" });
      return;
    }
    this.pendingAction = {
      peer,
      action,
      ...(message.targetId ? { targetId: message.targetId } : {}),
      ...(message.selectedCardId ? { selectedCardId: message.selectedCardId } : {}),
    };
    await this.resolveAfterPlay();
  }

  private async resolveAfterPlay(): Promise<void> {
    if (!this.pendingAction) return;
    const { peer, action, targetId, selectedCardId } = this.pendingAction;
    this.pendingAction = null;
    const logs: string[] = [];
    logs.push(...(await this.game.playAction(peer.id, action, targetId, selectedCardId)));
    logs.push(...(await this.game.ensureTurnState()));
    this.logs.push(...logs);
    this.broadcastState();
    await this.advanceIfCurrentPlayerDead();
    if (!this.game.getCurrentPlayer().alive) return;
    if (this.game.getPendingDiscardCount(peer.id) === 0) {
      await this.resolveTurnEnd(peer.id);
    }
  }

  private async handleDiscard(peer: Peer, handIndex: number): Promise<void> {
    const logs = await this.game.discardForCurrentPlayer(peer.id, handIndex);
    this.logs.push(...logs);
    this.broadcastState();
    if (this.game.getPendingDiscardCount(peer.id) === 0) {
      await this.resolveTurnEnd(peer.id);
    }
  }

  private async resolveTurnEnd(playerId: string): Promise<void> {
    const enderId = this.game.consumePendingTurnEnd();
    if (enderId !== playerId) return;
    const effects = this.game.getTurnEndOptionalEffects(playerId);
    for (const effect of effects) {
      this.game.setOptionalEffectDecision(playerId, effect, false);
      const decision = await this.requestPeerDecision(playerId, {
        kind: "optional-effect",
        requestId: 0,
        playerId,
        effect: effect as string,
        reason: `结束阶段是否发动${effect}？`,
      });
      if (decision.choice === "effect") {
        this.game.setOptionalEffectDecision(playerId, effect, decision.enabled);
      }
    }
    const player = this.game.getSnapshot().players.find((p) => p.id === playerId);
    if (player) {
      const logs = await this.game.finishTurn(player as any);
      this.logs.push(...logs);
      this.broadcastState();
      if (this.game.consumePendingNextTurn()) {
        this.beginTurn();
      }
    }
  }

  private async advanceIfCurrentPlayerDead(): Promise<void> {
    const current = this.game.getCurrentPlayer();
    if (current.alive) return;
    const logs: string[] = [`${current.name} 已阵亡`];
    logs.push(...(await this.game.resolvePendingDeaths()));
    this.logs.push(...logs);
    this.broadcastState();
    if (this.game.consumePendingNextTurn()) {
      this.beginTurn();
      return;
    }
    await this.advanceIfCurrentPlayerDead();
  }

  private sendStateToPeer(peer: Peer): void {
    const snapshot = this.game.getSnapshot();
    const actions = this.game.getPlayableActions(peer.id);
    const removableCards: Record<string, any[]> = {};
    for (const player of snapshot.players) {
      if (player.id !== peer.id && player.alive && !this.disconnectedIds.has(player.id)) {
        removableCards[player.id] = this.game.getRemovableCardOptions(player.id);
      }
    }
    this.send(peer.socket, {
      type: "state",
      snapshot: createClientSnapshot(snapshot, peer.id),
      actions,
      removableCards,
      pendingDiscardCount: snapshot.currentPlayerId === peer.id ? this.game.getPendingDiscardCount(peer.id) : 0,
      logs: this.logs.slice(-30),
    });
  }

  private broadcastLobby(): void {
    const players = Array.from(this.peers.values()).map(({ id, name }) => ({ id, name }));
    this.broadcast({ type: "lobby", players, roomSize: this.options.playerCount });
  }

  private broadcastState(): void {
    for (const peer of this.peers.values()) this.sendStateToPeer(peer);
  }

  private disconnect(socket: Socket, alreadyNotified = false): void {
    const peer = this.peers.get(socket);
    if (!peer) return;
    this.peers.delete(socket);
    if (!this.started) {
      this.broadcastLobby();
      return;
    }
    const snapshot = this.game.getSnapshot();
    const player = snapshot.players.find((p) => p.id === peer.id);
    if (player && !player.alive) {
      this.logs.push(`${peer.name} 已阵亡退出`);
      console.log(`${peer.name} 阵亡退出，无需等待重连`);
      return;
    }
    if (this.pendingInteraction?.playerId === peer.id) {
      this.pendingInteraction.resolve({ choice: "pass" });
      this.pendingInteraction = null;
    }
    if (!alreadyNotified) {
      this.broadcast({ type: "player_disconnected", playerName: peer.name, waitTimeSeconds: this.reconnectTimeoutMs / 1000 });
    }
    const timer = setTimeout(() => {
      for (const other of this.peers.values()) {
        this.send(other.socket, { type: "closed", message: `${peer.name} 断线超时，房间关闭` });
        other.socket.end();
      }
      this.disconnected.clear();
    }, this.reconnectTimeoutMs);
    this.disconnected.set(peer.id, { name: peer.name, timer });
    this.disconnectedIds.add(peer.id);
    this.logs.push(`${peer.name} 断线了，${this.reconnectTimeoutMs / 1000}s 内可重连`);
    console.log(`${peer.name} 断线，等待重连 ${this.reconnectTimeoutMs / 1000}s`);
    this.broadcastState();
  }

  private send(socket: Socket, message: ServerMessage): void {
    socket.write(encodeMessage(message));
  }

  private broadcast(message: ServerMessage): void {
    for (const peer of this.peers.values()) this.send(peer.socket, message);
  }
}
