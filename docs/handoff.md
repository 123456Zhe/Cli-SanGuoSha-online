# 交接文档（给接手的 agent）

> 目的：让一个**没有上下文**的 agent 读完本文 + 下列材料后即可继续开发。
> 当前分支 `main`；已提交：`c55c488`（**神赵云参考实现**）、`9f25b28`（**M4 校验器/自对弈/文档生成**）、
> `d9a0053`（Phase 6 拦截点 + local-engine）、`90bd494`（M1–M3）。
> 本文档描述的是**已提交的 M1–M4 + Phase 6** + **本轮未提交的 Phase 7 改动**。

## 0. 一句话状态

「武将包与技能模块化」计划：**M1（契约 + AI 认识本局武将）、M2（外部武将包进游戏）、M3（声明式规则数据化）、
Phase 6 拦截点、M4（校验器 + 自对弈不变量 + 文档生成）均已完成并提交**；
**Phase 7（声明式当牌转换 `conversions` / `provide_response` / `ctx.useSlash` / 手牌上限）已实现**（见计划 §19，本轮未提交），
`examples/generals/神赵云/` 的「龙魂」从"写不出来"变成了可真执行（0 错误 / 0 警告）。
基线：`typecheck` 干净、`npm test` **219 全绿**、`lint` 25 个存量错误（无新增）；`generals:check` 与 `rules:check` 均干净。
**下一步是计划 §17 的剩余缺口**（②JSON Schema ③作者 `.d.ts` ④参考实现 gallery ⑤`priority` 空转 ⑥pack 钩子 try/catch）。

## 1. 必读材料（按顺序）

1. `AGENTS.md` — 命令、架构、约定、坑（**先读这个**，是给 agent 的项目宪法）。
2. `README.md` — 启动流程、§8 规则→代码映射、§11 外部武将包。
3. `docs/generals-pack-plan.md` — **总计划**（M1–M5 分阶段、决策表、遗留问题、验收门槛）；M1 见 §12、M2 见 §13、M3 见 §14、Phase 6 见 §15、M4 见 §16、下一步缺口见 §17。
4. `docs/generals-pack-api.md` — 外部武将包契约、`SkillModule`/Context 能力清单、触发点与拦截点表、隐式约定。
5. `rules.md` — 规则参考（help 文本与 AI prompt 用；文档以当前实现为准）。
6. `docs/interaction-refactor-plan.md` — 联机交互协议设计背景。
7. `docs/m2-progress-handoff.md` — M2 实施细节（历史记录，已完成）。

## 2. 项目是什么

CLI 三国杀（TypeScript，NodeNext ESM），主机权威的**在线多人** + LLM 驱动 AI。

- 纯引擎逻辑在 `src/engine/`（无 I/O，context-interface 模式）。
- `src/agent/` = LLM/Jev/本地策略；`src/network/` = 主机权威 TCP；`src/ui/app.ts` = OpenTUI CLI；`src/webui/` + `webui/` = WebUI。

## 3. 已完成

### M1 + M2 + M3（已提交，见计划 §12–§14）

- **M1**：`skill-registry.ts`（45 技能元数据 + 双向校验）、`match-context.ts`（按快照 `player.skills` 生成"本局武将技能"，剔除 `rules.md` §14/§16.3，总长 4000 上限）、AI 消费点接线。
- **M2**：`SkillName` 由 enum 改 `const` 对象 + `SkillId`/`BuiltinSkillId`/`KINGDOM`；`skill-module.ts`（运行时契约 + `globalThis` 注册表）；`general-pack.ts`（loader、命名空间 id、每包 try/catch 隔离、`pool/jsonOnly/strict`）；入口在构造前 `await loadGeneralPacks`（dev 默认 `all`、host 默认 `builtin`）。
- **M3**：`SkillRules` 8 字段词表 + `skill-rules.ts` 谓词层（`getSkillRules`/`sumActivatedRules`/`isImmuneTo`）；§8 的 7 项规则/文档问题全部处理（受控常量 `UNOWNED_BUILTIN_SKILLS`、主公 +1 体力、激昂判色、魂姿即时觉醒、`rules.md` 漂移修正）。

### 本轮（Phase 6 + row 14，见计划 §15）

