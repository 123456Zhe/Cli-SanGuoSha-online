import { BoxRenderable, KeyEvent, TextRenderable, createCliRenderer } from "@opentui/core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AiModelProvider, GameAiLoop } from "../agent/ai.js";
import { LocalAiEngine } from "../agent/local-engine.js";
import { RoundPromptContext } from "../agent/prompt.js";
import { buildBattlefieldLines, buildRoundContexts, trackRoundBattlefield } from "../agent/round-context.js";
import { computeAiTurnActionLimit, pickAiTurnDecision } from "../agent/turn-decision.js";
import { CardType } from "../engine/cards.js";
import { GameAction, GameInitOptions, InteractionDecision, InteractionRequest, Player, PlayerRole, RemovableCardOption, SanGuoGame } from "../engine/game.js";
import { extractCardTypeFromAction, getActionHint } from "./action-hints.js";
import { buildActionLines, buildDisplayLines, buildStatusLines } from "./render-lines.js";

type InputMode = "setup" | "action" | "target" | "target-card" | "response" | "discard" | "gameover";

type SetupStage = "player-count" | "role" | "kingdom" | "general" | "ai-model" | "ollama-model" | "start";

type SetupAiModel = "simple" | AiModelProvider;

type Kingdom = "魏" | "蜀" | "吴" | "群雄";

type FocusArea = "display" | "action" | "status";

type AppOptions = {
  initOptions: Partial<GameInitOptions>;
};

type TargetAction = Exclude<GameAction, { type: "end" }>;

export class CliSanGuoApp {
  private readonly game: SanGuoGame;

  private renderer?: Awaited<ReturnType<typeof createCliRenderer>>;

  private battlefieldView?: TextRenderable;

  private actionView?: TextRenderable;

  private logsView?: TextRenderable;

  private displayColumn?: BoxRenderable;

  private actionColumn?: BoxRenderable;

  private statusColumn?: BoxRenderable;

  private logs: string[];

  private mode: InputMode;

  private actionOptions: GameAction[];

  private targetOptions: Player[];

  private pendingAction: TargetAction | null;

  private pendingInteraction: { request: InteractionRequest; resolve: (decision: InteractionDecision) => void } | null;

  private pendingTargetId: string | null;

  private targetCardOptions: RemovableCardOption[];

  private commandBuffer: string | null;

  private readonly options: AppOptions;

  private readonly generalLibrary: ReturnType<SanGuoGame["getGeneralLibrary"]>;

  private readonly rulesLines: string[];

  private readonly aiLoop: GameAiLoop;

  private readonly localAiEngine: LocalAiEngine;

  private displayOverlayTitle: string | null;

  private displayOverlayLines: string[];

  private displayPage: number;

  private displayFollowLatest: boolean;

  private actionPage: number;

  private statusPage: number;

  private setupStage: SetupStage;

  private setupPlayerCount: number;

  private setupRole: PlayerRole;

  private setupKingdom: Kingdom;

  private setupGeneralName: string;

  private setupAiModel: SetupAiModel;

  private setupOllamaModel: string;

  private setupOllamaModels: string[];

  private setupOllamaLoading: boolean;

  private setupOllamaLoadError: string | null;

  private focusArea: FocusArea;

  private busy: boolean;

  private roundBattlefieldHistory: Map<number, string[]>;

  private readonly maxContextRounds: number;

  constructor(game: SanGuoGame, options: AppOptions) {
    this.game = game;
    this.options = options;
    this.logs = [];
    this.mode = "setup";
    this.actionOptions = [];
    this.targetOptions = [];
    this.pendingAction = null;
    this.pendingInteraction = null;
    this.pendingTargetId = null;
    this.targetCardOptions = [];
    this.commandBuffer = null;
    this.generalLibrary = this.game.getGeneralLibrary();
    this.rulesLines = this.loadRulesLines();
    this.aiLoop = new GameAiLoop(this.rulesLines.join("\n"));
    this.localAiEngine = new LocalAiEngine(this.rulesLines.join("\n"));
    this.displayOverlayTitle = null;
    this.displayOverlayLines = [];
    this.displayPage = 0;
    this.displayFollowLatest = true;
    this.actionPage = 0;
    this.statusPage = 0;
    this.setupStage = "player-count";
    this.setupPlayerCount = 3;
    this.setupRole = PlayerRole.Lord;
    this.setupKingdom = "吴";
    this.setupGeneralName = this.generalLibrary[0]?.name ?? "孙策";
    this.setupAiModel = "qwen";
    this.setupOllamaModel = "gemma4:latest";
    this.setupOllamaModels = [];
    this.setupOllamaLoading = false;
    this.setupOllamaLoadError = null;
    this.focusArea = "display";
    this.busy = false;
    this.roundBattlefieldHistory = new Map();
    this.maxContextRounds = this.readContextRounds();
    this.aiLoop.setMaxContextRounds(this.maxContextRounds);
    this.localAiEngine.setMaxContextRounds(this.maxContextRounds);
  }

  private readContextRounds(): number {
    const raw = process.env.SG_AI_CONTEXT_ROUNDS;
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 30;
  }

