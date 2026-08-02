import { createServer, Socket, Server } from "node:net";
import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AiModelProvider, GameAiLoop, ReasoningMode } from "../agent/ai.js";
import { LocalAiEngine } from "../agent/local-engine.js";
import { buildBattlefieldLines, buildRoundContexts, trackRoundBattlefield } from "../agent/round-context.js";
import { computeAiTurnActionLimit, pickAiTurnDecision } from "../agent/turn-decision.js";
import { GameAction, InteractionDecision, InteractionRequest, NetworkPlayerConfig, SanGuoGame, SkillName } from "../engine/game.js";
import { CardType } from "../engine/cards.js";
import { ClientMessage, createClientSnapshot, encodeMessage, NETWORK_PROTOCOL_VERSION, ServerMessage } from "./protocol.js";
import { JsonLineParser } from "./line-parser.js";

type Peer = { id: string; name: string; socket: Socket; parser: JsonLineParser<ClientMessage> };
type PendingInteraction = {
  playerId: string;
  request: InteractionRequest;
  resolve: (decision: InteractionDecision) => void;
};
type DisconnectedInfo = { name: string; timer: ReturnType<typeof setTimeout> };

export type GameServerOptions = {
  host: string;
  port: number;
  playerCount: number;
  openingHandCount: number;
  reconnectTimeoutMs?: number;
  autoRestartAfterGameOver?: boolean;
  autoRestartAfterClose?: boolean;
  aiCount?: number;
  aiDriver?: AiModelProvider | "simple";
  aiThinkingMs?: number;
  aiContextRounds?: number;
  aiReasoning?: ReasoningMode;
  aiStrategy?: "own" | "always";
};

const AI_NAME_PREFIX = "[AI]电脑-";
const AI_NAME_SEQUENCE = ["甲", "乙", "丙", "丁", "戊"];
const DEFAULT_CONTEXT_ROUNDS = 30;
const AI_ACTION_PACING_MS = 800;

const secureRng = (): number => randomInt(0, 0x1_0000_0000) / 0x1_0000_0000;

export class GameServer {
  private game: SanGuoGame;
  private readonly peers = new Map<Socket, Peer>();
  private logs: string[] = [];
  private started = false;
  private nextPlayerNumber = 1;
  private pendingAction: { peer: Peer; action: GameAction; targetId?: string; selectedCardId?: string } | null = null;
  private pendingInteraction: PendingInteraction | null = null;
  private readonly disconnected = new Map<string, DisconnectedInfo>();
  private readonly disconnectedIds = new Set<string>();
  private server: Server | null = null;
  private restarting = false;
  private readonly aiLoop: GameAiLoop | null;
  private readonly localAiEngine: LocalAiEngine | null;
  private aiPlayerIds: string[] = [];
  private readonly roundBattlefieldHistory = new Map<number, string[]>();
  private readonly contextRounds: number;

  private get reconnectTimeoutMs(): number {
    return this.options.reconnectTimeoutMs ?? 60_000;
  }

  constructor(private readonly options: GameServerOptions, game = new SanGuoGame(secureRng)) {
    this.game = game;
    this.game.setDeferDyingResolution(true);
    const aiCount = options.aiCount ?? 0;
    this.contextRounds = options.aiContextRounds ?? DEFAULT_CONTEXT_ROUNDS;
    if (aiCount > 0) {
      const rulesText = this.loadRules();
      this.localAiEngine = new LocalAiEngine(rulesText);
      this.localAiEngine.setMaxContextRounds(this.contextRounds);
      const driver = options.aiDriver ?? "qwen";
      if (driver === "simple") {
        this.aiLoop = null;
      } else {
        this.aiLoop = new GameAiLoop(rulesText, driver);
        this.aiLoop.setMaxContextRounds(this.contextRounds);
        this.aiLoop.setThinkingMs(options.aiThinkingMs ?? 1200);
        if (options.aiReasoning) {
          this.aiLoop.setReasoningMode(options.aiReasoning);
        }
      }
    } else {
      this.aiLoop = null;
      this.localAiEngine = null;
    }
  }