- **触发点与拦截点合并为一套机制**：`types.ts` 的 `SKILL_TRIGGERS` 是单一真相（`SkillTrigger` 由它派生）。
  4 个基础触发点 + 7 个拦截点：`judgment`（改判）、`slash_targeted`（取消杀）、`hand_card_lost`、`equip_lost`、
  `card_used`、`peach_save`（追加回复）、`discard_phase_start`（跳过弃牌阶段）。拦截靠 payload 字段，不另开 `interceptors`。
- **声明式规则 `skipDiscardPhaseIfNoSlash`**：示例包的「克己」终于真正生效（原本 `rules` 只是被加载保留）。
- **`slashPlayedThisTurn`**：把"打出"响应杀与出牌阶段"使用"杀分开计数，克己的判定才准。
- **`targetIntent`（enemy/ally/any）**：技能元数据 + loader 校验 + 内置 6 个主动技能标注；本地策略 AI 据此选目标。
- **`local-engine.ts` 收尾**：`getMatchGeneralsText()` 与 LLM/Jev 同源；`evaluateAction` 读技能元数据，
  修掉了"青囊/结姻/仁德 这类支援技被丢到敌人身上"的旧启发式。

## 4. 本轮（M4）与下一步

### 本轮：M4 已完成（见计划 §16）

- **`src/tools/generals-check.ts`**（`npm run generals:check -- --dir=<dir>`）：真实 loader 的权威检查 + 静态 lint
  （抓 loader **静默吞掉**的写法：未知触发点名、拼错字段、双源真相、`active` 无 `play()`、空技能、`conversion` 不生效……），
  `--json` / `--strict` / `--selfplay=N`。示例包零错误零警告。
- **`src/tools/selfplay.ts`**：`runSelfPlay` 确定性自对弈（`mulberry32(seed)`、全座位 `isAI`、违规记结构化记录）。
  关键点：`initNetworkGame` 会把 `staged` 置 true，宿主必须**反复**消费延迟结算（`settleStagedTurn`），
  只消费一次会把局面停在"弃牌阶段但无人可动"；"体力 0 但存活"在 `setDeferDyingResolution(true)` 下是合法中间态，
  只有在结算消费完之后才能断言。
- **`src/tools/gen-rules.ts`**（`rules:gen` / `rules:check`）：`rules.md` §14/§16.3 由武将库 + 技能注册表生成，
  只替换 `<!-- GENERATED:… -->` 标记之间的内容。**改技能 `description` 后必须 `rules:gen`**（有漂移测试卡住）。
- **`SKILL_RULE_KEY_KINDS`**（`skill-registry.ts`）：`SkillRules` 键→类型的单一真相（校验器/文档/测试都读）。
- **`GeneralDefinition.description?`**：`general.json` 的 `description` 不再被静默丢弃。

### 本轮：Phase 7（见计划 §19）——补完 §17 的 ①②③④

- **声明式当牌转换 `conversions`**：`SkillConversion[]`（一个技能可多条，龙魂就是 4 条花色映射）。
  出牌阶段走 `GameAction.convertVia/convertTo` + `cardIndex = -10000 - 下标`（**必须排在 `playAction` 所有内置负下标分支之前**，
  `<= -1000` 是木牛流马——实现时踩到过）；`playAction` 全部复算，不信任客户端。响应时机走 `provide_response`。
  `to` 只放行 `杀/火杀/雷杀/桃/闪/无懈可击`，其余 loader 明确拒绝。
- **`provide_response`**（第 12 个拦截点）：在"没有任何来源 → 判定无法响应"**之前**发射，钩子/声明式转换把来源并入候选；
  `CardSource.viaSkill` 是凭据，`consumeResponseCard` 用技能真实声明复算 `from`（防伪造的 sourceId 蒙过去）。
- **`ctx.useSlash`**：外部代码技能可以完整结算一张杀（闪响应/铁骑/藤甲/濒死/胜负/回合推进）。
- **手牌上限**：静态 `rules.handLimitDelta` + 运行时纯函数 `handLimit(player)`，统一出口 `skill-rules.ts getHandLimit`，
  引擎（3 处）与 UI 提示同源。
- **内置转换技不迁移**：武圣/龙胆/国色/倾国/急救仍是硬编码分支，不要给它们填 `conversions`（会重复枚举）。

### 下一步（§17 的剩余缺口，按建议顺序）

