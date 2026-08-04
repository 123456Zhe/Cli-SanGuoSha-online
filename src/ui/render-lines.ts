import { GameAction, GameSnapshot, InteractionRequest, Player, PlayerRole, RemovableCardOption } from "../engine/game.js";
import { computeDistanceBetween, getAttackRange } from "../engine/resolve.js";

type TargetAction = Exclude<GameAction, { type: "end" }>;

export type PendingInteractionView = { request: InteractionRequest };

export type ActionAreaState = {
  commandBuffer: string | null;
  mode: string;
  actionOptions: GameAction[];
  pendingAction: TargetAction | null;
  targetOptions: Player[];
  targetCardOptions: RemovableCardOption[];
  pendingInteraction: PendingInteractionView | null;
  pendingTargetId: string | null;
  snapshot: GameSnapshot;
  labelPlayer: (playerId: string) => string;
  isSnatch: (action: TargetAction | null) => boolean;
  getCommandListLines: () => string[];
  getActionHint: (action: GameAction) => string;
};

export function describeHand(cards: Player["hand"]): string {
  if (cards.length === 0) {
    return "0 张";
  }
  return cards.map((card, index) => `${index + 1}:${card.type}`).join(" ");
}

export function buildDisplayLines(logs: string[], overlay: { title: string | null; lines: string[] }): string[] {
  if (overlay.title !== null) {
    const lines: string[] = [];
    lines.push(`【${overlay.title}】`);
    lines.push("输入 /close 关闭当前文档");
    lines.push("");
    lines.push(...overlay.lines);
    return lines;
  }
  const lines: string[] = [];
  lines.push("输入“/”进入命令模式，建议先用 /help 查看帮助文档");
  lines.push("");
  lines.push("最近记录:");
  const latest = logs.slice(-100);
  for (const item of latest) {
    lines.push(`- ${item}`);
  }
  return lines;
}

export function buildStatusLines(
  snapshot: GameSnapshot,
  labelPlayer: (playerId: string) => string,
  localPlayerId: string,
): string[] {
  const statusLines: string[] = [];
  statusLines.push(`回合: ${snapshot.turn}`);
  statusLines.push(`当前玩家: ${labelPlayer(snapshot.currentPlayerId)}`);
  statusLines.push(`阶段: ${snapshot.phase}`);
  statusLines.push(`牌堆: ${snapshot.deckCount}  弃牌堆: ${snapshot.discardCount}`);
  statusLines.push("");
  statusLines.push("玩家状态:");
  for (const player of snapshot.players) {
    const status = player.alive ? "存活" : "阵亡";
    const identity = !player.alive ? player.role : player.role === PlayerRole.Lord ? PlayerRole.Lord : "未知";
    const hand = player.isAI ? `${player.hand.length} 张` : describeHand(player.hand);
    const skills = player.skills.length > 0 ? player.skills.join("、") : "无";
    const weapon = player.weapon ?? "无";
    const armor = player.armor ?? "无";
    const attackHorse = player.attackHorse ?? "无";
    const defenseHorse = player.defenseHorse ?? "无";
    const treasure = player.treasure ?? "无";
    let reachInfo = "";
    if (player.id === localPlayerId) {
      reachInfo = ` | 攻击范围 ${getAttackRange(player)}`;
    } else if (player.alive) {
      const local = snapshot.players.find((item) => item.id === localPlayerId);
      if (local) {
        reachInfo = ` | 距离 ${computeDistanceBetween(snapshot.players, local, player)}`;
      }
    }
    statusLines.push(
      `- ${player.name}[${player.general}] | 身份 ${identity} | HP ${Math.max(player.hp, 0)}/${player.maxHp} | 手牌 ${hand} | 装备 武器:${weapon} 防具:${armor} +1马:${defenseHorse} -1马:${attackHorse} 宝物:${treasure} | 技能 ${skills}${reachInfo} | ${status}`,
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

export function buildActionLines(state: ActionAreaState): string[] {
  const actionLines: string[] = [];
  actionLines.push("输入:");
  if (state.commandBuffer !== null) {
    actionLines.push(`命令模式: ${state.commandBuffer}`);
    actionLines.push("回车执行，退格删除，Esc 取消");
    actionLines.push("可用命令:");
    actionLines.push(...state.getCommandListLines());
  } else if (state.mode === "action") {
    state.actionOptions.forEach((action, index) => {
      actionLines.push(`${index + 1}. ${action.label}`);
      const actionHint = state.getActionHint(action);
      if (actionHint.length > 0) {
        actionLines.push(`   功能：${actionHint}`);
      }
    });
    if (state.actionOptions.length === 0) {
      actionLines.push("等待 AI 执行...");
    }
  } else if (state.mode === "target") {
    const current = state.snapshot.players.find((player) => player.id === state.snapshot.currentPlayerId);
    actionLines.push(`当前操作: ${state.pendingAction ? state.pendingAction.label : "选择目标"}`);
    state.targetOptions.forEach((target, index) => {
      const distance =
        current && current.alive && target.alive
          ? computeDistanceBetween(state.snapshot.players, current, target)
          : null;
      actionLines.push(
        `${index + 1}. 目标 ${target.name} | HP ${Math.max(target.hp, 0)}/${target.maxHp} | 手牌 ${target.hand.length} 张${distance !== null ? ` | 距离 ${distance}` : ""}`,
      );
    });
    actionLines.push("按 b 返回上一步");
  } else if (state.mode === "target-card") {
    const targetName = state.pendingTargetId ? state.labelPlayer(state.pendingTargetId) : "目标";
    actionLines.push(`当前操作: ${state.pendingAction ? state.pendingAction.label : "选择牌"}`);
    actionLines.push(`目标: ${targetName}，请选择要${state.isSnatch(state.pendingAction) ? "获取" : "弃置"}的牌`);
    state.targetCardOptions.forEach((option, index) => {
      actionLines.push(`${index + 1}. ${option.label}`);
    });
    if (state.targetCardOptions.length === 0) {
      actionLines.push("目标没有可选牌，将按默认规则结算");
      actionLines.push("1. 继续结算");
    }
    actionLines.push("按 b 返回上一步");
  } else if (state.mode === "response") {
    const pending = state.pendingInteraction;
    if (pending) {
      const req = pending.request;
      actionLines.push("交互请求：" + req.reason);
      if (req.kind === "respond" || req.kind === "choose-discard") {
        req.sources.forEach((s, i) => actionLines.push(`${i + 1}. ${s.label}`));
        if (req.kind === "respond" || (req.kind === "choose-discard" && req.allowPass)) {
          actionLines.push(`${req.sources.length + 1}. 放弃`);
        }
      } else if (req.kind === "collateral") {
        req.victims.forEach((v, i) => actionLines.push(`${i + 1}. 对 ${state.labelPlayer(v)} 使用杀`));
        actionLines.push(`${req.victims.length + 1}. 放弃`);
      } else if (req.kind === "choose-suit") {
        const suitLabels: Record<string, string> = { heart: "红桃", diamond: "方片", club: "梅花", spade: "黑桃" };
        req.suits.forEach((s, i) => actionLines.push(`${i + 1}. 声明${suitLabels[s] ?? s}`));
      } else if (req.kind === "optional-effect") {
        actionLines.push("1. 发动");
        actionLines.push("2. 不发动");
      }
    }
  } else if (state.mode === "discard") {
    const current = state.snapshot.players.find((player) => player.id === state.snapshot.currentPlayerId);
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
  return actionLines;
}
