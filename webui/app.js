// 三国杀 WebUI 客户端：通过 WebSocket 中继复用联机 TCP 协议（NETWORK_PROTOCOL_VERSION = 4）。
(() => {
  "use strict";

  const PROTOCOL_VERSION = 4;
  const STORAGE_ID = "sgsPlayerId";
  const STORAGE_NAME = "sgsPlayerName";
  const STORAGE_MACHINE = "sgsMachineId";
  const MAX_RECONNECT_ATTEMPTS = 10;

  // 宿主嵌入模式（如 PolyChat 插件）：由宿主注入 WS 路径与账号名获取端点，否则维持原生直连 /ws。
  const HOSTED = Boolean(window.__SG_WS_PATH__);
  const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${window.__SG_WS_PATH__ || "/ws"}`;

  // 机器标识：浏览器持久化，同一浏览器/同台机器的多个标签页共享，供服务器做“同机单账号”校验
  let machineId = localStorage.getItem(STORAGE_MACHINE);
  if (!machineId) {
    machineId = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(STORAGE_MACHINE, machineId);
  }

  // 宿主模式：自动从宿主的会话端点取账号名，省去手动填名
  let hostedName = null;
  let autoJoining = false;
  const autoJoinWithHostedName = () => {
    if (autoJoining || !HOSTED) return;
    autoJoining = true;
    fetch("/api/sanguosha/me", { headers: { accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        hostedName = (data && data.username) || null;
        if (hostedName) {
          playerName = hostedName;
          localStorage.setItem(STORAGE_NAME, hostedName);
          playerId = null;
          localStorage.removeItem(STORAGE_ID);
          if (ws && ws.readyState === WebSocket.OPEN) {
            send({ type: "join", name: hostedName, version: PROTOCOL_VERSION });
          } else {
            connect();
          }
        } else {
          showJoinOverlay();
        }
      })
      .catch(() => showJoinOverlay());
  };

  let ws = null;
  let playerId = localStorage.getItem(STORAGE_ID);
  let playerName = localStorage.getItem(STORAGE_NAME) || "";
  let reconnectAttempts = 0;
  let left = false;
  let asking = false; // 操作区有表单在等待用户选择，期间不因临时状态刷新而覆盖
  let lastPlayers = [];
  let lastSnapshot = null;
  const msgQueue = [];
  let processingMsg = false;

  const $ = (id) => document.getElementById(id);

  const setStatus = (text, cls) => {
    const el = $("status");
    el.textContent = text;
    el.className = "status" + (cls ? " " + cls : "");
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const playerNameOf = (id) => lastPlayers.find((p) => p.id === id)?.name ?? id;

  const send = (message) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  };

  const sendDecision = (decision) => send({ type: "interaction", decision });

  // ---- 连接与重连 ----

  const connect = () => {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      setStatus("已连接", "ok");
      reconnectAttempts = 0;
      send({ type: "source", machineId });
      if (playerId) {
        send({ type: "reconnect", playerId, version: PROTOCOL_VERSION });
      } else if (playerName) {
        send({ type: "join", name: playerName, version: PROTOCOL_VERSION });
      } else if (HOSTED) {
        autoJoinWithHostedName();
      } else {
        showJoinOverlay();
      }
    };
    ws.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      enqueue(message);
    };
    ws.onclose = () => handleSocketClosed();
  };

  const handleSocketClosed = () => {
    if (left) {
      setStatus("已离开", "warn");
      return;
    }
    if (!playerId) {
      setStatus("连接断开", "warn");
      showJoinOverlay();
      return;
    }
    reconnectAttempts += 1;
    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      setStatus("重连失败", "err");
      return;
    }
    const delay = Math.min(500 * Math.pow(2, reconnectAttempts - 1), 15000);
    setStatus(`连接断开，${delay / 1000}s 后重连（${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}）`, "warn");
    setTimeout(connect, delay);
  };

  const showJoinOverlay = () => {
    $("join-overlay").hidden = false;
    $("name-input").focus();
  };

  const hideJoinOverlay = () => {
    $("join-overlay").hidden = true;
  };

  $("join-btn").addEventListener("click", () => {
    const name = $("name-input").value.trim().slice(0, 20);
    if (!name) {
      $("name-input").focus();
      return;
    }
    playerName = name;
    localStorage.setItem(STORAGE_NAME, name);
    playerId = null;
    localStorage.removeItem(STORAGE_ID);
    hideJoinOverlay();
    setStatus("加入中…", "");
    if (ws && ws.readyState === WebSocket.OPEN) {
      send({ type: "join", name, version: PROTOCOL_VERSION });
    } else {
      connect();
    }
  });

  // ---- 顺序消息队列（避免并发处理相互覆盖界面） ----

  const enqueue = (message) => {
    msgQueue.push(message);
    if (!processingMsg) {
      processNext();
    }
  };

  const processNext = async () => {
    if (processingMsg || msgQueue.length === 0) return;
    processingMsg = true;
    try {
      const message = msgQueue.shift();
      if (message) {
        await handle(message);
      }
    } finally {
      processingMsg = false;
      processNext();
    }
  };

  // ---- 消息处理 ----

  const handle = async (message) => {
    switch (message.type) {
      case "welcome":
      case "reconnect_ok":
        playerId = message.playerId;
        localStorage.setItem(STORAGE_ID, playerId);
        if (playerName) localStorage.setItem(STORAGE_NAME, playerName);
        reconnectAttempts = 0;
        setStatus(message.type === "welcome" ? "已加入" : "已重连，控制权已交还", "ok");
        hideJoinOverlay();
        break;
      case "lobby":
        $("game").hidden = true;
        $("lobby").hidden = false;
        const list = $("lobby-list");
        list.innerHTML = "";
        for (const p of message.players) {
          list.appendChild(el("li", "", `${p.name}${p.name.includes("[AI]") ? "（AI）" : ""}`));
        }
        list.appendChild(el("li", "muted", `等待玩家（${message.players.length}/${message.roomSize}）`));
        break;
      case "error":
        appendLog(`错误：${message.message}`);
        if (message.message.includes("没有找到可重连的玩家")) {
          playerId = null;
          localStorage.removeItem(STORAGE_ID);
          showJoinOverlay();
        }
        break;
      case "closed":
        left = true;
        setStatus("连接已关闭", "err");
        appendLog(message.message);
        // 可能是“同机已有人在玩”/“已在其他设备登录”被拒：弹回加入界面，关闭另一个客户端后可重新加入
        showJoinOverlay();
        break;
      case "player_disconnected":
        appendLog(`${message.playerName} 断线了，AI 已托管其座位，可随时重连取回控制权`);
        break;
      case "player_reconnected":
        appendLog(`${message.playerName} 已重连`);
        break;
      case "interaction":
        showInteraction(message.request);
        break;
      case "state":
        renderState(message);
        break;
      case "game_over":
        $("gameover-title").textContent = message.message;
        $("gameover-overlay").hidden = false;
        break;
      case "game_restarting":
        // 宿主（如聊天插件）在真人确认后续局：收起结算层，等待新一局 state
        $("gameover-overlay").hidden = true;
        break;
      default:
        break;
    }
  };

  const appendLog = (line) => {
    const logs = $("logs");
    logs.appendChild(el("div", "log-line", `- ${line}`));
    logs.scrollTop = logs.scrollHeight;
  };

  // ---- 状态渲染 ----

  const renderState = (message) => {
    const snapshot = message.snapshot;
    lastSnapshot = snapshot;
    lastPlayers = snapshot.players.map((p) => ({ id: p.id, name: p.name }));
    $("game").hidden = false;
    $("lobby").hidden = true;

    const turnInfo = $("turn-info");
    turnInfo.textContent = snapshot.gameOver ? "" : `第 ${snapshot.turn} 回合 · ${snapshot.phase}`;
    $("deck-info").textContent = snapshot.gameOver ? "" : `牌堆 ${snapshot.deckCount} · 弃牌堆 ${snapshot.discardCount}`;

    renderLogs(message.logs);
    renderBattlefield(snapshot);
    renderMyHand(snapshot);

    if (snapshot.gameOver) {
      clearActions();
      return;
    }
    if (asking) {
      return; // 表单已就绪，临时状态不覆盖
    }
    if (message.pendingDiscardCount > 0) {
      showDiscard(message);
      return;
    }
    if (message.actions.length > 0) {
      showActions(message);
      return;
    }
    showIdle("等待其他玩家行动…");
  };

  const renderLogs = (lines) => {
    const logs = $("logs");
    if (!lines || lines.length === 0) return;
    logs.innerHTML = "";
    for (const line of lines) {
      logs.appendChild(el("div", "log-line", `- ${line}`));
    }
    logs.scrollTop = logs.scrollHeight;
  };

  const renderBattlefield = (snapshot) => {
    const field = $("battlefield");
    field.innerHTML = "";
    for (const player of snapshot.players) {
      const card = el("div", "player-card");
      card.dataset.id = player.id;
      if (player.id === snapshot.currentPlayerId) card.classList.add("current");
      if (player.id === playerId) card.classList.add("me");
      if (!player.alive) card.classList.add("dead");
      if (player.isAI) card.classList.add("ai");

      const head = el("div", "pc-head");
      head.appendChild(el("span", "pc-name", player.name));
      if (!player.alive) head.appendChild(el("span", "tag dead-tag", "阵亡"));
      if (player.isAI) head.appendChild(el("span", "tag", "AI"));
      if (player.id === playerId) head.appendChild(el("span", "tag me-tag", "我"));
      card.appendChild(head);

      const info = el("div", "pc-info");
      info.appendChild(el("span", "", `${player.general} · ${player.kingdom}${player.gender}`));
      info.appendChild(el("span", "muted", `身份:${player.role}`));
      card.appendChild(info);

      const hpBar = el("div", "hp-bar");
      const hpPct = player.maxHp > 0 ? Math.round((Math.max(0, player.hp) / player.maxHp) * 100) : 0;
      hpBar.appendChild(el("div", "hp-fill", `${Math.max(0, player.hp)}/${player.maxHp}`));
      hpBar.lastChild.style.width = `${hpPct}%`;
      card.appendChild(hpBar);

      const equipment = [
        ["武", player.weapon],
        ["防", player.armor],
        ["攻马", player.attackHorse],
        ["防马", player.defenseHorse],
        ["宝", player.treasure],
      ].filter(([, name]) => name);
      const equipLine = el("div", "pc-equip");
      for (const [label, name] of equipment) {
        equipLine.appendChild(el("span", "equip-item", `${label}:${name}`));
      }
      if (equipment.length === 0) equipLine.appendChild(el("span", "muted", "无装备"));
      card.appendChild(equipLine);

      const extra = [];
      if (player.faceDown) extra.push("翻面");
      if (player.id !== playerId) extra.push(`手牌 ${player.handCount} 张`);
      if (player.treasureCardCount > 0) extra.push(`宝物区 ${player.treasureCardCount} 张`);
      if (extra.length > 0) card.appendChild(el("div", "pc-extra", extra.join(" · ")));

      field.appendChild(card);
    }
  };

  const renderMyHand = (snapshot) => {
    const me = snapshot.players.find((p) => p.id === playerId);
    const hand = $("myhand");
    hand.innerHTML = "";
    if (!me || !me.alive) return;
    const title = el("div", "hand-title", `我的手牌（${me.hand ? me.hand.length : 0}）`);
    hand.appendChild(title);
    const row = el("div", "hand-row");
    if (me.hand) {
      for (const card of me.hand) {
        const chip = el("div", `card-chip ${card.color === "red" ? "red" : card.color === "black" ? "black" : "none"}`, card.type);
        chip.title = `${card.suit} ${card.rank}`;
        row.appendChild(chip);
      }
    }
    if (me.treasureCards && me.treasureCards.length > 0) {
      row.appendChild(el("div", "hand-title-inline", "木牛流马："));
      for (const card of me.treasureCards) {
        row.appendChild(el("div", "card-chip treasure", card.type));
      }
    }
    if (row.childNodes.length === 0) row.appendChild(el("span", "muted", "空"));
    hand.appendChild(row);
  };

  // ---- 操作区 ----

  const clearActions = () => {
    $("actions").innerHTML = "";
  };

  const showIdle = (text) => {
    clearActions();
    $("actions").appendChild(el("div", "idle", text));
  };

  const addButton = (area, label, onClick, primary) => {
    const btn = el("button", "act-btn" + (primary ? " primary" : ""), label);
    btn.addEventListener("click", onClick);
    area.appendChild(btn);
  };

  const showDiscard = (message) => {
    asking = true;
    const area = $("actions");
    area.innerHTML = "";
    const me = message.snapshot.players.find((p) => p.id === playerId);
    const usable = [
      ...(me?.hand ?? []).map((card) => card.type),
      ...(me?.treasureCards ?? []).map((card) => `${card.type}（木牛流马）`),
    ];
    area.appendChild(el("div", "prompt", `弃牌阶段：还需弃置 ${message.pendingDiscardCount} 张`));
    usable.forEach((label, index) => {
      addButton(area, label, () => {
        asking = false;
        send({ type: "discard", handIndex: index });
      });
    });
  };

  const showActions = (message) => {
    asking = true;
    const area = $("actions");
    area.innerHTML = "";
    area.appendChild(el("div", "prompt", "你的回合，选择动作："));
    message.actions.forEach((action, index) => {
      addButton(area, action.label, () => {
        if (action.type === "end" || !action.requiresTarget) {
          asking = false;
          send({ type: "action", actionIndex: index });
          return;
        }
        showTargetPicker(message, index, action);
      });
    });
  };

  const showTargetPicker = (message, actionIndex, action) => {
    const area = $("actions");
    area.innerHTML = "";
    area.appendChild(el("div", "prompt", `${action.label}，选择目标：`));
    for (const targetId of action.targets) {
      addButton(area, playerNameOf(targetId), () => {
        const cardOptions = message.removableCards && message.removableCards[targetId];
        if (cardOptions && cardOptions.length > 0) {
          showTargetCardPicker(message, actionIndex, targetId, cardOptions);
        } else {
          asking = false;
          send({ type: "action", actionIndex, targetId });
        }
      });
    }
  };

  const showTargetCardPicker = (message, actionIndex, targetId, cardOptions) => {
    const area = $("actions");
    area.innerHTML = "";
    area.appendChild(el("div", "prompt", `选择指定目标 ${playerNameOf(targetId)} 的牌：`));
    for (const option of cardOptions) {
      addButton(area, option.label, () => {
        asking = false;
        send({ type: "action", actionIndex, targetId, selectedCardId: option.id });
      });
    }
  };

  // ---- 交互响应 ----

  const showInteraction = (request) => {
    asking = true;
    const area = $("actions");
    area.innerHTML = "";
    const kind = request.kind;

    if (kind === "respond") {
      area.appendChild(el("div", "prompt", request.reason));
      for (const source of request.sources) {
        addButton(area, source.label, () => {
          asking = false;
          sendDecision({ choice: "card", sourceId: source.sourceId });
        });
      }
      addButton(area, "不应对", () => {
        asking = false;
        sendDecision({ choice: "pass" });
      });
      return;
    }

    if (kind === "collateral") {
      area.appendChild(el("div", "prompt", request.reason));
      for (const victimId of request.victims) {
        addButton(area, `对 ${playerNameOf(victimId)} 使用杀`, () => {
          if (request.sources.length > 1) {
            showCollateralSourcePicker(request, victimId);
          } else {
            asking = false;
            sendDecision({ choice: "target", targetId: victimId });
          }
        });
      }
      if (request.allowHandOverWeapon) {
        addButton(area, "交出武器", () => {
          asking = false;
          sendDecision({ choice: "pass" });
        });
      }
      return;
    }

    if (kind === "choose-discard") {
      area.appendChild(el("div", "prompt", request.reason));
      for (const source of request.sources) {
        addButton(area, source.label, () => {
          asking = false;
          sendDecision({ choice: "card", sourceId: source.sourceId });
        });
      }
      if (request.allowPass) {
        addButton(area, request.passLabel || "放弃", () => {
          asking = false;
          sendDecision({ choice: "pass" });
        });
      }
      return;
    }

    if (kind === "choose-suit") {
      const suitLabels = { heart: "红桃", diamond: "方片", club: "梅花", spade: "黑桃" };
      area.appendChild(el("div", "prompt", request.reason));
      for (const suit of request.suits) {
        addButton(area, `声明${suitLabels[suit] || suit}`, () => {
          asking = false;
          sendDecision({ choice: "suit", suit });
        });
      }
      return;
    }

    if (kind === "optional-effect") {
      area.appendChild(el("div", "prompt", request.reason));
      addButton(area, "发动", () => {
        asking = false;
        sendDecision({ choice: "effect", enabled: true });
      }, true);
      addButton(area, "不发动", () => {
        asking = false;
        sendDecision({ choice: "effect", enabled: false });
      });
      return;
    }

    area.appendChild(el("div", "prompt", `未处理的交互类型：${kind}`));
    asking = false;
  };

  const showCollateralSourcePicker = (request, victimId) => {
    const area = $("actions");
    area.innerHTML = "";
    area.appendChild(el("div", "prompt", "选择用于响应的杀："));
    for (const source of request.sources) {
      addButton(area, source.label, () => {
        asking = false;
        sendDecision({ choice: "target", targetId: victimId, sourceId: source.sourceId });
      });
    }
  };

  connect();
})();