1. **JSON Schema**（`schema/*.json`）+ **作者 `.d.ts`**（`SkillModuleCtx` 只文档化、无签名）+ **参考实现 gallery**
   （`examples/generals/` 8–12 个覆盖各机制的武将，默认不加载）。
2. `priority` 钩子排序（**当前是空转**）或删字段；pack 钩子 `onTrigger` 补 try/catch（现在外部钩子抛错会炸掉整局）。
3. Phase 7 残留：`conversions` 只吃**一张**源牌（龙魂的"至多两张同花色"双牌模式未实现）；
   `to` 为延时锦囊/装备的转换（国色的方块当乐不思蜀）不支持。

**参考实现**：`examples/generals/神赵云/` —— `绝境` 演示"运行时变量"的两条通道（`before_draw` 钩子 + `handLimit` 纯函数），
`龙魂` 演示声明式 `conversions`（出牌阶段 `火杀/桃` + 响应 `闪/无懈可击`），校验器 **0 错误 / 0 警告**。

**验收方式**（"拿 API 文档独立写出武将"算不算成立）：起一个没有本仓库上下文的 subagent，只给
`docs/generals-pack-api.md` + `schema/` + 作者 `.d.ts`（**禁止读 `src/`、`examples/`**），写张飞（纯声明式）、
司马懿（`judgment` + 反馈）、黄月英（奇才 + 集智 + 一张当牌转换）；判定
`generals:check --json` 零错误、`--selfplay=100` 零违规、日志里技能都真的触发过、`src/` 一行未改。

## 5. 验证命令与当前基线

```bash
npm run typecheck   # 必须干净（当前 0 error）
npm test            # 当前 219 全绿（node --test --import tsx）
npm run lint        # 基线 25 存量错误，不得新增（不改存量）
npm run generals:check -- --dir=examples/generals            # 0 错误 / 0 警告
npm run generals:check -- --dir=examples/generals --selfplay=3
npm run rules:check                                          # rules.md 与注册表同步
npm run host -- --players=3 --generals-pool=all              # 手动验收外部包
```

已知不稳定用例：`src/network/lightning-death.test.ts` 的"闪电在判定阶段劈死玩家"是 90 秒上限的轮询型联机测试，
整包并行 + 机器负载高时偶发超时（单跑约 5s）。重跑即可，不是回归。

## 6. 环境与坑（接手必读）

- **`node_modules` 的平台绑定**：本 checkout 曾在 Linux 装过 `@esbuild/linux-x64`；在 Windows 上跑测试会报
  "You installed esbuild for another platform"。本轮已补装 `@esbuild/win32-x64@0.28.2`（`--no-save`，`package.json`/`package-lock.json` 未改），
  但该操作会移除 `linux-x64`——**换平台必须重新 `npm install`**。
- **`npm run dev` 需要 `bun`**；`host/join/webui/test` 用 `tsx`。
- **`createSkillHooks` 在构造 `SanGuoGame` 时快照外部钩子**：加载武将包必须在建局之前（`loadGeneralPacks` → `new SanGuoGame`）。
  写测试要注册外部技能时，先 `registerPackSkill` 再建对局，否则钩子不会被挂上。
- **注册表挂 `globalThis.__sanguoPackRegistry__`**：热重载会重建 `src/engine` 模块图，挂模块局部变量会失效；
  `reload` 不重新扫 `general-pack` 目录（代码热重载不维护，决策 5）。
- **命名空间技能 id** = `${文件夹}/${技能}`；`Player.skills`/快照/协议存这个 id，展示用 `displayName`。内置技能 id 就是中文名。
- **`.ts` 技能仅 bun/tsx 可用**（`import type` 运行时被擦除）；跨环境用 `.mjs`，或 `--generals-json-only`。
- **host 默认 `builtin`**、dev 默认 `all`（外部包 = 任意代码执行，联机主机需显式开启）——实现时别写反。
- **TS 严格**：`noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`（可选属性对象展开要 `NonNullable<...>` 或先建对象再条件赋值）；NodeNext ESM 相对导入要带 `.js`。
- **引擎 `decide()` 无 handler 时走 `autoDecision`**：`optional-effect` 默认 `enabled: false`，`respond`/`choose-discard` 默认选第一个 source。
  写测试注意，否则会出现"AI 自动救人"假象；真实对局每个座位都有 handler。
- **改动外部武将/技能/卡牌时同步** `docs/generals-pack-api.md`、`AGENTS.md`、`README.md`。