  async start(): Promise<void> {
    this.renderer = await createCliRenderer({
      exitOnCtrlC: true,
      consoleMode: "disabled",
      screenMode: "alternate-screen",
      useMouse: false,
    });

    const rootBox = new BoxRenderable(this.renderer, {
      width: "100%",
      height: "100%",
      border: true,
      title: "CLI SanGuo",
      padding: 1,
      flexDirection: "row",
    });

    this.displayColumn = new BoxRenderable(this.renderer, {
      width: "40%",
      height: "100%",
      border: true,
      title: "显示区",
      padding: 1,
      flexDirection: "column",
    });

    this.actionColumn = new BoxRenderable(this.renderer, {
      width: "30%",
      height: "100%",
      border: true,
      title: "操作区",
      padding: 1,
      flexDirection: "column",
    });

    this.statusColumn = new BoxRenderable(this.renderer, {
      width: "30%",
      height: "100%",
      border: true,
      title: "战场状态",
      padding: 1,
      flexDirection: "column",
    });

    const displayBox = new BoxRenderable(this.renderer, {
      width: "100%",
      height: "100%",
      padding: 1,
    });

    this.battlefieldView = new TextRenderable(this.renderer, {
      width: "100%",
      height: "100%",
      content: "",
    });

    this.actionView = new TextRenderable(this.renderer, {
      width: "100%",
      height: "100%",
      content: "",
    });

    this.logsView = new TextRenderable(this.renderer, {
      width: "100%",
      height: "100%",
      content: "",
    });

    displayBox.add(this.battlefieldView);
    this.actionColumn.add(this.actionView);
    this.statusColumn.add(this.logsView);
    this.displayColumn.add(displayBox);
    rootBox.add(this.displayColumn);
    rootBox.add(this.actionColumn);
    rootBox.add(this.statusColumn);
    this.renderer.root.add(rootBox);
    this.renderer.keyInput.on("keypress", (event) => this.onKeyPress(event));
    this.updateFocusFrame();

    this.initSetup();
    this.refresh();
    this.renderer.start();
  }

  private onKeyPress(event: KeyEvent): void {
    if (this.busy) {
      return;
    }
    if (this.handleCommandInput(event)) {
      return;
    }
    if (this.handleAreaPagingInput(event)) {
      return;
    }
    if (this.mode === "gameover") {
      if (event.name === "r") {
        this.restart();
      }
      return;
    }
    if (this.mode === "setup") {
      void this.handleSetupInput(event);
      return;
    }
    if (this.mode === "response") {
      const pickedResponse = this.toOptionIndex(event);
      if (pickedResponse === null) {
        return;
      }
      void this.handleInteractionChoice(pickedResponse);
      return;
    }
    if (this.mode === "discard") {
      const pickedDiscard = this.toOptionIndex(event);
      if (pickedDiscard === null) {
        return;
      }
      void this.handleDiscardChoice(pickedDiscard);
      return;
    }
    if (this.mode === "target" && event.name === "b") {
      this.pendingAction = null;
      this.targetOptions = [];
      this.mode = "action";
      this.refresh();
      return;
    }
    if (this.mode === "target-card" && event.name === "b") {
      this.pendingTargetId = null;
      this.targetCardOptions = [];
      this.mode = "target";
      this.refresh();
      return;
    }
    const picked = this.toOptionIndex(event);
    if (picked === null) {
      return;
    }
    if (this.mode === "action") {
      const action = this.actionOptions[picked];
      if (!action) {
        return;
      }
      void this.handleActionChoice(action);
      return;
    }
    if (this.mode === "target") {
      const target = this.targetOptions[picked];
      if (!target || !this.pendingAction) {
        return;
      }
      void this.handleTargetChoice(target.id);
      return;
    }
    if (this.mode === "target-card") {
      if (this.targetCardOptions.length === 0) {
        if (picked === 0) {
          void this.handleTargetCardChoice("");
        }
        return;
      }
      const option = this.targetCardOptions[picked];
      if (!option) {
        return;
      }
      void this.handleTargetCardChoice(option.id);
    }
  }

  private async handleActionChoice(action: GameAction): Promise<void> {
    const current = this.game.getCurrentPlayer();
    if (action.type === "end") {
      await this.playAndAppendLogs(current.id, action);
      if (this.game.getPendingDiscardCount(current.id) > 0) {
        this.mode = "discard";
        this.refresh();
        return;
      }
      await this.resolveAiTurns();
      return;
    }
    if (!action.requiresTarget) {
      await this.playAndAppendLogs(current.id, action);
      await this.resolveAiTurns();
      return;
    }
    this.pendingAction = action;
    const snapshot = this.game.getSnapshot();
    this.targetOptions = snapshot.players.filter((player) => action.targets.includes(player.id));
    this.mode = "target";
    this.refresh();
  }

  private async handleTargetChoice(targetId: string): Promise<void> {
    if (!this.pendingAction) {
      return;
    }
    if (this.shouldSelectTargetCard(this.pendingAction)) {
      this.pendingTargetId = targetId;
      this.targetCardOptions = this.game.getRemovableCardOptions(targetId);
      this.mode = "target-card";
      this.refresh();
      return;
    }
    const current = this.game.getCurrentPlayer();
    await this.playAndAppendLogs(current.id, this.pendingAction, targetId);
    this.pendingAction = null;
    this.pendingTargetId = null;
    this.targetCardOptions = [];
    this.targetOptions = [];
    this.mode = "action";
    await this.resolveAiTurns();
  }

  private async handleTargetCardChoice(selectedCardId: string): Promise<void> {
    if (!this.pendingAction || !this.pendingTargetId) {
      return;
    }
    const current = this.game.getCurrentPlayer();
    await this.playAndAppendLogs(current.id, this.pendingAction, this.pendingTargetId, undefined, selectedCardId);
    this.pendingAction = null;
    this.pendingTargetId = null;
    this.targetCardOptions = [];
    this.targetOptions = [];
    this.mode = "action";
    await this.resolveAiTurns();
  }

