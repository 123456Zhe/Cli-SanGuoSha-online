import { createServer, Socket, Server } from "node:net";
import { createHash, randomInt } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AiModelProvider, GameAiLoop, ReasoningMode } from "../agent/ai.js";
import { LocalAiEngine } from "../agent/local-engine.js";
import { buildBattlefieldLines, buildRoundContexts, trackRoundBattlefield } from "../agent/round-context.js";
import { computeAiTurnActionLimit, pickAiTurnDecision } from "../agent/turn-decision.js";
import { GameAction, GameSnapshot, InteractionDecision, InteractionRequest, NetworkPlayerConfig, SanGuoGame, SkillName } from "../engine/game.js";
import { CardType } from "../engine/cards.js";
import { ClientMessage, createClientSnapshot, encodeMessage, NETWORK_PROTOCOL_VERSION, ServerMessage } from "./protocol.js";
import { JsonLineParser } from "./line-parser.js";

type Peer = { id: string; name: string; socket: Socket; parser: JsonLineParser<ClientMessage> };
type PendingInteraction = {
  playerId: string;
  request: InteractionRequest;
  resolve: (decision: InteractionDecision) => void;
};

export type GameServerOptions = {
  host: string;
  port: number;
  playerCount: number;
  openingHandCount: number;
  reconnectTimeoutMs?: number;
  autoRestartAfterGameOver?: boolean;
  /** 允许同一来源（机器）同时在线多个玩家。默认 false：一台机器同一时间只允许一个活跃座位。 */
  allowMultiConnectionsPerSource?: boolean;
  /** rules.md 的显式路径（嵌入到其他进程/仓库时 cwd 不可靠），缺省回落 process.cwd()/rules.md。 */
  rulesPath?: string;
  aiCount?: number;
  aiDriver?: AiModelProvider | "simple";
  aiThinkingMs?: number;
  aiContextRounds?: number;
  aiReasoning?: ReasoningMode;
  aiStrategy?: "own" | "always";
  /** 服务端日志等级：info=仅关键事件（默认）；debug=每一条对局日志实时回显并完整写入 devlog/server-log.md。 */
  logLevel?: "info" | "debug";
};

const AI_NAME_PREFIX = "[AI]电脑-";
const AI_NAME_SEQUENCE = ["甲", "乙", "丙", "丁", "戊"];
const DEFAULT_CONTEXT_ROUNDS = 30;
const AI_ACTION_PACING_MS = 800;

const secureRng = (): number => randomInt(0, 0x1_0000_0000) / 0x1_0000_0000;

/** 来源指纹：sha1(IP:机器标识)。机器标识由客户端持久化（WebUI=localStorage，CLI=配置文件），
 *  使同一公网 IP（NAT）下的不同机器不会被误判为同一台；同一台机器的不同窗口/终端可被识别。 */
const fingerprintOf = (ip: string, machineId: string): string =>
  createHash("sha1").update(`${ip.replace(/^::ffff:/, "")}:${machineId}`).digest("hex").slice(0, 16);

type SourceInfo = { fingerprint: string; verified: boolean };