  private loadRules(): string {
    try {
      return readFileSync(resolve(process.cwd(), "rules.md"), "utf-8");
    } catch {
      return "";
    }
  }

  private buildAiConfigs(): NetworkPlayerConfig[] {
    return Array.from({ length: this.options.aiCount ?? 0 }, (_, index) => ({
      id: `ai-${index + 1}`,
      name: `${AI_NAME_PREFIX}${AI_NAME_SEQUENCE[index] ?? String(index + 1)}`,
      isAI: true,
    }));
  }

  private get humanSlots(): number {
    return Math.max(1, this.options.playerCount - (this.options.aiCount ?? 0));
  }

  private isAiPlayer(playerId: string): boolean {
    return this.aiPlayerIds.includes(playerId);
  }

  private trackBattlefield(): void {
    const snapshot = this.game.getSnapshot();
    trackRoundBattlefield(this.roundBattlefieldHistory, snapshot.turn, buildBattlefieldLines(snapshot.players), this.contextRounds);
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

  private async restartGame(): Promise<void> {
    this.game = new SanGuoGame(secureRng);
    this.game.setDeferDyingResolution(true);
    this.logs.length = 0;
    this.nextPlayerNumber = 1;
    this.pendingAction = null;
    this.pendingInteraction = null;
    this.clearDisconnected();
    this.roundBattlefieldHistory.clear();
    const onlinePeers = Array.from(this.peers.values());
    if (onlinePeers.length < this.humanSlots) {
      this.started = false;
      return;
    }
    const aiConfigs = this.buildAiConfigs();
    this.aiPlayerIds = aiConfigs.map((config) => config.id);
    await this.game.initNetworkGame(
      [...onlinePeers.map(({ id, name }) => ({ id, name })), ...aiConfigs],
      this.options.openingHandCount,
      false,
    );
    for (const peer of onlinePeers) {
      this.game.setDecisionHandler(peer.id, (request) => this.requestPeerDecision(peer.id, request));
    }
    this.registerAiDecisionHandlers();
    this.aiLoop?.start(this.game.getSnapshot());
    this.logs = [];
    this.started = true;
    this.broadcast({ type: "game_restarting", message: "新一局即将开始" });
    this.beginTurn();
  }

  private async checkAndHandleGameOver(): Promise<void> {
    if (!this.game.isGameOver() || this.restarting) return;
    if (!this.options.autoRestartAfterGameOver) return;
    this.restarting = true;
    const snapshot = this.game.getSnapshot();
    const winner = snapshot.winner;
    const msg = '游戏结束：' + (winner === 'draw' ? '平局！' : (winner === 'human' ? '人类玩家胜利！' : 'AI 玩家胜利！'));
    this.broadcast({ type: "game_over", winner, message: msg });
    this.logs.push(msg);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await this.restartGame();
    this.restarting = false;
  }

  private accept(socket: Socket): void {
    const parser = new JsonLineParser<ClientMessage>();
    socket.setEncoding("utf8");
    socket.setKeepAlive(true, 5000); // detect dead connections within ~10s
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
    const trimmed = name.trim().slice(0, 20);
    if (!trimmed) {
      this.send(socket, { type: "error", message: "玩家名称不能为空" });
      return;
    }
    if (this.buildAiConfigs().some((config) => config.name === trimmed)) {
      this.send(socket, { type: "error", message: "该名称已被 AI 玩家占用，请换一个名字" });
      return;
    }
    if (this.started) {
      // Normal reconnection: player is in disconnected map (clean disconnect)
      const entry = Array.from(this.disconnected.entries()).find(([, info]) => info.name === trimmed);
      if (entry) {
        this.handleReconnect(socket, parser, entry[0], version);
        return;
      }
      // Client crash / ungraceful disconnect: player exists in game but not in
      // disconnected map. Force-kick the old peer and treat as reconnect.
      const gamePlayer = this.game.getSnapshot().players.find((p) => p.name === trimmed);
      if (gamePlayer) {
        for (const [s, p] of this.peers) {
          if (p.id === gamePlayer.id) {
            this.peers.delete(s);
            s.end();
          }
        }
        const timer = setTimeout(() => {
          const restartAfterClose = this.options.autoRestartAfterClose;
          for (const other of this.peers.values()) {
            this.send(other.socket, { type: "closed", message: `${trimmed} 断线超时，房间即将重启` });
            other.socket.end();
          }
          this.disconnected.clear();
          if (restartAfterClose) {
            this.game = new SanGuoGame(secureRng);
            this.game.setDeferDyingResolution(true);
            this.peers.clear();
            this.logs.length = 0;
            this.pendingAction = null;
            this.pendingInteraction = null;
            this.nextPlayerNumber = 1;
            this.started = false;
            console.log("房间超时关闭，已重置等待新玩家加入");
          }
        }, this.reconnectTimeoutMs);
        this.disconnected.set(gamePlayer.id, { name: trimmed, timer });
        this.disconnectedIds.add(gamePlayer.id);
        this.handleReconnect(socket, parser, gamePlayer.id, version);
        return;
      }
      this.send(socket, { type: "error", message: "房间已开始" });
      return;
    }
    if (this.peers.size >= this.humanSlots) {
      this.send(socket, { type: "error", message: "房间已满" });
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
    if (this.peers.size === this.humanSlots) this.startGame();
  }

  private handleReconnect(socket: Socket, parser: JsonLineParser<ClientMessage>, playerId: string, version: number): void {
    if (version !== NETWORK_PROTOCOL_VERSION) {
      this.send(socket, { type: "error", message: "客户端协议版本不兼容" });
      socket.end();
      return;
    }
    const disconnectedInfo = this.disconnected.get(playerId);
    let playerName: string;
    if (disconnectedInfo) {
      clearTimeout(disconnectedInfo.timer);
      this.disconnected.delete(playerId);
      this.disconnectedIds.delete(playerId);
      playerName = disconnectedInfo.name;
    } else {
      // Player not in disconnected map — might be a stale peer (client crash,
      // network partition where TCP close wasn't detected). Check if the player
      // exists in the game and if so, force-kick the old peer.
      const gamePlayer = this.game.getSnapshot().players.find((p) => p.id === playerId);
      if (!gamePlayer) {
        this.send(socket, { type: "error", message: "没有找到可重连的玩家" });
        socket.end();
        return;
      }
      playerName = gamePlayer.name;
    }
    // Remove any old peer entries for this playerId to prevent
    // the stale socket's close handler from interfering with reconnection.
    for (const [s, p] of this.peers) {
      if (p.id === playerId) {
        this.peers.delete(s);
        s.end();
      }
    }
    const peer: Peer = { id: playerId, name: playerName, socket, parser };
    this.peers.set(socket, peer);
    this.send(socket, { type: "reconnect_ok", playerId });
    this.sendStateToPeer(peer);
    this.broadcastState();
    if (this.pendingInteraction?.playerId === playerId) {
      this.send(socket, { type: "interaction", request: this.pendingInteraction.request });
    }
    this.broadcast({ type: "player_reconnected", playerName });
    this.logs.push(`${playerName} 已重连`);
    console.log(`${playerName} 已重连`);
  }

  private startGame(): void {
    this.started = true;
    void (async () => {
      const snapshot = this.game.getSnapshot();
      if (snapshot.players.length === 0) {
        const aiConfigs = this.buildAiConfigs();
        this.aiPlayerIds = aiConfigs.map((config) => config.id);
        this.logs.push(
          ...(await this.game.initNetworkGame(
            [...Array.from(this.peers.values()).map(({ id, name }) => ({ id, name })), ...aiConfigs],
            this.options.openingHandCount,
            false,
          )),
        );
      }
      for (const peer of this.peers.values()) {
        this.game.setDecisionHandler(peer.id, (request) => this.requestPeerDecision(peer.id, request));
      }
      this.registerAiDecisionHandlers();
      this.aiLoop?.start(this.game.getSnapshot());
      this.beginTurn();
    })();
  }

  private registerAiDecisionHandlers(): void {
    if (!this.aiLoop) {
      return;
    }
    for (const aiId of this.aiPlayerIds) {
      this.game.setDecisionHandler(aiId, async (request) => {
        if (request.kind === "choose-suit") {
          return null; // 纯概率响应走引擎自动决策
        }
        return this.aiLoop?.decideInteraction(this.game, aiId, request) ?? null;
      });
    }
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
      } else if (!this.disconnected.has(playerId)) {
        // Player is not connected AND not in reconnect window — auto-pass
        this.pendingInteraction = null;
        resolve({ choice: "pass" });
      }
      // If player is in disconnected map, the interaction stays pending
      // and will be re-sent to them on reconnect
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

  private async askOptionalEffect(playerId: string, effect: SkillName | CardType, phase: "摸牌阶段" | "结束阶段"): Promise<void> {
    const effectLabel = effect as string;
    const reason = `${phase}是否发动${effectLabel}？`;
    this.game.setOptionalEffectDecision(playerId, effect, false);
    let decision: InteractionDecision | null;
    if (this.isAiPlayer(playerId) && this.aiLoop) {
      decision = await this.aiLoop.decideInteraction(this.game, playerId, {
        kind: "optional-effect",
        requestId: 0,
        playerId,
        effect: effectLabel,
        reason,
      });
    } else {
      decision = await this.requestPeerDecision(playerId, {
        kind: "optional-effect",
        requestId: 0,
        playerId,
        effect: effectLabel,
        reason,
      });
    }
    if (decision?.choice === "effect") {
      this.game.setOptionalEffectDecision(playerId, effect, decision.enabled);
    }
  }

  private async runTurnStart(playerId: string): Promise<void> {
    const effects = this.game.getTurnStartOptionalEffects(playerId);
    for (const effect of effects) {
      await this.askOptionalEffect(playerId, effect, "摸牌阶段");
    }
    const logs = await this.game.startTurn();
    this.logs.push(...logs);
    this.trackBattlefield();
    this.broadcastState();
    await this.checkAndHandleGameOver();
    if (!this.game.isGameOver() && this.game.getCurrentPlayer().isAI) {
      await this.driveAiTurn(this.game.getCurrentPlayer().id);
    }
  }

  private async driveAiTurn(aiId: string): Promise<void> {
    if (!this.localAiEngine) {
      return;
    }
    let actionsTaken = 0;
    while (true) {
      if (this.game.isGameOver()) {
        return;
      }
      const snapshot = this.game.getSnapshot();
      const current = snapshot.players.find((player) => player.id === snapshot.currentPlayerId);
      if (!current || !current.isAI || current.id !== aiId || !current.alive) {
        return;
      }
      if (this.game.getPlayableActions(aiId).length === 0) {
        return;
      }
      // 兜底：LLM 可能反复执行木牛流马「置入/取出」等无收益空转，动作数达上限强制收尾
      const actionLimit = computeAiTurnActionLimit(current.hand.length, current.treasureCards.length);
      if (actionsTaken >= actionLimit) {
        this.logs.push(`[AI] ${current.name} 回合动作已达上限（${actionLimit}），强制结束出牌`);
        this.broadcastInterimState();
        const ended = await this.forceEndAiTurn(aiId);
        if (!ended) {
          return;
        }
        continue;
      }
      this.trackBattlefield();
      const previousRounds = buildRoundContexts(this.logs, this.roundBattlefieldHistory, snapshot.turn, this.contextRounds);
      this.aiLoop?.setPreviousRoundContexts(previousRounds);
      this.localAiEngine.syncPreviousRounds(previousRounds);
      this.logs.push(`[AI] ${current.name} 正在思考...`);
      this.broadcastInterimState();
      const picked = await pickAiTurnDecision(this.game, aiId, this.aiLoop, this.localAiEngine);
      const decision = picked.decision;
      if (!decision) {
        const ended = await this.forceEndAiTurn(aiId);
        if (!ended) {
          return;
        }
        continue;
      }
      const targetText = decision.targetId ? ` -> ${this.labelPlayer(decision.targetId)}` : "";
      const reasonText = picked.fallbackReason ? `（回退原因：${picked.fallbackReason}）` : "";
      this.logs.push(`[${picked.driverLabel}] ${current.name} 选择：${decision.action.label}${targetText}${reasonText}`);
      const targetName = decision.targetId
        ? this.game.getSnapshot().players.find((player) => player.id === decision.targetId)?.name ?? decision.targetId
        : undefined;
      this.logs.push(`${current.name} 正在使用 ${decision.action.label}${targetName ? " 目标 " + targetName : ""}`);
      this.broadcastInterimState();
      const actionLogs = await this.game.playAction(aiId, decision.action, decision.targetId);
      this.logs.push(...actionLogs);
      this.logs.push(...(await this.game.ensureTurnState()));
      this.logs.push(...(await this.game.resolvePendingDeaths()));
      this.trackBattlefield();
      this.broadcastState();
      await this.checkAndHandleGameOver();
      await this.advanceIfCurrentPlayerDead();
      if (!this.game.getCurrentPlayer().alive) {
        return;
      }
      if (this.game.getPendingDiscardCount(aiId) === 0) {
        await this.resolveTurnEnd(aiId);
      }
      await this.delay(AI_ACTION_PACING_MS);
      actionsTaken += 1;
    }
  }

  /** 强制结束当前 AI 的出牌阶段；返回 false 表示回合已终止（无人存活或无结束动作）。 */
  private async forceEndAiTurn(aiId: string): Promise<boolean> {
    const forcedEndAction = this.game.getPlayableActions(aiId).find((action) => action.type === "end");
    if (!forcedEndAction) {
      return false;
    }
    const endLogs = await this.game.playAction(aiId, forcedEndAction);
    this.logs.push(...endLogs);
    this.broadcastState();
    await this.checkAndHandleGameOver();
    await this.advanceIfCurrentPlayerDead();
    if (!this.game.getCurrentPlayer().alive) {
      return false;
    }
    if (this.game.getPendingDiscardCount(aiId) === 0) {
      await this.resolveTurnEnd(aiId);
    }
    await this.delay(AI_ACTION_PACING_MS);
    return true;
  }

  private labelPlayer(playerId: string): string {
    return this.game.getSnapshot().players.find((player) => player.id === playerId)?.name ?? playerId;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), ms);
    });
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
    try {
      // Broadcast an interim state with empty actions before playAction.
      // This gives all clients immediate feedback (log line visible) without
      // prompting the attacker for a new action while the engine is resolving
      // interactions (dodge, skill triggers, etc.).
      const targetName = targetId
        ? this.game.getSnapshot().players.find((p) => p.id === targetId)?.name ?? targetId
        : undefined;
      if (action.type !== "end") {
        this.logs.push(`${peer.name} 正在使用 ${action.label}${targetName ? " 目标 " + targetName : ""}`);
        this.broadcastInterimState();
      }

      const logs: string[] = [];
      logs.push(...(await this.game.playAction(peer.id, action, targetId, selectedCardId)));
      logs.push(...(await this.game.ensureTurnState()));
      logs.push(...(await this.game.resolvePendingDeaths()));
      this.logs.push(...logs);
      this.broadcastState();

      await this.checkAndHandleGameOver();
      await this.advanceIfCurrentPlayerDead();
      if (!this.game.getCurrentPlayer().alive) return;
      if (this.game.getPendingDiscardCount(peer.id) === 0) {
        await this.resolveTurnEnd(peer.id);
      }
    } finally {
      this.pendingAction = null;
    }
  }

  private async handleDiscard(peer: Peer, handIndex: number): Promise<void> {
    const logs = await this.game.discardForCurrentPlayer(peer.id, handIndex);
    this.logs.push(...logs);
    this.broadcastState();
    await this.checkAndHandleGameOver();
    if (this.game.getPendingDiscardCount(peer.id) === 0) {
      await this.resolveTurnEnd(peer.id);
    }
  }

  /**
   * 回合末策略复盘：捕获当前快照后在后台并行执行，不阻塞下一玩家出牌。
   */
  private reviewStrategiesForTurnEnd(enderId: string): void {
    if (!this.aiLoop || this.aiPlayerIds.length === 0) {
      return;
    }
    const mode = this.options.aiStrategy ?? "own";
    const targets = this.aiPlayerIds.filter((aiId) => (mode === "own" ? aiId === enderId : true));
    if (targets.length === 0) {
      return;
    }
    const snapshot = this.game.getSnapshot();
    for (const aiId of targets) {
      const name = snapshot.players.find((player) => player.id === aiId)?.name ?? aiId;
      this.logs.push(`[AI] ${name} 正在复盘局势...`);
      this.broadcastInterimState();
      void this.aiLoop.reviewStrategy(this.game, aiId, snapshot).catch(() => {// 后台复盘失败不影响对局
      });
    }
  }

  private async resolveTurnEnd(playerId: string): Promise<void> {
    const enderId = this.game.consumePendingTurnEnd();
    if (enderId !== playerId) return;
    const effects = this.game.getTurnEndOptionalEffects(playerId);
    for (const effect of effects) {
      await this.askOptionalEffect(playerId, effect, "结束阶段");
    }
    const player = this.game.getSnapshot().players.find((p) => p.id === playerId);
    if (player) {
      const logs = await this.game.finishTurn(player as any);
      this.logs.push(...logs);
      this.trackBattlefield();
      this.broadcastState();
      await this.checkAndHandleGameOver();
      this.reviewStrategiesForTurnEnd(playerId);
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
    await this.checkAndHandleGameOver();
    this.reviewStrategiesForTurnEnd(current.id);
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
    const players = [
      ...Array.from(this.peers.values()).map(({ id, name }) => ({ id, name })),
      ...this.buildAiConfigs().map(({ id, name }) => ({ id, name })),
    ];
    this.broadcast({ type: "lobby", players, roomSize: this.options.playerCount });
  }

  private broadcastState(): void {
    this.trackBattlefield();
    for (const peer of this.peers.values()) this.sendStateToPeer(peer);
  }

  /**
   * Broadcast a state snapshot with empty actions/removableCards/discard.
   * Used to give clients immediate feedback before a blocking action
   * resolution starts, without prompting them for new input.
   */
  private broadcastInterimState(): void {
    for (const peer of this.peers.values()) {
      const snapshot = this.game.getSnapshot();
      this.send(peer.socket, {
        type: "state",
        snapshot: createClientSnapshot(snapshot, peer.id),
        actions: [],
        removableCards: {},
        pendingDiscardCount: 0,
        logs: this.logs.slice(-30),
      });
    }
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
      const restartAfterClose = this.options.autoRestartAfterClose;
      for (const other of this.peers.values()) {
        this.send(other.socket, { type: "closed", message: `${peer.name} 断线超时，房间即将重启` });
        other.socket.end();
      }
      this.disconnected.clear();
      if (restartAfterClose) {
        this.game = new SanGuoGame(secureRng);
        this.game.setDeferDyingResolution(true);
        this.peers.clear();
        this.logs.length = 0;
        this.pendingAction = null;
        this.pendingInteraction = null;
        this.nextPlayerNumber = 1;
        this.started = false;
        console.log("房间超时关闭，已重置等待新玩家加入");
      }
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