  private async handleDiscardChoice(picked: number): Promise<void> {
    const current = this.game.getCurrentPlayer();
    if (current.id !== "human") {
      this.mode = "action";
      this.refresh();
      return;
    }
    const options = this.game.getDiscardOptions(current.id);
    const selected = options[picked];
    if (!selected) {
      return;
    }
    this.busy = true;
    try {
      const logs = await this.game.discardForCurrentPlayer(current.id, selected.handIndex);
      for (const line of logs) {
        this.logs.push(line);
        this.refresh();
        await this.delay(100);
      }
    } finally {
      this.busy = false;
    }
    if (this.game.getPendingDiscardCount(current.id) > 0) {
      this.mode = "discard";
      this.refresh();
      return;
    }
    await this.resolveAiTurns();
  }

  private async resolveAiTurns(): Promise<void> {
    let actionsTaken = 0;
    let actionsForPlayer: string | null = null;
    while (!this.game.getSnapshot().gameOver && this.game.getCurrentPlayer().isAI) {
      const turnStateLogs = await this.game.ensureTurnState();
      if (turnStateLogs.length > 0) {
        for (const line of turnStateLogs) {
          this.logs.push(line);
          this.refresh();
          await this.delay(120);
        }
        continue;
      }
      const ai = this.game.getCurrentPlayer();
      // 换人时重置动作计数（单个 AI 回合内累计）
      if (actionsForPlayer !== ai.id) {
        actionsForPlayer = ai.id;
        actionsTaken = 0;
      }
      // 兜底：LLM 可能反复执行木牛流马「置入/取出」等无收益空转，动作数达上限强制收尾
      const actionLimit = computeAiTurnActionLimit(ai.hand.length, ai.treasureCards.length);
      if (actionsTaken >= actionLimit) {
        this.logs.push(`[AI] ${ai.name} 回合动作已达上限（${actionLimit}），强制结束出牌`);
        this.refresh();
        const forcedEndAction = this.game.getPlayableActions(ai.id).find((action) => action.type === "end");
        if (!forcedEndAction) {
          break;
        }
        await this.playAndAppendLogs(ai.id, forcedEndAction, undefined, 120);
        continue;
      }
      const snapshot = this.game.getSnapshot();
      const previousRounds = this.getPreviousRoundPromptContexts(snapshot.turn);
      this.aiLoop.setPreviousRoundContexts(previousRounds);
      this.localAiEngine.syncPreviousRounds(previousRounds);
      const picked = await pickAiTurnDecision(this.game, ai.id, this.setupAiModel === "simple" ? null : this.aiLoop, this.localAiEngine);
      const normalizedDecision = picked.decision;
      if (!normalizedDecision) {
        const forcedEndAction = this.game.getPlayableActions(ai.id).find((action) => action.type === "end");
        if (!forcedEndAction) {
          break;
        }
        await this.playAndAppendLogs(ai.id, forcedEndAction, undefined, 120);
        continue;
      }
      if (picked.localInsight) {
        this.logs.push(`[本地AI-预判] ${ai.name}：${picked.localInsight}`);
      }
      const targetText = normalizedDecision.targetId ? ` -> ${this.labelPlayer(normalizedDecision.targetId)}` : "";
      const reasonText = picked.fallbackReason ? `（回退原因：${picked.fallbackReason}）` : "";
      const actionDelayMs = picked.driverLabel === "本地AI" ? 1000 : 200;
      this.logs.push(`[${picked.driverLabel}] ${ai.name} 选择：${normalizedDecision.action.label}${targetText}${reasonText}`);
      this.refresh();
      await this.delay(actionDelayMs);
      await this.playAndAppendLogs(ai.id, normalizedDecision.action, normalizedDecision.targetId, 200);
      actionsTaken += 1;
      // AI 回合结束：以高推理等级做一次策略博弈，后台并行执行不阻塞后续出牌
      if (this.game.getCurrentPlayer().id !== ai.id || !this.game.getCurrentPlayer().alive) {
        if (this.setupAiModel !== "simple") {
          const reviewSnapshot = this.game.getSnapshot();
          this.logs.push(`[AI] ${ai.name} 正在复盘局势...`);
          void this.aiLoop.reviewStrategy(this.game, ai.id, reviewSnapshot).catch(() => {
          // 后台复盘失败不影响对局
        });
        }
      }
    }
    this.mode = this.game.getSnapshot().gameOver ? "gameover" : "action";
    this.refresh();
  }

