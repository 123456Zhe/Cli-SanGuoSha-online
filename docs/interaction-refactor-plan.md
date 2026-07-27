# 联机交互响应重构计划

> 目标:提升联机对战可操作性。把"谁在哪一步做决定"的发言权从 server 的正则预判,还给引擎本身。

## 一、需求清单

| # | 需求 | 现状问题 | 涉及代码 |
|---|------|---------|---------|
| 1 | 借刀杀人可选择性出杀 | `resolveCollateral` 由引擎替目标决定出杀或交武器,目标玩家完全不参与;`buildResponseQueue` 无借刀分支 | `src/engine/game.ts:1604`、`src/network/server.ts:225` |
| 2 | 决斗每次出杀响应一次 | 决斗仅出牌前给双方各排一个 slash 请求;`while` 循环后续轮次 selection 为空,引擎 `findIndex` 自动打第一张杀 | `src/engine/game.ts:1493`、`src/network/server.ts:258` |
| 3 | 有藤甲时万箭齐发/普通杀不触发响应 | `buildResponseQueue` 的万箭/杀分支不查 armor,藤甲玩家仍被问"是否打闪",选后引擎才打日志抵消 | `src/network/server.ts:254`、`src/engine/game.ts:1433,1576` |
| 4 | 需要弃牌的武将效果/木牛流马放牌可以自选牌 | `getDiscardOptions` 只列手牌;木牛放牌 `cardIndex:-11` 固定动作直接 splice 手牌,不可选 | `src/engine/game.ts:696,876` |
| 5 | 木牛流马内牌可以取出,且与手牌共用一套逻辑 | `treasureCards` 是独立数组,不进响应选项、不进弃牌选项、不计手牌上限、不能取出 | `src/engine/game.ts:27,1098,2165,2186` |

## 二、核心架构:引擎 yield 请求 → server 路由 → 客户端渲染

现状是 server 在出牌前用正则匹配动作 label 预判响应队列(`buildResponseQueue`),再把 selection/policy 预填进引擎,引擎同步自动消耗。预判永远追不上结算分支,这是所有痛点的根因。

重构为:**结算走到决策点时,引擎主动产出一个结构化请求并暂停,由注入的决策源(本地人类 / 远端 socket / AI)给出答案后继续。**

### 2.1 InteractionRequest / InteractionDecision 协议

新增 `src/engine/interaction.ts`(纯数据类型,被 engine/server/ui 共享):

```ts
type InteractionRequest =
  | { kind: "respond";          responderId; trigger: { cardName; actorId }; responseKind; sources: CardSource[]; allowPass: true }
  | { kind: "duel-slash";       responderId; round: number; sources: CardSource[]; allowPass: true }           // 决斗每轮一个
  | { kind: "collateral-slash"; targetId; victims: PlayerId[]; allowHandOverWeapon: true }                     // 借刀:出杀(选目标)或交武器
  | { kind: "choose-discard";   playerId; reason; sources: CardSource[]; count: number }                       // 自选弃牌 / 武将弃牌效果
  | { kind: "wooden-ox-insert"; playerId; sources: CardSource[] }                                              // 自选放哪张
  | { kind: "wooden-ox-draw";   playerId; sources: CardSource[] }                                              // 自选取哪张
  | { kind: "optional-effect";  playerId; effect; reason }                                                     // 现有 effect 迁移

type InteractionDecision =
  | { choice: "pass" }
  | { choice: "card";   sourceId: string }
  | { choice: "target"; targetId: string }
  | { choice: "effect"; enabled: boolean }
```

### 2.2 统一卡牌源 CardSource

需求 4、5 的基石。木牛内牌不再当独立仓库,只是 `origin: "treasure"` 的另一批手牌:

```ts
type CardSource = { sourceId: string; origin: "hand" | "treasure"; card: Card };
usableCards(player): CardSource[]   // hand ++ treasureCards,统一编号
```

将下列只扫 `player.hand` 的位置改为扫 `usableCards`:
- `getPlayerResponseOptions`(game.ts:1098)→ 木牛内牌可当响应牌,回合外可用
- `countAvailableDodgeResponses` / `countAvailableSlashResponses`(game.ts:2165,2186)
- `consumeDirectDodgeResponse` / `consumeDirectSlashResponse`(game.ts:1824,1864)→ 按 origin 去对应数组 splice
- `getDiscardOptions`(game.ts:696)+ 手牌上限计算 → 木牛内牌计入"需弃牌数"且可被选弃

### 2.3 引擎可中断结算

- `SanGuoGame` 构造注入 `requestDecision(req): Promise<InteractionDecision>`,默认实现 = 现有自动/AI 逻辑(保证无注入时行为不变)。
- `playAction` / `resolveSlash` / `resolveDuel` / `resolveCollateral` / `resolveArrowRain` / 弃牌 / 木牛 相关函数改 `async`,决策点 `await this.requestDecision(...)`。
- 藤甲:`resolveArrowRain` / `resolveSlash` 开头判 `armor === VineArmor` → 不构造请求,直接 return(响应不触发)。

## 三、当前三套 UI 架构现状

代码里实际存在三套渲染/交互架构,重构必须同时照顾:

| 客户端 | 文件 | 渲染方式 | 长输出 | 交互模型 |
|--------|------|---------|--------|---------|
| 本地 TUI | `src/ui/app.ts` | 全屏 TUI(@opentui/core,alternate-screen,每次全量重绘) | 手写分页 `renderPagedArea`,无原生滚动缓冲 | `InputMode` 状态机(7 种)+ `pendingAiResponse` 预判切片 |
| Node 客户端 | `src/network/client.ts` | 滚动式 CLI(readline 问答 + `console.clear()`) | 终端原生 scrollback | 顺序问答,`state`/`response`/`effect` 消息驱动 |
| Go 轻客户端 | `tools/light-client/main.go` | 滚动式 CLI(`bufio.Scanner` 阻塞读 + `fmt.Printf` 顺序打印,连 clear 都没有) | 终端原生 scrollback | 顺序问答,`response`/`effect`/`state-discard` 消息驱动 |

