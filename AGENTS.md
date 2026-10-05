# AGENTS.md

CLI 三国杀 (SanGuoSha) — a TypeScript CLI card game with a host-authoritative **online multiplayer** mode and LLM-driven AI. Fork/extension of DonyLeno/CLI-SanGuoSha (see `README.md` for full dev notes).

## Commands

- `npm run dev` — run the local single-player game (**requires `bun`**).
- `npm run host -- --players=3` — start an online room server (default `0.0.0.0:9527`, 2–6 players). All players, including the host, join with a separate client. Online AI: `--ai=N` fills N server-side AI seats (LLM-driven, `--ai-driver=qwen|ollama|simple|system-one|hybrid`, fallback to local strategy); `hybrid`（默认开启，`--hybrid=false` 关闭）= **LLM 总规划 + Jev 局内快决策**（TypeSafe System One 决策模型 API，配置 `JEV_*` 启用，见 `jev-advisor.ts`；未配置则退回纯 LLM）; **武将包默认只内置**（`--generals-pool=all` 才加载外部包，`--generals-dir` / `--generals-json-only` / `--strict-generals` 见 README §11）; see README §联机游玩.
- `npm run join -- --host=IP --port=9527 --name=NAME` — join a room.
- `npm run typecheck` — `tsc --noEmit`. Keep it clean (passes today).
- `npm test` — `node --test --import tsx src/**/*.test.ts`. **206 tests, all pass**（含规则补全、网络加固、M1 技能注册表/动态技能注入、M2 外部武将包加载与执行、M3 声明式规则数据化与 §8 规则修复、Phase 6 拦截点、M4 自对弈不变量/校验器/文档生成的用例；改测试数量时同步更新这里）。`lightning-death.test.ts` 的"闪电劈死玩家"是 90 秒上限的轮询型联机测试，整包并发 + 机器负载高时偶发超时（单跑约 5s），重跑即可。
- `npm run generals:check -- --dir=<dir>` — 独立武将包校验器（`src/tools/generals-check.ts`）：真实 loader + 静态 lint（抓"loader 静默忽略"的写法：未知触发点/未知字段/空技能/`conversion`/`active` 无 `play`）。`--json` 机器可读、`--strict` 警告即失败、`--selfplay=N` 每个武将强制上场跑 N 局不变量断言。示例包零错误零警告。
- `npm run rules:gen` / `npm run rules:check` — 从武将库 + 技能注册表生成/校验 `rules.md` §14 与 §16.3（`src/tools/gen-rules.ts`，只替换 `<!-- GENERATED:… -->` 标记之间的内容，标记缺失即报错）。改技能 `description` 后必须 `rules:gen`，`src/tools/gen-rules.test.ts` 会在测试期卡住漂移。
- `npm run build` — `tsc` emit to `dist/`.
- `npm run lint` — eslint. ⚠️ **Not a clean gate**: **25 pre-existing errors**（unused vars in `*.test.ts`, `no-explicit-any`, floating promises in `network/*`）。Don't add new ones; don't fix the old ones en masse.

## Architecture