export class GameServer {
  private game: SanGuoGame;
  private readonly peers = new Map<Socket, Peer>();
  private logs: string[] = [];
  private started = false;
  private nextPlayerNumber = 1;
  private pendingAction: { peer: Peer; action: GameAction; targetId?: string; selectedCardId?: string } | null = null;
  private pendingInteraction: PendingInteraction | null = null;
  private readonly disconnected = new Map<string, string>(); // playerId -> 玩家名（断线托管，可随时重连取回）
  private readonly disconnectedIds = new Set<string>();
  private readonly takeoverIds = new Set<string>(); // 断线托管中的人类座位
  private readonly seatEpoch = new Map<string, number>(); // 每次断线/重连递增，用于终止在途的 AI 代打
  private readonly activeDrivers = new Set<string>(); // 正在驱动出牌的座位，防止并发双驱
  private readonly sourceFingerprints = new Map<Socket, { ip: string; machineId: string }>(); // 连接 -> 来源（中继透传或按对端 IP 计算）
  private server: Server | null = null;
  private restarting = false;
  private closing = false;
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
    this.contextRounds = options.aiContextRounds ?? DEFAULT_CONTEXT_ROUNDS;
    // 无论是否配置 AI 座位都构建决策引擎：断线托管需要为掉线的人类玩家代打（
    // 与 --ai-driver 一致：qwen/ollama 走 LLM，simple 走本地策略）。
    const rulesText = this.loadRules();
    this.localAiEngine = new LocalAiEngine(rulesText);
    this.localAiEngine.setMaxContextRounds(this.contextRounds);
    this.localAiEngine.setAllowNonAiSeats(true);
    const driver = options.aiDriver ?? "qwen";
    if (driver === "simple") {
      this.aiLoop = null;
    } else {
      this.aiLoop = new GameAiLoop(rulesText, driver);
      this.aiLoop.setAllowNonAiSeats(true);
      this.aiLoop.setMaxContextRounds(this.contextRounds);
      this.aiLoop.setThinkingMs(options.aiThinkingMs ?? 1200);
      if (options.aiReasoning) {
        this.aiLoop.setReasoningMode(options.aiReasoning);
      }
    }
  }

  private loadRules(): string {
    const path = this.options.rulesPath ?? resolve(process.cwd(), "rules.md");
    try {
      return readFileSync(path, "utf-8");
    } catch {
      return "";
    }
  }

  /** 追加对局日志；debug 等级下逐条回显到房主控制台并完整追加写入 devlog/server-log.md（跨局保留，不截断）。 */
  private log(...lines: string[]): void {
    this.logs.push(...lines);
    if (this.options.logLevel !== "debug") {
      return;
    }
    const timestamp = new Date().toISOString();
    const text = lines.map((line) => `[${timestamp}] ${line}`).join("\n");
    console.log(`[server] ${text}`);
    try {
      const dir = resolve(process.cwd(), "devlog");
      mkdirSync(dir, { recursive: true });
      appendFileSync(resolve(dir, "server-log.md"), `${text}\n`, "utf-8");
    } catch {
      // 文件日志写入失败不影响对局
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
    this.closing = true;
    this.clearDisconnected();
    await new Promise<void>((resolve) => {
      this.server!.close(() => {
        for (const peer of this.peers.values()) peer.socket.destroy();
        this.peers.clear();
        resolve();
      });
    });
  }

  getDisconnectedIds(): string[] {
    return Array.from(this.disconnectedIds);
  }

  clearDisconnected(): void {
    this.disconnected.clear();
    this.disconnectedIds.clear();
    this.takeoverIds.clear();
    this.activeDrivers.clear();
    this.seatEpoch.clear();
  }

  private isAiPlayer(playerId: string): boolean {
    return this.aiPlayerIds.includes(playerId);
  }

  /** 座位当前是否由 AI 驱动：原生 AI 座位 + 断线托管的人类座位。 */
  private isAiDriven(playerId: string): boolean {
    if (this.aiPlayerIds.includes(playerId) || this.takeoverIds.has(playerId)) {
      return true;
    }
    // 兜底：游戏预初始化（测试/直接传入）时 aiPlayerIds 可能未赋值，以引擎的 isAI 为准。
    const player = this.game.getSnapshot().players.find((item) => item.id === playerId);
    return player?.isAI ?? false;
  }

  private bumpEpoch(playerId: string): void {
    this.seatEpoch.set(playerId, this.getEpoch(playerId) + 1);
  }

  private getEpoch(playerId: string): number {
    return this.seatEpoch.get(playerId) ?? 0;
  }

  /** 驱动循环每次 await 后校验：epoch 变化说明玩家已重连/再次掉线，或服务器正在关闭，应停止代打。 */
  private isStaleDrive(playerId: string, driveEpoch: number): boolean {
    return this.closing || this.getEpoch(playerId) !== driveEpoch;
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
    this.log(msg);
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
    socket.on("close", () => {
      this.sourceFingerprints.delete(socket);
      this.disconnect(socket);
    });
    socket.on("error", () => this.disconnect(socket));
  }

  private handle(socket: Socket, parser: JsonLineParser<ClientMessage>, message: ClientMessage): void {
    if (message.type === "source") {
      // 客户端机器标识：CLI/浏览器发送；中继会补上浏览器真实 IP 再转发。
      this.sourceFingerprints.set(socket, {
        ip: message.ip ?? socket.remoteAddress ?? "unknown",
        machineId: message.machineId,
      });
      return;
    }
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

  /** 来源信息：有机器标识的连接视为“已验证机器”（参加同机校验）；否则降级为仅按 IP 指纹，不参与机器校验。 */
  private getSourceInfo(socket: Socket): SourceInfo {
    const info = this.sourceFingerprints.get(socket);
    if (info && info.machineId) {
      return { fingerprint: fingerprintOf(info.ip, info.machineId), verified: true };
    }
    return { fingerprint: fingerprintOf(socket.remoteAddress ?? "unknown", ""), verified: false };
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
    // 同机校验：指纹 = sha1(IP:机器标识)，同一台机器（浏览器 localStorage / CLI 配置文件一致）
    // 同时只允许一个活跃玩家，防“双开不同名整人”。同一公网 IP（NAT）下不同机器标识不同，不会误伤。
    // 未提供机器标识的连接（旧客户端）跳过机器校验；重连（reconnect）不走此路径。
    if (!this.options.allowMultiConnectionsPerSource) {
      const mine = this.getSourceInfo(socket);
      if (mine.verified) {
        const sameSource = Array.from(this.peers.values()).find((peer) => {
          const theirs = this.getSourceInfo(peer.socket);
          return theirs.verified && theirs.fingerprint === mine.fingerprint;
        });
        if (sameSource) {
          this.send(socket, {
            type: "closed",
            message: `本机已有玩家「${sameSource.name}」在线：同一台机器同一时间只允许一个玩家（防止双开），请先关闭另一个窗口/终端`,
          });
          socket.end();
          return;
        }
      }
    }
    if (this.started) {
      // Normal reconnection: player is in disconnected map (clean disconnect)
      const entry = Array.from(this.disconnected.entries()).find(([, playerName]) => playerName === trimmed);
      if (entry) {
        this.handleReconnect(socket, parser, entry[0], version);
        return;
      }
      // Client crash / ungraceful disconnect: player exists in game but not in
      // disconnected map. Force-kick the old peer and treat as reconnect.
      // 跨机同名视为“换设备接管”：通知旧连接停止，避免两端互相抢座。
      const gamePlayer = this.game.getSnapshot().players.find((p) => p.name === trimmed);
      if (gamePlayer) {
        for (const [s, p] of this.peers) {
          if (p.id === gamePlayer.id) {
            this.send(s, { type: "closed", message: `你的名字「${trimmed}」已在其他设备登录，本连接已关闭` });
            this.peers.delete(s);
            s.end();
          }
        }
        this.disconnected.set(gamePlayer.id, trimmed);
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
    if (Array.from(this.peers.values()).some((peer) => peer.name === trimmed)) {
      this.send(socket, { type: "closed", message: "该名字已被占用，请换一个名字" });
      socket.end();
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
    let playerName = this.disconnected.get(playerId);
    if (!playerName) {
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
    this.disconnected.delete(playerId);
    this.disconnectedIds.delete(playerId);
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
    // 重连即交还控制权：终止在途的 AI 代打，座位决策改回由该玩家的 socket 提供。
    const wasTakenOver = this.takeoverIds.delete(playerId);
    this.bumpEpoch(playerId);
    this.game.setDecisionHandler(playerId, (request) => this.requestPeerDecision(playerId, request));
    this.send(socket, { type: "reconnect_ok", playerId });
    if (this.pendingInteraction?.playerId === playerId) {
      this.send(socket, { type: "interaction", request: this.pendingInteraction.request });
    }
    this.broadcast({ type: "player_reconnected", playerName });
    this.log(wasTakenOver ? `${playerName} 已重连，AI 控制权已交还` : `${playerName} 已重连`);
    console.log(wasTakenOver ? `${playerName} 已重连，AI 控制权已交还` : `${playerName} 已重连`);
    this.sendStateToPeer(peer);
    this.broadcastState();
  }

  private startGame(): void {
    this.started = true;
    void (async () => {
      const snapshot = this.game.getSnapshot();
      if (snapshot.players.length === 0) {
        const aiConfigs = this.buildAiConfigs();
        this.aiPlayerIds = aiConfigs.map((config) => config.id);
        this.log(
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
    for (const aiId of this.aiPlayerIds) {
      this.game.setDecisionHandler(aiId, (request) => this.decideInteractionAi(aiId, request));
    }
  }

  /** 原生 AI 与断线托管共用的交互决策：choose-suit 等纯概率响应返回 null 走引擎自动决策。 */
  private async decideInteractionAi(playerId: string, request: InteractionRequest): Promise<InteractionDecision | null> {
    if (request.kind === "choose-suit") {
      return null; // 纯概率响应走引擎自动决策
    }
    if (this.aiLoop) {
      return (await this.aiLoop.decideInteraction(this.game, playerId, request)) ?? null;
    }
    return null;
  }

  /** 断线托管：把人类座位的交互决策改路由给 AI，并为 LLM 驱动注册子代理。 */
  private registerTakeoverSeat(playerId: string, player?: GameSnapshot["players"][number]): void {
    const seat = player ?? this.game.getSnapshot().players.find((item) => item.id === playerId);
    if (seat) {
      this.aiLoop?.registerSeatForTakeover(playerId, seat.name, seat.role, seat.general);
    }
    this.game.setDecisionHandler(playerId, (request) => this.decideInteractionAi(playerId, request));
  }

  /** 断线时改由 AI 应答正在等待的交互；若等待期间玩家已重连则放弃代答改为 pass。 */
  private async answerPendingForTakeover(playerId: string, pending: PendingInteraction, epoch: number): Promise<void> {
    try {
      if (this.isStaleDrive(playerId, epoch)) {
        pending.resolve({ choice: "pass" });
        return;
      }
      const decision = await this.decideInteractionAi(playerId, pending.request);
      pending.resolve(decision ?? { choice: "pass" });
    } catch {
      pending.resolve({ choice: "pass" });
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
        // Player is not connected AND not AI-driven (断线托管会把该座位的 handler 切到 AI，
        // 因此正常流程不会走到这里)——自动 pass，避免牌局等待一个不在线的玩家。
        this.pendingInteraction = null;
        resolve({ choice: "pass" });
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

  private async askOptionalEffect(playerId: string, effect: SkillName | CardType, phase: "摸牌阶段" | "结束阶段"): Promise<void> {
    const effectLabel = effect as string;
    const reason = `${phase}是否发动${effectLabel}？`;
    this.game.setOptionalEffectDecision(playerId, effect, false);
    let decision: InteractionDecision | null;
    if (this.isAiDriven(playerId)) {
      decision = await this.decideInteractionAi(playerId, {
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
    this.log(...logs);
    this.trackBattlefield();
    this.broadcastState();
    await this.checkAndHandleGameOver();
    // startTurn 可能因「跳过出牌阶段」（乐不思蜀判定失败、翻面等）直接走完弃牌，
    // 把回合收尾挂起到 pendingTurnEndPlayer——正常路径由出牌/弃牌消息触发 resolveTurnEnd 消费，
    // 这里必须统一消费，否则真人/AI 回合都会卡死在弃牌阶段（pendingDiscardCount=0 且无动作可执行）。
    // resolveTurnEnd 内部自带保护：pendingTurnEndPlayer 为空或不属于当前玩家时直接返回。
    await this.resolveTurnEnd(playerId);
    if (!this.game.isGameOver() && this.isAiDriven(this.game.getCurrentPlayer().id)) {
      await this.driveAiTurn(this.game.getCurrentPlayer().id);
    }
  }

  private async driveAiTurn(aiId: string): Promise<void> {
    if (!this.localAiEngine) {
      return;
    }
    if (this.activeDrivers.has(aiId)) {
      return; // 已有驱动循环在跑（断线瞬间与回合流程并发时避免双驱）
    }
    this.activeDrivers.add(aiId);
    const driveEpoch = this.getEpoch(aiId);
    const seatLabel = this.aiPlayerIds.includes(aiId) ? "[AI]" : "（托管）";
    try {
      let actionsTaken = 0;
      while (true) {
        if (this.isStaleDrive(aiId, driveEpoch)) {
          return; // 玩家已重连，交还控制权
        }
        if (this.game.isGameOver()) {
          return;
        }
        const snapshot = this.game.getSnapshot();
        const current = snapshot.players.find((player) => player.id === snapshot.currentPlayerId);
        if (!current || !current.alive || !this.isAiDriven(current.id) || current.id !== aiId) {
          return;
        }
        if (this.game.getPlayableActions(aiId).length === 0) {
          return;
        }
        // 兜底：LLM 可能反复执行木牛流马「置入/取出」等无收益空转，动作数达上限强制收尾
        const actionLimit = computeAiTurnActionLimit(current.hand.length, current.treasureCards.length);
        if (actionsTaken >= actionLimit) {
          this.log(`${seatLabel} ${current.name} 回合动作已达上限（${actionLimit}），强制结束出牌`);
          this.broadcastInterimState();
          const ended = await this.forceEndAiTurn(aiId);
          if (!ended || this.isStaleDrive(aiId, driveEpoch)) {
            return;
          }
          continue;
        }
        this.trackBattlefield();
        const previousRounds = buildRoundContexts(this.logs, this.roundBattlefieldHistory, snapshot.turn, this.contextRounds);
        this.aiLoop?.setPreviousRoundContexts(previousRounds);
        this.localAiEngine.syncPreviousRounds(previousRounds);
        this.log(`${seatLabel} ${current.name} 正在思考...`);
        this.broadcastInterimState();
        const picked = await pickAiTurnDecision(this.game, aiId, this.aiLoop, this.localAiEngine);
        if (this.isStaleDrive(aiId, driveEpoch)) {
          return; // 决策期间玩家已重连，放弃本次代打出牌
        }
        const decision = picked.decision;
        if (!decision) {
          const ended = await this.forceEndAiTurn(aiId);
          if (!ended || this.isStaleDrive(aiId, driveEpoch)) {
            return;
          }
          continue;
        }
        const targetText = decision.targetId ? ` -> ${this.labelPlayer(decision.targetId)}` : "";
        const reasonText = picked.fallbackReason ? `（回退原因：${picked.fallbackReason}）` : "";
        this.log(`[${picked.driverLabel}] ${current.name} 选择：${decision.action.label}${targetText}${reasonText}`);
        const targetName = decision.targetId
          ? this.game.getSnapshot().players.find((player) => player.id === decision.targetId)?.name ?? decision.targetId
          : undefined;
        this.log(`${current.name} 正在使用 ${decision.action.label}${targetName ? " 目标 " + targetName : ""}`);
        this.broadcastInterimState();
        const actionLogs = await this.game.playAction(aiId, decision.action, decision.targetId);
        if (this.isStaleDrive(aiId, driveEpoch)) {
          return;
        }
        this.log(...actionLogs);
        this.log(...(await this.game.ensureTurnState()));
        this.log(...(await this.game.resolvePendingDeaths()));
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
    } finally {
      this.activeDrivers.delete(aiId);
    }
  }

  /** 强制结束当前 AI 的出牌阶段；返回 false 表示回合已终止（无人存活或无结束动作）。 */
  private async forceEndAiTurn(aiId: string): Promise<boolean> {
    const forcedEndAction = this.game.getPlayableActions(aiId).find((action) => action.type === "end");
    if (!forcedEndAction) {
      return false;
    }
    const endLogs = await this.game.playAction(aiId, forcedEndAction);
    this.log(...endLogs);
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
        this.log(`${peer.name} 正在使用 ${action.label}${targetName ? " 目标 " + targetName : ""}`);
        this.broadcastInterimState();
      }

      const logs: string[] = [];
      logs.push(...(await this.game.playAction(peer.id, action, targetId, selectedCardId)));
      logs.push(...(await this.game.ensureTurnState()));
      logs.push(...(await this.game.resolvePendingDeaths()));
      this.log(...logs);
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
    this.log(...logs);
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
      this.log(`[AI] ${name} 正在复盘局势...`);
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
      this.log(...logs);
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
    this.log(...logs);
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
    if (this.closing) {
      return;
    }
    if (player && !player.alive) {
      this.log(`${peer.name} 已阵亡退出`);
      console.log(`${peer.name} 阵亡退出，无需等待重连`);
      return;
    }
    // 断线托管：座位立即交给 AI（LLM 或本地策略）代打，玩家可随时重连取回控制权，
    // 不再有“超时未重连即关闭房间”的行为。
    this.takeoverIds.add(peer.id);
    this.bumpEpoch(peer.id);
    this.registerTakeoverSeat(peer.id, player);
    this.disconnected.set(peer.id, peer.name);
    this.disconnectedIds.add(peer.id);
    if (!alreadyNotified) {
      this.broadcast({ type: "player_disconnected", playerName: peer.name, waitTimeSeconds: this.reconnectTimeoutMs / 1000 });
    }
    this.log(`${peer.name} 断线了，AI 已托管其座位，可随时重连取回控制权`);
    console.log(`${peer.name} 断线，AI 托管中，可随时重连`);
    // 正在等待该玩家的交互请求改由 AI 应答（若等待期间玩家已重连则改为 pass）。
    if (this.pendingInteraction?.playerId === peer.id) {
      const pending = this.pendingInteraction;
      this.pendingInteraction = null;
      const epoch = this.getEpoch(peer.id);
      void this.answerPendingForTakeover(peer.id, pending, epoch);
    }
    // 若当前正是该玩家行动，立即驱动 AI 推进回合，避免牌局停滞。
    if (!this.game.isGameOver() && this.game.getCurrentPlayer().id === peer.id && player?.alive) {
      void this.driveAiTurn(peer.id);
    }
    this.broadcastState();
  }

  private send(socket: Socket, message: ServerMessage): void {
    socket.write(encodeMessage(message));
  }

  private broadcast(message: ServerMessage): void {
    for (const peer of this.peers.values()) this.send(peer.socket, message);
  }
}