  private refresh(): void {
    if (!this.battlefieldView || !this.actionView || !this.logsView) {
      return;
    }
    if (this.mode === "setup") {
      this.refreshSetupViews();
      return;
    }
    const snapshot = this.game.getSnapshot();
    this.syncCurrentRoundBattlefield(snapshot);
    if (!snapshot.gameOver) {
      const current = this.game.getCurrentPlayer();
      this.actionOptions = current.isAI ? [] : this.game.getPlayableActions(current.id);
    } else {
      this.actionOptions = [];
    }
    const statusLines = buildStatusLines(snapshot, (playerId) => this.labelPlayer(playerId));

    const actionLines = buildActionLines({
      commandBuffer: this.commandBuffer,
      mode: this.mode,
      actionOptions: this.actionOptions,
      pendingAction: this.pendingAction,
      targetOptions: this.targetOptions,
      targetCardOptions: this.targetCardOptions,
      pendingInteraction: this.pendingInteraction,
      pendingTargetId: this.pendingTargetId,
      snapshot,
      labelPlayer: (playerId) => this.labelPlayer(playerId),
      isSnatch: (action) => this.isSnatchAction(action),
      getCommandListLines: () => this.getCommandListLines(),
      getActionHint: (action) => getActionHint(action),
    });

    const displayPageSize = this.getBodyPageSize("display");
    const actionPageSize = this.getBodyPageSize("action");
    const statusPageSize = this.getBodyPageSize("status");
    const displayLines: string[] = buildDisplayLines(this.logs, {
      title: this.displayOverlayTitle,
      lines: this.displayOverlayLines,
    });
    if (this.displayOverlayTitle === null && this.displayFollowLatest) {
      this.displayPage = this.getMaxPage(displayLines.length, displayPageSize);
    }
    const displayViewLines = this.renderPagedArea({
      title: "显示区",
      lines: displayLines,
      page: this.displayPage,
      pageSize: displayPageSize,
      focused: this.focusArea === "display",
    });
    this.displayPage = displayViewLines.page;

    const actionViewLines = this.renderPagedArea({
      title: "操作区",
      lines: actionLines,
      page: this.actionPage,
      pageSize: actionPageSize,
      focused: this.focusArea === "action",
    });
    this.actionPage = actionViewLines.page;

    const statusViewLines = this.renderPagedArea({
      title: "战场状态",
      lines: statusLines,
      page: this.statusPage,
      pageSize: statusPageSize,
      focused: this.focusArea === "status",
    });
    this.statusPage = statusViewLines.page;

    this.battlefieldView.content = displayViewLines.lines.join("\n");
    this.actionView.content = actionViewLines.lines.join("\n");
    this.logsView.content = statusViewLines.lines.join("\n");
  }

  private syncCurrentRoundBattlefield(snapshot: ReturnType<SanGuoGame["getSnapshot"]>): void {
    trackRoundBattlefield(this.roundBattlefieldHistory, snapshot.turn, buildBattlefieldLines(snapshot.players), this.maxContextRounds);
  }

  private getPreviousRoundPromptContexts(currentRound: number): RoundPromptContext[] {
    return buildRoundContexts(this.logs, this.roundBattlefieldHistory, currentRound, this.maxContextRounds);
  }

  private restart(): void {
    this.aiLoop.stop();
    this.localAiEngine.reset();
    this.logs = [];
    this.pendingAction = null;
    this.pendingTargetId = null;
    this.targetCardOptions = [];
    this.commandBuffer = null;
    this.closeDisplayOverlay();
    this.targetOptions = [];
    this.actionOptions = [];
    this.displayPage = 0;
    this.displayFollowLatest = true;
    this.actionPage = 0;
    this.statusPage = 0;
    this.initSetup();
    this.refresh();
  }

  private shutdown(): void {
    if (this.renderer) {
      this.renderer.destroy();
    }
    process.exit(0);
  }

  private labelPlayer(playerId: string): string {
    const player = this.game.getSnapshot().players.find((item) => item.id === playerId);
    return player ? player.name : playerId;
  }

  private toOptionIndex(event: KeyEvent): number | null {
    if (!event.name) {
      return null;
    }
    if (!/^\d+$/.test(event.name)) {
      return null;
    }
    const value = Number(event.name);
    if (!Number.isInteger(value) || value <= 0) {
      return null;
    }
    return value - 1;
  }

  private handleCommandInput(event: KeyEvent): boolean {
    if (this.commandBuffer !== null) {
      if (event.name === "escape") {
        this.commandBuffer = null;
        this.refresh();
        return true;
      }
      if (event.name === "backspace") {
        this.commandBuffer = this.commandBuffer.slice(0, -1);
        this.refresh();
        return true;
      }
      if (event.name === "return" || event.name === "linefeed") {
        const command = this.commandBuffer.trim();
        this.commandBuffer = null;
        this.executeCommand(command);
        this.refresh();
        return true;
      }
      const char = this.toCommandChar(event);
      if (char !== null) {
        this.commandBuffer += char;
        this.refresh();
      }
      return true;
    }
    const start = this.toCommandChar(event);
    if (start === "/") {
      this.commandBuffer = "/";
      this.refresh();
      return true;
    }
    return false;
  }

  private executeCommand(command: string): void {
    if (command === "/help") {
      this.openDisplayOverlay("完整规则", this.rulesLines);
      return;
    }
    if (command === "/rules") {
      this.openDisplayOverlay("完整规则", this.rulesLines);
      return;
    }
    if (command === "/close") {
      if (this.displayOverlayTitle === null) {
        this.logs.push("当前没有打开的文档");
        return;
      }
      this.closeDisplayOverlay();
      return;
    }
    if (command === "/exit") {
      this.logs.push("执行命令: /exit");
      this.shutdown();
      return;
    }
    if (command === "") {
      this.logs.push("命令为空");
      return;
    }
    this.logs.push(`未知命令: ${command}`);
  }

  private getCommandListLines(): string[] {
    return [
      "- /help 查看完整规则文档",
      "- /rules 查看完整规则文档（同 /help）",
      "- /close 关闭当前文档",
      "- /exit 退出游戏",
    ];
  }

  private loadRulesLines(): string[] {
    try {
      const content = readFileSync(resolve(process.cwd(), "rules.md"), "utf-8");
      const lines = content.split(/\r?\n/);
      return lines.length > 0 ? lines : ["rules.md 为空"];
    } catch {
      return ["未找到 rules.md，请先创建规则文件"];
    }
  }