- `src/engine/` — pure game logic, no I/O. `game.ts` = `SanGuoGame`（状态 + 编排 + 交互管线，对拆出模块只保留薄封装）；`cards.ts` = card/enum + deck；`interaction.ts` = request/decision 类型；`types.ts` = 共享类型/枚举（game.ts re-export 保持公共 API 不变）；`generals.ts` = 武将库 + 身份/武将纯帮助函数；`card-utils.ts` = 卡牌谓词等纯函数；`resolve.ts` = 卡牌结算函数族（杀/决斗/锦囊/判定/死亡/胜负…）；`skills.ts` = 主动技能系统（`useSkillAction` + `canUse*` + 技能状态）；`skill-hooks.ts` = 技能触发器钩子表（每个触发点的内置钩子之后追加外部武将包的 `onTrigger`；Phase 6 起同一张表也承载 7 个拦截点）；`skill-module.ts` = 外部技能运行时契约（`SkillModule`/`SkillModuleCtx`）与全局注册表（挂 `globalThis.__sanguoPackRegistry__`，热重载后存活）；`skill-registry.ts` = 技能元数据注册表（`SkillKind`/`SkillDescriptor`/`SkillRules` + 45 技能登记，M1/M3；双向校验测试保证武将声明与注册表一致；`resolveSkillDescriptor` 统一查询外部→内置→兜底）；`skill-rules.ts` = 声明式规则谓词层（M3：`getSkillRules`/`sumActivatedRules`/`isImmuneTo`，把 8 条硬编码规则数据化，内置与外部包统一合并）；`general-pack.ts` = 外部武将包 loader（M2：扫描 `generals/*/general.json`、schema 校验、命名空间技能 id `${文件夹}/${技能}`、每包 try/catch 隔离、`rules` schema 校验；`--generals-pool` / `--generals-json-only` / `--strict-generals`）；`ai-heuristics.ts` = 引擎内置 AI 启发式。拆出模块一律以 **context-interface** 模式工作：函数首参是 `XxxContext`，`game.ts` 以 `this as unknown as XxxContext` 传入，模块间不互相 import（跨模块调用走 context），`private` 成员保持私有。`GameSnapshot` 是传给 UI/AI/network 的只读视图。所有脚本化响应（闪/杀/无懈可击/借刀杀人/弃牌/判定…）都通过 `InteractionRequest` + `DecisionHandler` 经 `game.decide()` 流转——引擎从不自动应答（阵亡玩家默认除外）。`hot-reload.ts` = 对局热重载：把 `src/engine` 复制到临时目录重新 import（全新模块图），`Object.setPrototypeOf` 把存活 `SanGuoGame` 实例的原型指向新类并重建技能钩子——`git pull` 后在主机控制台输入 `reload` 即可让进行中的对局用上新逻辑（只覆盖 `src/engine`，AI 层修改仍需重启）。
- `src/ui/app.ts` — OpenTUI CLI 层；驱动人机输入与 AI 循环；UI modes：`setup/game/response/discard/command`。`action-hints.ts` = 出牌提示纯函数；`render-lines.ts` = 按 mode 的渲染行构建器（显示区/状态区/操作区）。
- `src/agent/` — `ai.ts` decision loop (LLM; reasoning levels fast/normal/deep map to OpenAI-compatible `reasoning_effort`, per-turn thinking time, interaction decisions via `decideInteraction`, end-of-turn strategy review producing a free-text strategy note injected into later contexts, plus hybrid hook: **新版 hybrid = LLM 做战略规划（回合开始规划 + 回合末复盘的 strategy note）+ Jev 做局内快决策**（`decide`/`decideInteraction` 全部走 `JevAdvisor`，规划以 `strategic_plan` 下发；旧 Judge 门控仅本地 `SystemOneAgent` 做 `FastAdvisor` 时保留）), `local-engine.ts` (Simple AI fallback；持有与 LLM/Jev 同源的 `getMatchGeneralsText()`，并用 `resolveSkillDescriptor` 的 `targetIntent` 决定主动技能打敌人还是支援队友), `system-one.ts` (sync heuristic fast-think AI implementing the `FastAdvisor` interface; standalone `--ai-driver=system-one` only), `jev.ts` + `jev-advisor.ts` (Jev 快决策层：TypeSafe System One `POST /v1/systemone` with `state`+typed `questions` → `answers`; `best_action` choice 做局内出牌决策，`should_respond` noul 做局内响应决策；enabled by `JEV_*`，**失败时返回 `null` 交给上层回退本地策略**（绝不返回"猜一个动作/固定放弃"）），`prompt.ts` assembly + `pickReasoningLevel`, `match-context.ts` (M1：`stripGeneralsSections` 加载规则时剔除武将章节 + `buildMatchGeneralsText` 按快照 `player.skills` 生成"本局武将技能"文本块，接入 4 个 builder 的 `matchGeneralsText` 与 Jev state 的 `match_skills`), `round-context.ts` (shared multi-round context builder, `SG_AI_CONTEXT_ROUNDS`), `turn-decision.ts` (shared LLM→local→heuristic picker + driver label). Providers `qwen.ts`/`ollama.ts`. Debug via `devlog/ai-log.md` (gitignored, written by `src/devlog/ailog.ts`; stages: probe/decision/decision-repair/interaction/strategy/hybrid-plan).
- `src/network/` — host-authoritative TCP, newline-delimited JSON (`encodeMessage` in `protocol.ts`). `server.ts` = authoritative room host, `host.ts` = entry, `client.ts`, `protocol.ts` = wire types + `NETWORK_PROTOCOL_VERSION = 4` (可选消息 `source` 只由新 CLI/WebUI 发送，旧客户端不发，不参与版本兼容判断). `createClientSnapshot` hides other players' hands/roles (viewer-scoped). 入站防护：`line-parser.ts` 限制单条消息长度（默认 1 MiB，超限回错误并断连）、`accept()` 限制并发连接数（`--max-connections`）与未 join 连接的存活时间、`requestPeerDecision()` 有交互超时（`--interaction-timeout`，超时按“未响应/pass”继续结算并记日志）。座位归属：`join` 时签发**座位令牌**（`welcome.seatToken`），`verifySeatClaim()` 要求 `reconnect` 带令牌**或**来自该座位当初加入的同一台机器（`seatSources`），同名顶座仅在座位已离线时保留旧的“换设备登录”行为；三端（CLI/WebUI/Go）都已保存并在重连时上报令牌——WebUI 持久化到 localStorage，CLI/Go 只存内存（两者的 `playerId` 本就只存内存，重启后无法重连）。
- `src/tools/` — 开发期工具（M4，不进引擎运行时）：`generals-check.ts` = 武将包校验器（真实 loader + 静态 lint，见 Commands）；`gen-rules.ts` = `rules.md` 武将章节生成/校验；`selfplay.ts` = 无头自对弈不变量断言（`runSelfPlay` + `answerInteraction` + `mulberry32` 确定性 RNG，模拟联机主机的延迟结算 `resolvePendingDeaths`→`ensureTurnState`→`consumePendingTurnEnd`→`finishTurn`→`consumePendingNextTurn`→`startTurn`，违规记为结构化记录而非抛错）。两个 `*.test.ts` 覆盖校验器与文档漂移。
- `tools/light-client/` — zero-dependency Go client (`main.go`, go 1.21)。**注意：预编译二进制并未提交**（`.gitignore` 忽略 `tools/light-client/clisanguo-lite*`，`dist/` 也被忽略），需要时自行交叉编译；网络协议变更后必须重新编译。
- `src/webui/` + `webui/` — WebUI：`relay.ts` 用 `ws` 包把浏览器 WebSocket 与游戏服务器 TCP 协议双向互转（每 WS 连接对应一条 TCP 连接，消息原样透传），静态目录默认 `webui/dist`（**Vue 3 + Vite 前端，源码在 `webui/src/`**，`npm run webui:build` 构建）。座位令牌由浏览器持久化在 localStorage（`sgsSeatToken`，与 `sgsPlayerId` 同生命周期）。`npm run webui` 启动；线协议变更时同步 `webui/src/protocol.ts` 的版本/类型。（早期手写的最小 RFC 6455 服务端 `websocket-server.ts` 已删除。）

## Rules of thumb

- Adding a card/skill/effect must sync all of: `cards.ts` (definition + deck), `resolve.ts` (结算)/`skills.ts` (主动技能)/`game.ts` (可玩动作 + 分发)，以及 `rules.md`/`README.md` 对应章节。Documented rules follow the **current implementation**, not full tabletop rulings.
- **外部武将包**（`generals/<武将名>/`，M2）：新增武将/技能不改 `src/`、不重编译。技能 id 命名空间化为 `${文件夹}/${技能}`，展示用 `displayName`；引擎在 `getPlayableActions` 枚举外部 `active` 技能、`createSkillHooks` 追加外部 `onTrigger`、`useSkillAction` 委托外部 `play`（try/catch 不炸对局）。`.ts` 技能仅 bun/tsx 可用（跨环境用 `.mjs`）；host 默认 `builtin`（外部包=任意代码执行）。契约与能力清单见 `docs/generals-pack-api.md`，示例见 `examples/generals/吕蒙/`。
- **触发点/拦截点清单的单一真相是 `types.ts` 的 `SKILL_TRIGGERS`**（`SkillTrigger` 由它派生；loader 校验、`createSkillHooks` 分发都读它）。4 个基础触发点 + Phase 6 的 7 个拦截点（`judgment`/`slash_targeted`/`hand_card_lost`/`equip_lost`/`card_used`/`peach_save`/`discard_phase_start`）共用一套 `onTrigger`；拦截靠 payload 字段（`judgmentCard`/`canceled`/`skipDiscardPhase`/`peachSaveBonus`）。**`createSkillHooks` 在建局时快照外部钩子**，所以加载武将包必须在构造 `SanGuoGame` 之前。
- 新增声明式规则（`SkillRules`）要同步四处：`skill-registry.ts` 词表（`SkillRules` 类型 **+ `SKILL_RULE_KEY_KINDS`**，后者是校验器/文档/测试读的键→类型单一真相）+ `skill-rules.ts` 谓词层合并语义 + `general-pack.ts validateRules` schema + `docs/generals-pack-api.md` 词汇表。`general-pack.test.ts` 有测试卡住 `SKILL_RULE_KEY_KINDS` 与 `validateRules` 的漂移。**只影响 AI 选目标的字段**（如 `targetIntent`）不该塞进 `rules`，它属于 `SkillDescriptor`/`SkillModule` 元数据。
- 改了技能 `description` / 武将库之后：`npm run rules:gen`（`rules.md` §14/§16.3 是生成物），`src/tools/gen-rules.test.ts` 会在测试期卡住漂移。改了引擎或武将包之后：`npm run generals:check -- --dir=examples/generals --selfplay=3` 是"不读源码也能拿反馈"的那条通道（校验器 + 自对弈不变量），它抓的是 loader **静默忽略**的写法（未知触发点/未知字段/空技能）。
- Protocol changes: bump `NETWORK_PROTOCOL_VERSION` and update **both** the TS client and the Go light client. 新增的**可选**字段（如 `welcome.seatToken`、`reconnect.seatToken`）属于向后兼容的加字段，不必 bump，但要让客户端逐步用起来（Go 客户端与 `webui/src/protocol.ts` 需同步）。
- Server always calls `game.setDeferDyingResolution(true)` and sets one `DecisionHandler` per peer. A human peer's disconnect **immediately** switches their seat to AI-driven (断线托管：`takeoverIds` + `registerTakeoverSeat`；turn driving via `driveAiTurn` + `pickAiTurnDecision`, same `--ai-driver` chain as native AI seats; `ai.ts`/`local-engine.ts` expose `setAllowNonAiSeats` + `registerSeatForTakeover` for this). Reconnect hands control back (`handleReconnect`, `seatEpoch` stops in-flight AI decisions). There is no timeout-based room close anymore; `reconnectTimeoutMs` only feeds the `player_disconnected` broadcast. Server auto-restarts after game over.
- Same-machine guard: one active seat per source fingerprint (`sha1(IP:machineId)`). Clients send `{type:"source", machineId}` before join/reconnect — WebUI from localStorage, TS CLI **and the Go light client** from the same `~/.clisanguo/machine-id` file (so CLI/Go double-open on one machine is detected); the WebUI relay injects the browser IP the server can't see. Unverified connections (third-party/old clients) skip the machine check. `allowMultiConnectionsPerSource` (host flag `--allow-multi-source`) relaxes it. 同名顶座：座位**仍在线**时必须通过 `verifySeatClaim()`（座位令牌或原设备指纹），否则明确拒绝；座位**已离线**时保留“换设备登录”并通知旧连接（`closed`），避免两端抢座。直接 `reconnect` 被其他设备接管时也会给旧连接发 `closed`。
- `--seed=N` gives a deterministic RNG (also `SG_SEED` env) for reproducible tests/replays.

## TypeScript constraints

- Strict + NodeNext ESM: relative imports need the `.js` extension (`./engine/game.js`).
- `noUncheckedIndexedAccess` (indexing yields `T | undefined`) and `exactOptionalPropertyTypes` are on — handle undefined and optional props explicitly.

## Config / env

- `.env` is gitignored; copy `.env.example`。实际读取的变量名：`STEP_PLAN_API_KEY` / `STEP_PLAN_BASE_URL` / `STEP_PLAN_MODEL`（**注意：驱动名仍叫 `--ai-driver=qwen`、代码在 `qwen.ts`，但后端已是 StepFun 的 step_plan 接口，文档里的 `QWEN_*` 是历史命名**）、`OLLAMA_BASE_URL` / `OLLAMA_MODEL`、`JEV_*`（或官方 SDK 名 `TYPESAFE_API_KEY`）、`SG_ONLINE_PORT`、`SG_AI_HYBRID`、`SG_AI_CONTEXT_ROUNDS`。

## Read before changing

- `README.md` — architecture + startup flow, §8 rule→code mapping, §9 extension points, §11 外部武将包.
- `rules.md` — rule reference used by help text and AI prompts.
- `docs/interaction-refactor-plan.md` — design behind the online interaction protocol.
- `docs/generals-pack-api.md` — 外部武将包契约、`SkillModule`/Context 能力清单与隐式约定。

## Gotchas

- AI behavior changes usually require updating `prompt.ts` (context structure) and `ai.ts` (decision/fallback) together, not just the engine.
- `JevAdvisor.decideTurn` / `decideInteraction` **在 Jev 不可用时返回 `null`**（由上层回退本地策略）；不要改回"随便挑一个动作 / 固定 pass"，那会让失败的 AI 伪装成正常 AI、并在濒死时白送。
- 引擎的 `decide()` 在座位**没有注册 `DecisionHandler`** 时会走 `autoDecision`（例如自动出桃救人或弃第一张牌）。真实对局每个座位都有 handler（人类=网络、AI=驱动），但写测试时要注意这一点，否则会得到"AI 自己把敌人救活"的假象。
- `setPeachDecision` / `clearPeachDecisions` 目前**没有调用方**（历史遗留），改濒死逻辑时不要以为它们还生效。
