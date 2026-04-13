import { BoxRenderable, KeyEvent, TextRenderable, createCliRenderer } from "@opentui/core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AiDriverLabel, AiModelProvider, GameAiLoop } from "../agent/ai.js";
import { LocalAiEngine } from "../agent/local-engine.js";
import { RoundPromptContext } from "../agent/prompt.js";
import { CardType } from "../engine/cards.js";
import {
  GameAction,
  GameInitOptions,
  Player,
  PlayerRole,
  RemovableCardOption,
  ResponseKind,
  ResponseOption,
  SanGuoGame,
} from "../engine/game.js";

type InputMode = "setup" | "action" | "target" | "target-card" | "response" | "discard" | "gameover";

type SetupStage = "player-count" | "role" | "kingdom" | "general" | "ai-model" | "ollama-model" | "start";

type SetupAiModel = "simple" | AiModelProvider;

type Kingdom = "魏" | "蜀" | "吴" | "群雄";

type FocusArea = "display" | "action" | "status";

type AppOptions = {
  initOptions: Partial<GameInitOptions>;
};

type TargetAction = Exclude<GameAction, { type: "end" }>;

type PendingAiResponse = {
  actorId: string;
  action: GameAction;
  targetId?: string;
  responseKind: ResponseKind;
  cardName: string;
  options: ResponseOption[];
  driverLabel: AiDriverLabel | "本地AI";
};

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

  private pendingAiResponse: PendingAiResponse | null;

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

  constructor(game: SanGuoGame, options: AppOptions) {
    this.game = game;
    this.options = options;
    this.logs = [];
    this.mode = "setup";
    this.actionOptions = [];
    this.targetOptions = [];
    this.pendingAction = null;
    this.pendingAiResponse = null;
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
      void this.handlePendingResponseChoice(pickedResponse);
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
      const logs = this.game.discardForCurrentPlayer(current.id, selected.handIndex);
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
    while (!this.game.getSnapshot().gameOver && this.game.getCurrentPlayer().isAI) {
      const turnStateLogs = this.game.ensureTurnState();
      if (turnStateLogs.length > 0) {
        for (const line of turnStateLogs) {
          this.logs.push(line);
          this.refresh();
          await this.delay(120);
        }
        continue;
      }
      const ai = this.game.getCurrentPlayer();
      const snapshot = this.game.getSnapshot();
      const previousRounds = this.getPreviousRoundPromptContexts(snapshot.turn);
      this.aiLoop.setPreviousRoundContexts(previousRounds);
      this.localAiEngine.syncPreviousRounds(previousRounds);
      const modelDecision = this.setupAiModel === "simple" ? null : await this.aiLoop.decide(this.game, ai.id);
      const localDecision = this.localAiEngine.decide(this.game, ai.id);
      const fallbackDecision = localDecision
        ? localDecision.targetId
          ? { action: localDecision.action, targetId: localDecision.targetId }
          : { action: localDecision.action }
        : this.game.getBestAiDecision(ai.id);
      const decision = modelDecision ?? fallbackDecision;
      const driverLabel: AiDriverLabel | "本地AI" = modelDecision?.driverLabel ?? "本地AI";
      const fallbackReason = !modelDecision && this.setupAiModel !== "simple" ? this.aiLoop.getLastFailureReason() : null;
      const normalizedDecision = this.normalizeAiDecision(ai.id, decision);
      if (!normalizedDecision) {
        const forcedEndAction = this.game.getPlayableActions(ai.id).find((action) => action.type === "end");
        if (!forcedEndAction) {
          break;
        }
        await this.playAndAppendLogs(ai.id, forcedEndAction, undefined, 120);
        continue;
      }
      if (!modelDecision && localDecision) {
        this.logs.push(`[本地AI-预判] ${ai.name}：${localDecision.insight}`);
      }
      const targetText = normalizedDecision.targetId ? ` -> ${this.labelPlayer(normalizedDecision.targetId)}` : "";
      const reasonText = fallbackReason ? `（回退原因：${fallbackReason}）` : "";
      const actionDelayMs = driverLabel === "本地AI" ? 1000 : 200;
      this.logs.push(`[${driverLabel}] ${ai.name} 选择：${normalizedDecision.action.label}${targetText}${reasonText}`);
      this.refresh();
      await this.delay(actionDelayMs);
      const response = this.buildPendingResponse(normalizedDecision, driverLabel);
      if (response) {
        if (response.targetId === "human" && response.options.length === 0) {
          this.game.setPlayerResponsePolicy("human", { [response.responseKind]: false });
          this.game.setPlayerResponseSelection("human", response.responseKind, null);
          this.logs.push(`你没有可用于响应 ${response.cardName} 的手牌，自动继续结算`);
          this.refresh();
          await this.delay(120);
          await this.playAndAppendLogs(ai.id, normalizedDecision.action, normalizedDecision.targetId, 200);
          this.game.setPlayerResponseSelection("human", response.responseKind, null);
          this.game.setPlayerResponsePolicy("human", null);
          continue;
        }
        this.pendingAiResponse = response;
        this.mode = "response";
        this.refresh();
        return;
      }
      await this.playAndAppendLogs(ai.id, normalizedDecision.action, normalizedDecision.targetId, 200);
    }
    this.mode = this.game.getSnapshot().gameOver ? "gameover" : "action";
    this.refresh();
  }

  private normalizeAiDecision(
    playerId: string,
    decision: { action: GameAction; targetId?: string } | null | undefined,
  ): { action: GameAction; targetId?: string } | null {
    if (!decision) {
      return null;
    }
    const actions = this.game.getPlayableActions(playerId);
    const matchedAction = actions.find((action) => this.isSameAction(action, decision.action));
    if (!matchedAction) {
      return null;
    }
    if (matchedAction.type === "end") {
      return { action: matchedAction };
    }
    if (matchedAction.type !== "play" && matchedAction.type !== "skill") {
      return { action: matchedAction };
    }
    if (!matchedAction.requiresTarget) {
      return { action: matchedAction };
    }
    const targetId =
      decision.targetId && matchedAction.targets.includes(decision.targetId)
        ? decision.targetId
        : (matchedAction.targets[0] ?? null);
    if (!targetId) {
      return null;
    }
    return { action: matchedAction, targetId };
  }

  private isSameAction(left: GameAction, right: GameAction): boolean {
    if (left.type !== right.type) {
      return false;
    }
    if (left.type === "end" && right.type === "end") {
      return true;
    }
    if (left.type === "skill" && right.type === "skill") {
      return left.skill === right.skill && left.label === right.label;
    }
    if (left.type === "play" && right.type === "play") {
      return left.cardIndex === right.cardIndex && left.label === right.label;
    }
    return false;
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
    const statusLines = this.buildStatusLines(snapshot);

    const actionLines: string[] = [];
    actionLines.push("输入:");
    if (this.commandBuffer !== null) {
      actionLines.push(`命令模式: ${this.commandBuffer}`);
      actionLines.push("回车执行，退格删除，Esc 取消");
      actionLines.push("可用命令:");
      actionLines.push(...this.getCommandListLines());
    } else if (this.mode === "action") {
      this.actionOptions.forEach((action, index) => {
        actionLines.push(`${index + 1}. ${action.label}`);
        const actionHint = this.getActionHint(action);
        if (actionHint.length > 0) {
          actionLines.push(`   功能：${actionHint}`);
        }
      });
      if (this.actionOptions.length === 0) {
        actionLines.push("等待 AI 执行...");
      }
    } else if (this.mode === "target") {
      actionLines.push(`当前操作: ${this.pendingAction ? this.pendingAction.label : "选择目标"}`);
      this.targetOptions.forEach((target, index) => {
        actionLines.push(
          `${index + 1}. 目标 ${target.name} | HP ${Math.max(target.hp, 0)}/${target.maxHp} | 手牌 ${target.hand.length} 张`,
        );
      });
      actionLines.push("按 b 返回上一步");
    } else if (this.mode === "target-card") {
      const targetName = this.pendingTargetId ? this.labelPlayer(this.pendingTargetId) : "目标";
      actionLines.push(`当前操作: ${this.pendingAction ? this.pendingAction.label : "选择牌"}`);
      actionLines.push(`目标: ${targetName}，请选择要${this.isSnatchAction(this.pendingAction) ? "获取" : "弃置"}的牌`);
      this.targetCardOptions.forEach((option, index) => {
        actionLines.push(`${index + 1}. ${option.label}`);
      });
      if (this.targetCardOptions.length === 0) {
        actionLines.push("目标没有可选牌，将按默认规则结算");
        actionLines.push("1. 继续结算");
      }
      actionLines.push("按 b 返回上一步");
    } else if (this.mode === "response") {
      const responseInfo = this.pendingAiResponse;
      actionLines.push("你受到牌效果影响，请选择应对：");
      if (responseInfo) {
        actionLines.push(
          `来牌: ${responseInfo.cardName}（来自 ${this.labelPlayer(responseInfo.actorId)}，决策来源 ${responseInfo.driverLabel}）`,
        );
        if (responseInfo.options.length > 0) {
          responseInfo.options.forEach((option, index) => {
            actionLines.push(`${index + 1}. ${option.label}`);
          });
          actionLines.push(`${responseInfo.options.length + 1}. 不应对`);
        } else {
          actionLines.push("你当前没有可用应对牌。");
          actionLines.push("1. 继续结算（不应对）");
        }
      }
    } else if (this.mode === "discard") {
      const current = snapshot.players.find((player) => player.id === snapshot.currentPlayerId);
      if (current && current.id === "human") {
        const needDiscard = Math.max(0, current.hand.length - current.hp);
        actionLines.push(
          `弃牌阶段：需弃置 ${needDiscard} 张（手牌 ${current.hand.length} / 体力 ${Math.max(current.hp, 0)}）`,
        );
        current.hand.forEach((card, index) => {
          actionLines.push(`${index + 1}. 弃置 ${card.type}`);
        });
      } else {
        actionLines.push("等待回合推进...");
      }
    } else {
      actionLines.push("按 r 重开，或输入 /exit 退出");
    }
    actionLines.push("输入 / 进入命令模式");

    const displayPageSize = this.getBodyPageSize("display");
    const actionPageSize = this.getBodyPageSize("action");
    const statusPageSize = this.getBodyPageSize("status");
    const displayLines: string[] = this.buildDisplayLines();
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

  private buildDisplayLines(): string[] {
    if (this.displayOverlayTitle !== null) {
      const lines: string[] = [];
      lines.push(`【${this.displayOverlayTitle}】`);
      lines.push("输入 /close 关闭当前文档");
      lines.push("");
      lines.push(...this.displayOverlayLines);
      return lines;
    }
    const lines: string[] = [];
    lines.push("输入“/”进入命令模式，建议先用 /help 查看帮助文档");
    lines.push("");
    lines.push("最近记录:");
    const latest = this.logs.slice(-100);
    for (const item of latest) {
      lines.push(`- ${item}`);
    }
    return lines;
  }

  private buildStatusLines(snapshot: ReturnType<SanGuoGame["getSnapshot"]>): string[] {
    const statusLines: string[] = [];
    statusLines.push(`回合: ${snapshot.turn}`);
    statusLines.push(`当前玩家: ${this.labelPlayer(snapshot.currentPlayerId)}`);
    statusLines.push(`阶段: ${snapshot.phase}`);
    statusLines.push(`牌堆: ${snapshot.deckCount}  弃牌堆: ${snapshot.discardCount}`);
    statusLines.push("");
    statusLines.push("玩家状态:");
    for (const player of snapshot.players) {
      const status = player.alive ? "存活" : "阵亡";
      const identity = !player.alive ? player.role : player.role === PlayerRole.Lord ? PlayerRole.Lord : "未知";
      const hand = player.isAI ? `${player.hand.length} 张` : this.describeHand(player.hand);
      const skills = player.skills.length > 0 ? player.skills.join("、") : "无";
      const weapon = player.weapon ?? "无";
      const armor = player.armor ?? "无";
      const attackHorse = player.attackHorse ?? "无";
      const defenseHorse = player.defenseHorse ?? "无";
      const treasure = player.treasure ?? "无";
      statusLines.push(
        `- ${player.name}[${player.general}] | 身份 ${identity} | HP ${Math.max(player.hp, 0)}/${player.maxHp} | 手牌 ${hand} | 装备 武器:${weapon} 防具:${armor} +1马:${defenseHorse} -1马:${attackHorse} 宝物:${treasure} | 技能 ${skills} | ${status}`,
      );
    }
    if (snapshot.gameOver) {
      statusLines.push("");
      if (snapshot.winner === "human") {
        statusLines.push("结果: 主公获胜");
      } else if (snapshot.winner === "ai") {
        statusLines.push("结果: 反贼获胜");
      } else {
        statusLines.push("结果: 平局");
      }
    }
    return statusLines;
  }

  private toPromptBattlefieldLine(player: Player): string {
    const equipments = `${player.weapon ?? "无"}/${player.armor ?? "无"}/${player.attackHorse ?? "无"}/${player.defenseHorse ?? "无"}/${player.treasure ?? "无"}`;
    return `${player.name}(${player.id})|身份:${player.role}|武将:${player.general}|体力:${Math.max(player.hp, 0)}/${player.maxHp}|手牌:${player.hand.length}|装备:${equipments}|状态:${player.alive ? "存活" : "阵亡"}`;
  }

  private syncCurrentRoundBattlefield(snapshot: ReturnType<SanGuoGame["getSnapshot"]>): void {
    const lines = snapshot.players.map((player) => this.toPromptBattlefieldLine(player));
    this.roundBattlefieldHistory.set(snapshot.turn, lines);
    if (this.roundBattlefieldHistory.size <= 20) {
      return;
    }
    const rounds = Array.from(this.roundBattlefieldHistory.keys()).sort((a, b) => a - b);
    const toDelete = rounds.slice(0, rounds.length - 20);
    for (const round of toDelete) {
      this.roundBattlefieldHistory.delete(round);
    }
  }

  private getPreviousRoundPromptContexts(currentRound: number): RoundPromptContext[] {
    const roundLogs = new Map<number, string[]>();
    let activeRound: number | null = null;
    for (const line of this.logs) {
      const matched = line.match(/^第\s*(\d+)\s*(?:回合|轮)[:：]/);
      if (matched?.[1]) {
        activeRound = Number.parseInt(matched[1], 10);
      }
      if (activeRound === null || Number.isNaN(activeRound)) {
        continue;
      }
      if (!roundLogs.has(activeRound)) {
        roundLogs.set(activeRound, []);
      }
      roundLogs.get(activeRound)?.push(line);
    }
    const rounds = Array.from(roundLogs.keys())
      .filter((round) => round < currentRound)
      .sort((a, b) => a - b)
      .slice(-3);
    return rounds.map((round) => ({
      round,
      displayLines: roundLogs.get(round) ?? [],
      battlefieldLines: this.roundBattlefieldHistory.get(round) ?? [],
    }));
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

  private describeHand(cards: Player["hand"]): string {
    if (cards.length === 0) {
      return "0 张";
    }
    return cards.map((card, index) => `${index + 1}:${card.type}`).join(" ");
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
    const displaySource = this.displayOverlayTitle ? this.buildDisplayLines() : leftLines;
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
      this.startConfiguredGame();
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

  private startConfiguredGame(): void {
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
    this.pendingAiResponse = null;
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
    this.logs.push(
      ...this.game.initDefaultGame({
        ...this.options.initOptions,
        playerCount: this.setupPlayerCount,
        aiCount: this.setupPlayerCount - 1,
        humanRole: this.setupRole,
        humanGeneral: this.setupGeneralName,
      }),
    );
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
      const logs = this.game.playAction(playerId, action, targetId, selectedCardId);
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

  private async handlePendingResponseChoice(picked: number): Promise<void> {
    const pending = this.pendingAiResponse;
    if (!pending) {
      this.mode = "action";
      this.refresh();
      return;
    }
    const optionCount = pending.options.length;
    if ((optionCount > 0 && picked > optionCount) || (optionCount === 0 && picked > 0)) {
      return;
    }
    const chooseNoResponse = optionCount > 0 ? picked === optionCount : picked === 0;
    if (chooseNoResponse) {
      this.game.setPlayerResponsePolicy("human", { [pending.responseKind]: false });
      this.game.setPlayerResponseSelection("human", pending.responseKind, null);
      this.logs.push(`你选择不响应 ${pending.cardName}`);
      this.refresh();
      await this.delay(100);
    } else {
      const selected = pending.options[picked];
      if (!selected) {
        return;
      }
      this.game.setPlayerResponsePolicy("human", { [pending.responseKind]: true });
      this.game.setPlayerResponseSelection("human", pending.responseKind, selected.id);
      this.logs.push(`你选择：${selected.label}`);
      this.refresh();
      await this.delay(100);
    }
    this.pendingAiResponse = null;
    this.mode = "action";
    await this.playAndAppendLogs(pending.actorId, pending.action, pending.targetId, 200);
    this.game.setPlayerResponseSelection("human", pending.responseKind, null);
    this.game.setPlayerResponsePolicy("human", null);
    await this.resolveAiTurns();
  }

  private buildPendingResponse(
    decision: { action: GameAction; targetId?: string },
    driverLabel: AiDriverLabel | "本地AI",
  ): PendingAiResponse | null {
    if (decision.action.type !== "play") {
      return null;
    }
    const actorId = this.game.getCurrentPlayer().id;
    const cardByIndex =
      decision.action.cardIndex >= 0
        ? this.game
            .getSnapshot()
            .players.find((player) => player.id === actorId)
            ?.hand[decision.action.cardIndex]?.type
        : null;
    const cardName = cardByIndex ?? this.extractCardTypeFromAction(decision.action);
    if (!cardName) {
      return null;
    }
    const humanAlive = this.game.getSnapshot().players.some((player) => player.id === "human" && player.alive);
    if (!humanAlive) {
      return null;
    }
    const humanDirectTarget = decision.targetId === "human";
    if (cardName === CardType.Slash) {
      if (!humanDirectTarget) {
        return null;
      }
      const options = this.game.getPlayerResponseOptions("human", "dodge");
      const targetId = decision.targetId;
      if (!targetId) {
        return null;
      }
      return {
        actorId: this.game.getCurrentPlayer().id,
        action: decision.action,
        targetId,
        responseKind: "dodge",
        cardName,
        options,
        driverLabel,
      };
    }
    if (cardName === CardType.Duel) {
      if (!humanDirectTarget) {
        return null;
      }
      const options = this.game.getPlayerResponseOptions("human", "slash");
      const targetId = decision.targetId;
      if (!targetId) {
        return null;
      }
      return {
        actorId,
        action: decision.action,
        targetId,
        responseKind: "slash",
        cardName,
        options,
        driverLabel,
      };
    }
    if (cardName === CardType.Dismantle || cardName === CardType.Snatch || cardName === CardType.Collateral) {
      if (!humanDirectTarget) {
        return null;
      }
      const options = this.game.getPlayerResponseOptions("human", "negate");
      const targetId = decision.targetId;
      if (!targetId) {
        return null;
      }
      return {
        actorId,
        action: decision.action,
        targetId,
        responseKind: "negate",
        cardName,
        options,
        driverLabel,
      };
    }
    if (cardName === CardType.Barbarian) {
      const options = this.game.getPlayerResponseOptions("human", "slash");
      return {
        actorId,
        action: decision.action,
        responseKind: "slash",
        cardName,
        options,
        driverLabel,
      };
    }
    if (cardName === CardType.ArrowRain) {
      const options = this.game.getPlayerResponseOptions("human", "dodge");
      return {
        actorId,
        action: decision.action,
        responseKind: "dodge",
        cardName,
        options,
        driverLabel,
      };
    }
    return null;
  }

  private extractCardTypeFromAction(action: Extract<GameAction, { type: "play" }>): CardType | null {
    const label = action.label;
    const allCardTypes = Object.values(CardType);
    const picked = allCardTypes.find((cardType) => label.includes(cardType));
    return picked ?? null;
  }

  private shouldSelectTargetCard(action: TargetAction): boolean {
    if (action.type !== "play") {
      return false;
    }
    const cardType = this.extractCardTypeFromAction(action);
    return cardType === CardType.Dismantle || cardType === CardType.Snatch;
  }

  private isSnatchAction(action: TargetAction | null): boolean {
    if (!action || action.type !== "play") {
      return false;
    }
    return this.extractCardTypeFromAction(action) === CardType.Snatch;
  }

  private getActionHint(action: GameAction): string {
    if (action.type === "end") {
      return "结束当前出牌阶段并进入弃牌/结算流程";
    }
    if (action.type === "skill") {
      if (action.label.includes("强袭")) {
        return "弃1张牌并对1名目标造成1点伤害（每回合限一次）";
      }
      if (action.label.includes("制衡")) {
        return "弃任意张牌并摸等量牌（每回合限一次）";
      }
      if (action.label.includes("青囊")) {
        return "弃1张手牌令1名角色回复1点体力（每回合限一次）";
      }
      if (action.label.includes("苦肉")) {
        return "失去1点体力并摸2张牌";
      }
      return "发动武将技能获得额外收益";
    }
    if (action.label.includes("木牛流马下的")) {
      return "从木牛流马中打出寄存牌，并按该牌原效果结算";
    }
    const cardType = this.extractCardTypeFromAction(action);
    if (!cardType) {
      return action.requiresTarget ? "使用此牌并选择目标" : "使用此牌立即生效";
    }
    if (cardType === CardType.Slash) {
      return "对1名角色造成1点伤害（可被闪抵消）";
    }
    if (cardType === CardType.Peach) {
      return "回复1点体力";
    }
    if (cardType === CardType.Duel) {
      return "与你指定目标轮流打出杀，先断者受1点伤害";
    }
    if (cardType === CardType.Dismantle) {
      return "弃置目标区域内1张牌";
    }
    if (cardType === CardType.Snatch) {
      return "获得目标区域内1张牌";
    }
    if (cardType === CardType.ExNihilo) {
      return "摸2张牌";
    }
    if (cardType === CardType.PeachGarden) {
      return "所有存活角色各回复1点体力";
    }
    if (cardType === CardType.Harvest) {
      return "所有存活角色各摸1张牌";
    }
    if (cardType === CardType.Barbarian) {
      return "其他角色需打出杀，否则受到1点伤害";
    }
    if (cardType === CardType.ArrowRain) {
      return "其他角色需打出闪，否则受到1点伤害";
    }
    if (cardType === CardType.Collateral) {
      return "指定装备武器角色对其攻击范围内目标出杀，否则其武器被弃置";
    }
    if (cardType === CardType.Negate) {
      return "抵消一张锦囊牌对单个目标的生效";
    }
    if (cardType === CardType.Crossbow) {
      return "武器：攻击范围2，出牌阶段可无限次使用杀";
    }
    if (cardType === CardType.FemaleSword) {
      return "武器：攻击范围2；异性目标响应杀后，随机弃其1手牌或你摸1张";
    }
    if (cardType === CardType.QinggangSword) {
      return "武器：攻击范围2；你使用的杀无视目标防具";
    }
    if (cardType === CardType.IceSword) {
      return "武器：攻击范围2；杀将造成伤害时可改为弃目标2张牌";
    }
    if (cardType === CardType.GudingBlade) {
      return "武器：攻击范围2；目标无手牌时，你的杀伤害+1";
    }
    if (cardType === CardType.SerpentSpear) {
      return "武器：攻击范围3；可弃2张手牌当1张杀使用";
    }
    if (cardType === CardType.GreenDragonBlade) {
      return "武器：攻击范围3；杀被闪后可追加再出1张杀";
    }
    if (cardType === CardType.RockCleavingAxe) {
      return "武器：攻击范围3；杀被闪后可弃2张牌令此杀仍命中";
    }
    if (cardType === CardType.Halberd) {
      return "武器：攻击范围4；最后一张手牌为杀时可额外指定至多2个目标";
    }
    if (cardType === CardType.KylinBow) {
      return "武器：攻击范围5；杀造成伤害后可弃置目标坐骑";
    }
    if (cardType === CardType.EightDiagram) {
      return "防具：受杀时有概率视为自动打出闪";
    }
    if (cardType === CardType.RenwangShield) {
      return "防具：黑色杀对你无效";
    }
    if (cardType === CardType.VineArmor) {
      return "防具：普通杀、南蛮入侵、万箭齐发对你无效";
    }
    if (cardType === CardType.SilverLion) {
      return "防具：受到超过1点伤害时改为1点；失去此防具时回复1点体力";
    }
    if (cardType === CardType.Dilu || cardType === CardType.JueYing || cardType === CardType.ZhuaHuangFeiDian) {
      return "防御马：其他角色计算到你的距离+1，更不容易被指定为目标";
    }
    if (cardType === CardType.ChiTu || cardType === CardType.DaYuan || cardType === CardType.ZiXing) {
      return "进攻马：你计算到其他角色的距离-1，更容易命中远处目标";
    }
    if (cardType === CardType.WoodenOx) {
      return "宝物：可寄存手牌并转移给其他角色，也可直接使用寄存牌";
    }
    return action.requiresTarget ? "使用装备或锦囊并选择目标" : "使用装备牌并立即生效";
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
      const displayLines = this.buildDisplayLines();
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