  private initSetup(): void {
    const preferredCountSource = this.options.initOptions.playerCount ?? (this.options.initOptions.aiCount ?? 2) + 1;
    this.setupPlayerCount = Math.min(6, Math.max(2, Math.floor(preferredCountSource)));
    this.setupRole = PlayerRole.Lord;
    this.setupKingdom = "吴";
    this.setupGeneralName = this.getGeneralsByKingdom(this.setupKingdom)[0]?.name ?? (this.generalLibrary[0]?.name ?? "孙策");
    this.setupAiModel = "qwen";
    this.setupOllamaModel = "gemma4:latest";
    this.setupOllamaModels = [];
    this.setupOllamaLoading = false;
    this.setupOllamaLoadError = null;
    this.setupStage = "player-count";
    this.mode = "setup";
    this.focusArea = "display";
    this.updateFocusFrame();
    this.closeDisplayOverlay();
    this.displayPage = 0;
    this.displayFollowLatest = true;
    this.actionPage = 0;
    this.statusPage = 0;
  }

  private refreshSetupViews(): void {
    if (!this.battlefieldView || !this.actionView || !this.logsView) {
      return;
    }
    const usingOllama = this.setupAiModel === "ollama";
    const stageTitle =
      this.setupStage === "player-count"
        ? "步骤1/6：选择游玩人数"
        : this.setupStage === "role"
          ? "步骤2/6：选择身份"
          : this.setupStage === "kingdom"
            ? "步骤3/6：选择势力"
          : this.setupStage === "general"
              ? "步骤4/6：选择武将"
              : this.setupStage === "ai-model"
                ? "步骤5/6：选择默认AI模型"
                : this.setupStage === "ollama-model"
                  ? "步骤6/7：选择Ollama模型"
                  : usingOllama
                    ? "步骤7/7：开始游戏"
                    : "步骤6/6：开始游戏";
    const leftLines: string[] = [];
    if (this.setupStage === "player-count") {
      leftLines.push("请在操作区选择游玩人数");
    } else {
      leftLines.push("输入“/”进入命令模式，建议先用 /help 查看帮助文档");
      leftLines.push("");
      leftLines.push("开局配置");
      leftLines.push(stageTitle);
      leftLines.push("");
      leftLines.push(`- 游玩人数: ${this.setupPlayerCount}`);
      leftLines.push(`- 默认配比: ${this.getRoleDistributionText(this.setupPlayerCount)}`);
      leftLines.push(`- 我的身份: ${this.setupRole}`);
      leftLines.push(`- 势力: ${this.setupKingdom}`);
      leftLines.push(`- 我的武将: ${this.setupGeneralName}`);
      leftLines.push(`- 默认AI模型: ${this.getAiModelLabel(this.setupAiModel)}`);
      if (this.setupAiModel === "ollama") {
        leftLines.push(`- Ollama具体模型: ${this.setupOllamaModel}`);
      }
      leftLines.push("");
      leftLines.push("按 b 返回上一步");
    }

    const actionLines: string[] = [];
    actionLines.push("输入:");
    if (this.commandBuffer !== null) {
      actionLines.push(`命令模式: ${this.commandBuffer}`);
      actionLines.push("回车执行，退格删除，Esc 取消");
      actionLines.push("可用命令:");
      actionLines.push(...this.getCommandListLines());
    } else {
      const options = this.getSetupOptions();
      options.forEach((label, index) => {
        actionLines.push(`${index + 1}. ${label}`);
      });
      if (this.setupStage === "ollama-model" && this.setupOllamaLoadError) {
        actionLines.push(`读取失败：${this.setupOllamaLoadError}`);
      }
      actionLines.push("输入 / 进入命令模式");
    }

    const rightLines: string[] = ["战场将在开始游戏后显示"];
    const displayPageSize = this.getBodyPageSize("display");
    const actionPageSize = this.getBodyPageSize("action");
    const statusPageSize = this.getBodyPageSize("status");
    const displaySource = this.displayOverlayTitle
      ? buildDisplayLines(this.logs, { title: this.displayOverlayTitle, lines: this.displayOverlayLines })
      : leftLines;
    const displayViewLines = this.renderPagedArea({
      title: "显示区",
      lines: displaySource,
      page: this.displayPage,
      pageSize: displayPageSize,
      focused: this.focusArea === "display",
    });
    this.displayPage = displayViewLines.page;
    const actionViewLines = this.renderPagedArea({
      title: "操作区",
      lines: actionLines,
      page: this.actionPage,
      pageSize: actionPageSize,
      focused: this.focusArea === "action",
    });
    this.actionPage = actionViewLines.page;
    const statusViewLines = this.renderPagedArea({
      title: "战场状态",
      lines: rightLines,
      page: this.statusPage,
      pageSize: statusPageSize,
      focused: this.focusArea === "status",
    });
    this.statusPage = statusViewLines.page;

    this.battlefieldView.content = displayViewLines.lines.join("\n");
    this.actionView.content = actionViewLines.lines.join("\n");
    this.logsView.content = statusViewLines.lines.join("\n");
  }