要点:
- Go 轻客户端**不是**真 TUI,是零依赖的滚动式 CLI;滚动式对"长输出"反而最友好,不计划引入 tview/bubbletea 等 TUI 库。
- 联机客户端(后两者)是**消息驱动 + 阻塞问答**模型,与 `InteractionRequest` 协议天然契合:每收到一条 `interaction` 就打印 reason + 列表、读编号、回 decision。

## 四、落地步骤(按联机收益排序,每步可独立 typecheck + 测试)

### 步骤 1:CardSource + usableCards 改造(纯引擎)
- 新增 `src/engine/interaction.ts` 定义 `CardSource` / `usableCards`。
- 改造 §2.2 列出的所有扫 `player.hand` 的位置。
- 顺带解决:藤甲不触发响应请求(resolve 开头短路)、木牛内牌可取出/共用逻辑。
- 验证:`npm test`(`game.test.ts` 兜底)+ `npm run typecheck`。

### 步骤 2:InteractionRequest 协议 + 引擎 requestDecision 注入
- 引擎持有 `requestDecision` 回调,默认自动实现。
- `resolveSlash` / `resolveArrowRain` / 决斗 / 借刀 改 await 决策。
- 解决:决斗逐次响应、借刀可选出杀、藤甲不触发。
- 验证:`npm test` + `typecheck`。

### 步骤 3:server 路由 + 协议字段扩展
- 删除 `buildResponseQueue` / `PendingRequest` / `activeResponse` 预判队列(server.ts:225-333)。
- server 注入 `requestDecision`:按 `responderId/playerId` 找 peer → 发 `interaction` 消息 → `await` per-peer Promise(`handleInteraction` 回包时 resolve)。
- 协议新增(src/network/protocol.ts):
  ```ts
  ServerMessage |= { type: "interaction"; request: InteractionRequest }
  ClientMessage |= { type: "interaction"; decision: InteractionDecision }
  ```
- 断线重连:`await requestDecision` 自然 pending,重连后重发当前 interaction(扩展现有 resend 雏形 server.ts:150)。
- **此步完成,联机可操作性目标即达成。**
- 验证:联机手动对局(3 终端)。

### 步骤 4:木牛 insert/draw + 自选弃牌接入
- 木牛放牌(`cardIndex:-11`)改为 `wooden-ox-insert` 请求,自选放哪张。
- 木牛取牌新增 `wooden-ox-draw` 请求。
- 武将弃牌效果(雌雄双股剑等)走 `choose-discard`。
- 验证:`npm test` + 联机对局。

### 步骤 5:三套客户端接入 interaction(收尾)

#### 5a. 本地 TUI `src/ui/app.ts`
- 删除 `pendingAiResponse` + `handlePendingResponseChoice`(app.ts:1330)+ `InputMode` 的 response/discard 分支。
- 注入同步版 `requestDecision`(弹 `RequestPanel` 等人类选),统一走 `RequestPanel` 渲染。

#### 5b. Node 客户端 `src/network/client.ts`
- 把 `response` / `effect` / `state-discard` 三个 handler 合并为一个 `interaction` handler:
  ```
  收到 { type:"interaction", request } →
    打印 request.reason / trigger 描述
    switch(request.kind):
      respond / duel-slash / choose-discard / wooden-ox-* → 列出 sources(带 [手牌]/[木牛] 标记)+ "不出牌"
      collateral-slash → 列出 victims(出杀目标)+ "交武器"
      optional-effect → 发动 / 不发动
    读编号 → send { type:"interaction", decision }
  ```

#### 5c. Go 轻客户端 `tools/light-client/main.go`
- 新增 `InteractionRequest` 反序列化结构体:
  ```go
  type cardSource struct {
      SourceID string `json:"sourceId"`
      Origin   string `json:"origin"` // "hand" | "treasure"
      Card     card   `json:"card"`
  }
  type interactionRequest struct {
      Kind      string       `json:"kind"`
      Reason    string       `json:"reason"`
      Round     int          `json:"round"`
      Sources   []cardSource `json:"sources"`
      Victims   []string     `json:"victims"`
      AllowPass bool         `json:"allowPass"`
      Count     int          `json:"count"`
      Effect    string       `json:"effect"`
      Trigger   struct{ CardName, ActorID string } `json:"trigger"`
  }
  ```
- `serverMessage` 加 `Request *interactionRequest` 字段;switch 加 `case "interaction"`,逻辑同 5b(列表带 [手牌]/[木牛] 前缀,读编号回 `decision`)。
- 删除旧 `response` / `effect` / `state` 内嵌 discard 的 case。
- CJK 全角对齐:列表打印用 `%2d. %s`,避免中文宽度错位。

## 五、风险与注意

- **行为兼容**:步骤 1-2 保证默认 `requestDecision` = 现有自动逻辑,无 server/UI 接入时本地对局行为不变。
- **测试**:现有 `game.test.ts`(1384 行)是重要兜底,重构每步必跑。
- **异步传染**:`playAction` 变 async 会传染到所有调用方(server、app、ai 循环、test),需逐一 await。
- **中文全角宽度**:Go 轻客户端渲染交互列表时注意 CJK 对齐。
- **协议版本**:`NETWORK_PROTOCOL_VERSION` 3 → 4,旧客户端拒绝加入。