  private async handleSetupInput(event: KeyEvent): Promise<void> {
    if (this.setupStage !== "player-count" && event.name === "b") {
      if (this.setupStage === "role") {
        this.setupStage = "player-count";
      } else if (this.setupStage === "kingdom") {
        this.setupStage = "role";
      } else if (this.setupStage === "general") {
        this.setupStage = "kingdom";
      } else if (this.setupStage === "ai-model") {
        this.setupStage = "general";
      } else if (this.setupStage === "ollama-model") {
        this.setupStage = "ai-model";
      } else {
        this.setupStage = this.setupAiModel === "ollama" ? "ollama-model" : "ai-model";
      }
      this.refresh();
      return;
    }
    const picked = this.toOptionIndex(event);
    if (picked === null) {
      return;
    }
    if (this.setupStage === "player-count") {
      const counts = this.getPlayerCountOptions();
      const count = counts[picked];
      if (!count) {
        return;
      }
      this.setupPlayerCount = count;
      const roles = this.getRoleOptions();
      if (!roles.includes(this.setupRole)) {
        this.setupRole = roles[0] ?? PlayerRole.Lord;
      }
      this.setupStage = "role";
      this.refresh();
      return;
    }
    if (this.setupStage === "role") {
      const roles = this.getRoleOptions();
      const role = roles[picked];
      if (!role) {
        return;
      }
      this.setupRole = role;
      this.setupStage = "kingdom";
      this.refresh();
      return;
    }
    if (this.setupStage === "kingdom") {
      const kingdoms = this.getKingdomOptions();
      const kingdom = kingdoms[picked];
      if (!kingdom) {
        return;
      }
      this.setupKingdom = kingdom;
      const generalsInKingdom = this.getGeneralsByKingdom(kingdom);
      this.setupGeneralName = generalsInKingdom[0]?.name ?? this.setupGeneralName;
      this.setupStage = "general";
      this.refresh();
      return;
    }
    if (this.setupStage === "general") {
      const generals = this.getGeneralsByKingdom(this.setupKingdom);
      const pickedGeneral = generals[picked];
      if (!pickedGeneral) {
        return;
      }
      this.setupGeneralName = pickedGeneral.name;
      this.setupStage = "ai-model";
      this.refresh();
      return;
    }
    if (this.setupStage === "ai-model") {
      const models = this.getAiModelOptions();
      const model = models[picked];
      if (!model) {
        return;
      }
      this.setupAiModel = model;
      if (model === "ollama") {
        this.setupStage = "ollama-model";
        this.refresh();
        await this.loadOllamaModelsForSetup();
        return;
      }
      this.setupStage = "start";
      this.refresh();
      return;
    }
    if (this.setupStage === "ollama-model") {
      if (this.setupOllamaLoading) {
        return;
      }
      const options = this.getSetupOptions();
      const selected = options[picked];
      if (!selected) {
        return;
      }
      if (selected === "重新读取本地模型列表") {
        await this.loadOllamaModelsForSetup();
        return;
      }
      if (selected === "使用默认模型（gemma4:latest）") {
        this.setupOllamaModel = "gemma4:latest";
      } else {
        this.setupOllamaModel = selected;
      }
      this.setupStage = "start";
      this.refresh();
      return;
    }
    if (this.setupStage === "start" && picked === 0) {
      void this.startConfiguredGame();
    }
  }

  private getSetupOptions(): string[] {
    if (this.setupStage === "player-count") {
      return this.getPlayerCountOptions().map((count) => `${count} 人局（${this.getRoleDistributionText(count)}）`);
    }
    if (this.setupStage === "role") {
      return this.getRoleOptions();
    }
    if (this.setupStage === "kingdom") {
      return this.getKingdomOptions();
    }
    if (this.setupStage === "general") {
      return this.getGeneralsByKingdom(this.setupKingdom).map((general) => {
        const skills = general.skills.length > 0 ? general.skills.join("、") : "无技能";
        return `${general.name}[${general.kingdom}] ${general.maxHp}体力（${skills}）`;
      });
    }
    if (this.setupStage === "ai-model") {
      return this.getAiModelOptions().map((model) => {
        const desc = model === "simple" ? "本地简单逻辑引擎" : model === "ollama" ? "本地 Ollama 模型" : "云端 Qwen 模型";
        return `${this.getAiModelLabel(model)}（${desc}）`;
      });
    }
    if (this.setupStage === "ollama-model") {
      if (this.setupOllamaLoading) {
        return ["正在读取本地 Ollama 模型..."];
      }
      if (this.setupOllamaLoadError) {
        return ["重新读取本地模型列表", "使用默认模型（gemma4:latest）"];
      }
      if (this.setupOllamaModels.length <= 0) {
        return ["重新读取本地模型列表", "使用默认模型（gemma4:latest）"];
      }
      return this.setupOllamaModels;
    }
    return ["开始游戏"];
  }

  private async loadOllamaModelsForSetup(): Promise<void> {
    this.setupOllamaLoading = true;
    this.setupOllamaLoadError = null;
    this.refresh();
    try {
      const models = await this.aiLoop.getAvailableOllamaModels();
      this.setupOllamaModels = models;
      if (models.length > 0) {
        this.setupOllamaModel = models[0] ?? this.setupOllamaModel;
      }
      if (models.length <= 0) {
        this.setupOllamaLoadError = "未读取到可用模型";
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.setupOllamaLoadError = reason.replace(/\s+/g, " ").trim();
      this.setupOllamaModels = [];
    } finally {
      this.setupOllamaLoading = false;
      this.refresh();
    }
  }

  private getPlayerCountOptions(): number[] {
    return [2, 3, 4, 5, 6];
  }

  private getRoleOptions(): PlayerRole[] {
    if (this.setupPlayerCount === 2) {
      return [PlayerRole.Lord, PlayerRole.Rebel];
    }
    if (this.setupPlayerCount === 3) {
      return [PlayerRole.Lord, PlayerRole.Rebel, PlayerRole.Traitor];
    }
    return [PlayerRole.Lord, PlayerRole.Loyalist, PlayerRole.Rebel, PlayerRole.Traitor];
  }

  private getKingdomOptions(): Kingdom[] {
    return ["魏", "蜀", "吴", "群雄"];
  }

  private getGeneralsByKingdom(kingdom: Kingdom): typeof this.generalLibrary {
    return this.generalLibrary.filter((general) => general.kingdom === kingdom);
  }

  private getAiModelOptions(): SetupAiModel[] {
    return ["simple", "ollama", "qwen"];
  }

  private getAiModelLabel(model: SetupAiModel): string {
    if (model === "simple") {
      return "Simple AI";
    }
    return model === "ollama" ? "Ollama" : "Qwen";
  }

  private getRoleDistributionText(playerCount: number): string {
    if (playerCount === 2) {
      return "反贼1 忠臣0 内奸0";
    }
    if (playerCount === 3) {
      return "反贼1 忠臣0 内奸1";
    }
    if (playerCount === 4) {
      return "反贼1 忠臣1 内奸1";
    }
    if (playerCount === 5) {
      return "反贼2 忠臣1 内奸1";
    }
    return "反贼3 忠臣1 内奸1";
  }

  private async startConfiguredGame(): Promise<void> {
    this.aiLoop.stop();
    this.localAiEngine.reset();
    if (this.setupAiModel === "ollama" || this.setupAiModel === "qwen") {
      this.aiLoop.setPreferredProvider(this.setupAiModel);
      this.aiLoop.setPreferredOllamaModel(this.setupAiModel === "ollama" ? this.setupOllamaModel : null);
    } else {
      this.aiLoop.setPreferredProvider("ollama");
      this.aiLoop.setPreferredOllamaModel(null);
    }
    this.logs = [];
    this.pendingAction = null;
    this.pendingInteraction = null;
    this.pendingTargetId = null;
    this.targetCardOptions = [];
    this.targetOptions = [];
    this.actionOptions = [];
    this.commandBuffer = null;
    this.roundBattlefieldHistory.clear();
    this.closeDisplayOverlay();
    this.displayPage = 0;
    this.actionPage = 0;
    this.statusPage = 0;
    const initLogs = await this.game.initDefaultGame({
      ...this.options.initOptions,
      playerCount: this.setupPlayerCount,
      aiCount: this.setupPlayerCount - 1,
      humanRole: this.setupRole,
      humanGeneral: this.setupGeneralName,
    });
    this.logs.push(...initLogs);
    const subAgentCount = this.aiLoop.start(this.game.getSnapshot());
    const providerText =
      this.setupAiModel === "ollama"
        ? `Ollama(${this.setupOllamaModel})`
        : this.setupAiModel === "simple"
          ? "Simple AI(本地逻辑引擎)"
          : this.getAiModelLabel(this.setupAiModel);
    this.logs.push(`AI 决策环已启动，默认模型 ${providerText}，创建 ${subAgentCount} 个 subagent`);
    if (this.setupAiModel === "simple") {
      this.logs.push(`AI 驱动: 使用本地AI（${this.localAiEngine.getMemorySummary()}）`);
    } else {
      void this.logAiLoopStatus();
    }
    this.game.setDecisionHandler("human", (request) => {
      return new Promise<InteractionDecision>((resolve) => {
        this.pendingInteraction = { request, resolve };
        this.mode = "response";
        this.refresh();
      });
    });
    if (this.setupAiModel !== "simple") {
      // AI 玩家自己处理交互响应（出杀/闪/无懈/桃等），仅纯概率响应走引擎自动决策
      for (const player of this.game.getSnapshot().players) {
        if (!player.isAI) {
          continue;
        }
        const aiId = player.id;
        this.game.setDecisionHandler(aiId, async (request) => {
          if (request.kind === "choose-suit") {
            return null;
          }
          return this.aiLoop.decideInteraction(this.game, aiId, request);
        });
      }
    }
    this.mode = "action";
    void this.resolveAiTurns();
    this.refresh();
  }

  private async logAiLoopStatus(): Promise<void> {
    const probe = await this.aiLoop.probe();
    const detail = probe.detail.replace(/\s+/g, " ").trim().slice(0, 72);
    if (probe.available) {
      this.logs.push(`AI 驱动: ${probe.driverLabel} 已连接成功（${detail}）`);
    } else {
      this.logs.push(`AI 驱动: 使用本地AI（${probe.driverLabel} 不可用：${detail}）`);
    }
    this.refresh();
  }

  private async playAndAppendLogs(
    playerId: string,
    action: GameAction,
    targetId?: string,
    delayMs?: number,
    selectedCardId?: string,
  ): Promise<void> {
    this.busy = true;
    try {
      const logs = await this.game.playAction(playerId, action, targetId, selectedCardId);
      const stepDelay = delayMs ?? (playerId === "human" ? 100 : 200);
      for (const line of logs) {
        this.logs.push(line);
        this.refresh();
        await this.delay(stepDelay);
      }
    } finally {
      this.busy = false;
    }
  }

    private async handleInteractionChoice(picked: number): Promise<void> {
    const pending = this.pendingInteraction;
    if (!pending) {
      this.mode = "action";
      this.refresh();
      return;
    }
    const { request, resolve } = pending;
    this.pendingInteraction = null;
    const decision = this.buildInteractionDecision(request, picked);
    this.mode = "action";
    this.refresh();
    await this.delay(50);
    resolve(decision);
    await this.resolveAiTurns();
  }

  private buildInteractionDecision(request: InteractionRequest, picked: number): InteractionDecision {
    if (request.kind === "respond") {
      const source = request.sources[picked];
      return source ? { choice: "card", sourceId: source.sourceId } : { choice: "pass" };
    }
    if (request.kind === "collateral") {
      const victimId = request.victims[picked];
      if (!victimId) {
        return { choice: "pass" };
      }
      const firstSlash = request.sources[0];
      return { choice: "target", targetId: victimId, ...(firstSlash ? { sourceId: firstSlash.sourceId } : {}) };
    }
    if (request.kind === "choose-discard") {
      const source = request.sources[picked];
      return source ? { choice: "card", sourceId: source.sourceId } : { choice: "pass" };
    }
    if (request.kind === "choose-suit") {
      const suit = request.suits[picked] ?? request.suits[0] ?? "heart";
      return { choice: "suit", suit };
    }
    if (request.kind === "optional-effect") {
      return { choice: "effect", enabled: picked === 0 };
    }
    return { choice: "pass" };
  }

  private shouldSelectTargetCard(action: TargetAction): boolean {
    if (action.type !== "play") {
      return false;
    }
    const cardType = extractCardTypeFromAction(action);
    return cardType === CardType.Dismantle || cardType === CardType.Snatch;
  }

  private isSnatchAction(action: TargetAction | null): boolean {
    if (!action || action.type !== "play") {
      return false;
    }
    return extractCardTypeFromAction(action) === CardType.Snatch;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolveDelay) => {
      setTimeout(resolveDelay, ms);
    });
  }

  private openDisplayOverlay(title: string, lines: string[]): void {
    this.displayOverlayTitle = title;
    this.displayOverlayLines = lines;
    this.displayPage = 0;
  }

  private closeDisplayOverlay(): void {
    this.displayOverlayTitle = null;
    this.displayOverlayLines = [];
    this.displayPage = 0;
  }

  private renderPagedArea(input: {
    title: string;
    lines: string[];
    page: number;
    pageSize: number;
    focused: boolean;
  }): { lines: string[]; page: number; totalPages: number } {
    const totalPages = Math.max(1, Math.ceil(input.lines.length / input.pageSize));
    const page = Math.min(Math.max(input.page, 0), totalPages - 1);
    const start = page * input.pageSize;
    const end = start + input.pageSize;
    const body = input.lines.slice(start, end);
    while (body.length < input.pageSize) {
      body.push("");
    }
    const output: string[] = [];
    const hint = input.focused ? " | ←→切区 ↑↓翻页" : "";
    output.push(`${input.title}（${page + 1}/${totalPages}）${hint}`);
    output.push(...body);
    return { lines: output, page, totalPages };
  }

  private getBodyPageSize(area: FocusArea): number {
    const rows = process.stdout.rows ?? 40;
    const reserved = area === "display" ? 7 : 6;
    const pageSize = rows - reserved;
    return Math.max(4, pageSize);
  }

  private getMaxPage(totalLines: number, pageSize: number): number {
    if (pageSize <= 0) {
      return 0;
    }
    const totalPages = Math.max(1, Math.ceil(totalLines / pageSize));
    return totalPages - 1;
  }

  private handleAreaPagingInput(event: KeyEvent): boolean {
    if (!event.name) {
      return false;
    }
    if (event.name === "left") {
      this.switchFocus(-1);
      this.refresh();
      return true;
    }
    if (event.name === "right") {
      this.switchFocus(1);
      this.refresh();
      return true;
    }
    if (event.name === "up") {
      this.changeFocusedPage(-1);
      this.refresh();
      return true;
    }
    if (event.name === "down") {
      this.changeFocusedPage(1);
      this.refresh();
      return true;
    }
    return false;
  }

  private switchFocus(step: -1 | 1): void {
    const order: FocusArea[] = ["display", "action", "status"];
    const index = order.indexOf(this.focusArea);
    const next = (index + step + order.length) % order.length;
    this.focusArea = order[next] ?? "display";
    this.updateFocusFrame();
  }

  private changeFocusedPage(step: -1 | 1): void {
    if (this.focusArea === "display") {
      const displayLines = buildDisplayLines(this.logs, {
        title: this.displayOverlayTitle,
        lines: this.displayOverlayLines,
      });
      const displayPageSize = this.getBodyPageSize("display");
      const maxPage = this.getMaxPage(displayLines.length, displayPageSize);
      const nextPage = Math.min(Math.max(this.displayPage + step, 0), maxPage);
      this.displayPage = nextPage;
      if (this.displayOverlayTitle === null) {
        this.displayFollowLatest = nextPage >= maxPage;
      }
      return;
    }
    if (this.focusArea === "action") {
      this.actionPage = Math.max(0, this.actionPage + step);
      return;
    }
    this.statusPage = Math.max(0, this.statusPage + step);
  }

  private updateFocusFrame(): void {
    if (!this.displayColumn || !this.actionColumn || !this.statusColumn) {
      return;
    }
    this.displayColumn.borderColor = this.focusArea === "display" ? "green" : "white";
    this.actionColumn.borderColor = this.focusArea === "action" ? "green" : "white";
    this.statusColumn.borderColor = this.focusArea === "status" ? "green" : "white";
  }

  private toCommandChar(event: KeyEvent): string | null {
    const value = event.sequence && event.sequence.length === 1 ? event.sequence : event.name;
    if (!value || value.length !== 1) {
      return null;
    }
    if (!/^[ -~]$/.test(value)) {
      return null;
    }
    return value;
  }
}
