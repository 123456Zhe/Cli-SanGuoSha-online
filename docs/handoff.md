# 交接文档（给接手的 agent）

> 目的：让一个**没有上下文**的 agent 读完本文 + 下列材料后即可继续开发。
> 当前分支 `main`；已提交的相关 commit（新→旧）：
> `74086e5`（**评审 15 项问题修复**）、`5c27548`（联机 `--general` 自选武将）、`f3b56ae`（**Phase 7**）、
> `c55c488`（神赵云参考实现）、`9f25b28`（M4）、`d9a0053`（Phase 6）、`90bd494`（M1–M3）。
> 其中 `e18be56`/`6a1c755` 是另一路提交（System-One / simple 本地 AI 升级），本轮已 rebase 合入。
> 本文档描述的是**已提交的 M1–M4 + Phase 6 + Phase 7 + 74086e5 + 两个本地 AI 升级** +
> **本轮未提交的 §17 ②③④（JSON Schema / 作者 `.d.ts` / 参考武将 gallery）与文档漂移修复**。

## 0. 一句话状态

「武将包与技能模块化」计划（`docs/generals-pack-plan.md`）：

- **M1（契约 + AI 认识本局武将）、M2（外部武将包进游戏）、M3（声明式规则数据化）、Phase 6（拦截点）、
  M4（校验器 + 自对弈不变量 + 文档生成）、Phase 7（声明式当牌转换 `conversions` / `provide_response` /
  `ctx.useSlash` / 手牌上限）、`74086e5` 的 15 项评审修复——全部已完成并提交。**
- **§17 的 ②③④ 已在本轮补完（未提交）**：`schema/`（JSON Schema + 防漂移测试）、
  `types/generals-pack.d.ts`（作者类型契约 + 防漂移测试）、`examples/generals/` 参考武将 gallery。
- **剩余缺口**：§17 row 5（`priority` 钩子排序仍是空转）与 row 7（内置技能模块化，**已决定先不做**）；
  以及 §17 的残留：`conversions` 只吃一张源牌、`to` 不支持延时锦囊/装备。
- 基线：`typecheck` 干净、`npm test` **252 全绿**、`lint` **25 个存量错误**（无新增）、
  `generals:check --dir=examples/generals` **0 错误 / 0 警告**、`rules:check` 干净。

## 1. 必读材料（按顺序）

1. `AGENTS.md` — 命令、架构、约定、坑（**先读这个**，是给 agent 的项目宪法）。
2. `README.md` — 启动流程、§8 规则→代码映射、§11 外部武将包与作者资源。
3. `docs/generals-pack-plan.md` — **总计划**：M1–M5 分阶段 + 决策表 + §12–§20 各阶段复盘。
   M1 §12、M2 §13、M3 §14、Phase 6 §15、M4 §16、下一步缺口 §17、神赵云实测 §18、Phase 7 §19、§17 ②③④ 落点 §20。
4. `docs/generals-pack-api.md` — 外部武将包唯一契约：`SkillModule`/Context 能力清单、12 个触发点与拦截点、当牌转换、规则词汇表**与隐式约定**。
5. `types/generals-pack.d.ts` — 作者视角的独立类型签名；`schema/*.json` — 机器可读结构约束。
6. `rules.md` — 规则参考（help 文本与 AI prompt 用；§14/§16.3 是**生成物**）。
7. `docs/interaction-refactor-plan.md` — 联机交互协议设计背景。
8. `docs/m2-progress-handoff.md` — M2 实施细节（历史记录，已完成）。

## 2. 项目是什么

CLI 三国杀（TypeScript，NodeNext ESM），主机权威的**在线多人** + LLM 驱动 AI。

- 纯引擎逻辑在 `src/engine/`（无 I/O，context-interface 模式）。
- `src/agent/` = LLM/Jev/本地策略；`src/network/` = 主机权威 TCP；`src/ui/app.ts` = OpenTUI CLI；`src/webui/` + `webui/` = WebUI。
- `schema/` + `types/` + `examples/generals/` = 给武将包作者的资源（都不进 `tsc`/lint/build）。

## 3. 已完成（要点）

- **M1**：`skill-registry.ts`（45 技能元数据 + 双向校验）、`match-context.ts`（按快照 `player.skills` 生成"本局武将技能"，剔除 `rules.md` §14/§16.3，总长上限 4000）、LLM/Jev/本地三个消费点接线。
- **M2**：`SkillName` 由 enum 改 `const` 对象；`skill-module.ts`（运行时契约 + `globalThis` 注册表）；`general-pack.ts`（loader、命名空间 id、每包 try/catch 隔离、`pool/jsonOnly/strict`）；入口在构造前 `await loadGeneralPacks`（dev 默认 `all`、host 默认 `builtin`）。
- **M3**：`SkillRules` 词表 + `skill-rules.ts` 谓词层；§8 的 7 项规则/文档问题处理（其中 #6/#7 见下方"复审更正"）。
- **Phase 6**：`SKILL_TRIGGERS` 单一真相；7 个拦截点 + `slashPlayedThisTurn` + 声明式 `skipDiscardPhaseIfNoSlash` + `targetIntent`。
- **M4**：`generals-check.ts`（真实 loader + 静态 lint + `--json/--strict/--selfplay`）、`selfplay.ts`（确定性自对弈不变量）、`gen-rules.ts`（`rules.md` §14/§16.3 生成/校验）。
- **Phase 7**（§19）：声明式 `conversions`（出牌阶段 + 响应时机）、`provide_response`（第 12 个拦截点）、`ctx.useSlash`、手牌上限统一出口 `getHandLimit`。
- **`74086e5` 复审修复（15 项，易被旧文档误导，务必知道）**：
  - 安全：技能名白名单校验（防 `../../` 路径穿越），`generals-check` 同口径 lint。
  - 包钩子按"事件相关玩家是否拥有该技能"判断归属（修掉绝境在别的武将身上触发）；单个包钩子抛错只记日志、不打断整局。
  - **规则回退**：**激昂的【决斗】不分颜色**（只有【杀】判红色）；**魂姿只在准备阶段（`turn_start`）判定**，移除"受伤即时觉醒"。计划 §8/§14 里 M3 的旧说法已标注为被本节取代。
  - `useSkillAction` 增加归属 + `canUse` 校验（防改包客户端）；同技能多条同 `to` 的转换按 `from` 匹配；朱雀羽扇转换杀用 `slashKindOf`。

## 4. 本轮（§17 的 ②③④ + 文档漂移修复）

### ② JSON Schema（`schema/`）

- `schema/general.schema.json`、`schema/skill.schema.json`（draft-07，`additionalProperties: false`）：字段、必填项、`kind`/`triggers`/`targetIntent`/`rules` 键/`conversions` 白名单/`from` 筛选项全部机器可读。
- `src/tools/pack-schema.test.ts`（7 例）：① schema ↔ 代码单一真相逐项比对（`SKILL_TRIGGERS`/`SKILL_RULE_KEY_KINDS`/`CONVERTIBLE_CARD_TYPES`/`CardType`/`SKILL_KINDS`/`KNOWN_*_KEYS`…）；② `examples/generals/` 每个 `general.json`/`.skill.json` 必须通过 schema；③ 反向用例证明 schema 不是空壳。
- 为此 `general-pack.ts` 导出 `SKILL_KINDS`/`TARGET_IMMUNITY_CARDS`/`CONVERSION_SUITS`，`generals-check.ts` 导出 `KNOWN_GENERAL_KEYS`/`KNOWN_SKILL_KEYS`/`CODE_ONLY_SKILL_KEYS` 作为单一真相。

### ③ 作者 `.d.ts`（`types/generals-pack.d.ts`）

- 独立、无 `src/` 依赖的类型契约：`SkillModule`、`SkillModuleCtx`（两个真实 context 的**全部**能力 + 隐式约定 JSDoc）、`SkillEventPayload`、`SkillRules`、`SkillConversion`、`CardSource`、`InteractionRequest/Decision`、`Player`/`Card`/`GeneralDefinition` 与全部词表。
- 代码技能用法：`import type { SkillModule, SkillModuleCtx } from "../../../types/generals-pack.js";` + `satisfies SkillModule`（`import type` 运行时被擦除）。
- `src/tools/generals-pack-types.test.ts`（9 例）：用 TS 编译器 API **独立编译**该 d.ts（零诊断），用 AST 逐项比对字段名与字面量联合（`SkillModuleCtx` == `SkillUseContext & SkillHooksContext`、`SkillModule`/`SkillEventPayload`/`Player`/`Card`/`SkillConversion`/`CardSource` 字段名、装备词表、`SkillRules` 键），并有一条**运行时守卫**：d.ts 里 `SkillModuleCtx` 的每个成员都必须在真实 `SanGuoGame` 实例上存在。
- **该守卫立刻抓到并修掉一个真 bug**：`hasRemovableCard` 只写在类型/文档里、从未挂到 `SanGuoGame` 上，内置「反馈」玩家确认发动后会抛 `ctx.hasRemovableCard is not a function`（测试里无 handler 时 `autoDecision` 默认"不发动"，被 `&&` 短路掩盖）。已补 `SanGuoGame.hasRemovableCard`（委托 `card-utils.ts`，原先两处调用改别名导入）。

### ④ 参考武将 gallery（`examples/generals/`，默认不加载）

在 `吕蒙`/`神赵云` 之外新增 5 个包，共 **7 个**（`--strict` 0 错误 / 0 警告、`--selfplay=3` 全 0 违规）：
`张角`（`judgment` 改判 + `card_used` → 判定 → 雷电伤害链）、`凌统`（`equip_lost` + `ctx.hasRemovableCard`）、
`荀彧`（`after_damage` 补牌）、`卧龙诸葛亮`（纯声明式当牌转换 → `provide_response` 路径）、`刘禅`（`slash_targeted` 取消杀 + 交互弃牌）。

- 新增 `examples/generals/README.md`：机制覆盖矩阵、"仍无样例"清单（`hand_card_lost`/`peach_save`/`before_damage` 与代码版 `discard_phase_start`/`provide_response`）。
- **实测暴露两处引擎能力不对称**（已写进 `docs/generals-pack-api.md` 与 gallery README）：
  ① 触发性技能**无法交互式选目标**（`InteractionRequest` 无"选玩家"），gallery 的选人都照内置「英魂」自动挑选；
  ② `judgment` 钩子只分发给**判定牌归属者**（payload 只有 `actor = owner`），所以外部「鬼道」只能改判自己的判定，内置「鬼才」因在 `game.ts` 里全局搜索而不受限。
- 注：gallery 的 `general.md` 与代码注释已清理"暂存目录"措辞；`general-pack.test.ts`/`generals-check.test.ts` 里钉死"示例包恰好 2 个"的断言已改为"gallery 全员加载成功"。

### 文档漂移修复（A）

- `skill-registry.ts` 的**激昂/魂姿** `description` 与 `triggers` 对齐 `74086e5` 的实现（`rules.md` 由 `rules:gen` 重新生成）。
- `docs/generals-pack-plan.md`：§8 增加"复审更正"、§14 标注被取代、§17 row1/row2/row3/row4/row6 标 ✅、§九基线 206→250、
  §三 类型块改用 `SkillConversion`/`handLimit` 并标注"权威契约在 api 文档"、§九验收明确示例包已回到 0 警告、新增 §20 记录 ②③④ 落点。
- `README.md` §11 与 `docs/generals-pack-api.md`：删掉"龙魂写不出来/`kind: conversion` 尚未被引擎枚举/校验器稳定报 2 条警告"等 Phase 7 之前的说法，补作者资源与"触发性技能不能交互式选目标"。
- **验收题目纠正**：§17 原稿让 subagent 写「张飞 / 司马懿 / 黄月英」，但这三个都是**内置武将名**，外部包同名会被 loader 以"武将名重复"整包拒绝；已改为非内置名（张角 / 凌统 / 卧龙诸葛亮）。

### 联机实测修掉的两个真 bug（跑真服务器 + 真 TCP 客户端发现）

`npm run host -- --players=4 --ai=2 --ai-driver=simple` + 两个自动化真客户端打完整局时暴露：

1. **游戏结束后服务端进程崩溃（exit 1）**：`checkAndHandleGameOver()` 在 `autoRestartAfterGameOver` 下会
   `await` 3 秒再 `restartGame()`，此时挂起的 AI 驱动栈恢复后继续执行 `advanceIfCurrentPlayerDead()`；
   若重开时在线人数不足，`this.game` 是**没有玩家**的空对局 → `currentPlayer` getter 抛
   `current player missing` → 未捕获，进程直接退出。
   修复：`server.ts` 新增 `gameGeneration`（每重开一局 +1）+ `isStaleGame(generation)`
   （换代 / 已结束 / 对局无玩家），并把它接到 `advanceIfCurrentPlayerDead` / `driveAiTurn` /
   `forceEndAiTurn` / `resolveAfterPlay` / `handleDiscard` / `resolveTurnEnd` / `runTurnStart`；
   `isStaleDrive` 也带上对局代号，避免旧循环继续驱动新对局。
2. **铁索连环可指定自己，但 `playAction` 一律拒绝"目标=自己"**：`findTargetsByCard` 按"含自己"枚举
   （与官方规则一致），通用出牌校验却先判 `target.id === player.id → 目标无效`，
   客户端选中后不断收到错误并重发 → 实测出现 3414 次/150 秒的死循环。
   修复：通用校验对 `CardType.IronChain` 放行自己，其他有目标牌仍拒绝。

对应回归测试：`src/engine/game.test.ts`（铁索连环指定自己成功 + 杀打自己仍被拒）、
`src/network/auto-restart.test.ts`（重开留下空对局时旧调用栈不得抛错）。两条用例都验证过"修复前必失败"。

3. **本地启发式 AI 明牌作弊（信息面口径不一致）**：`local-engine`（simple 驱动 / LLM 回退 / 断线托管 /
   hybrid 的本地兜底）的交互决策（桃救谁、决斗是否出杀、借刀选谁、无懈是否反制、群体锦囊净收益）与
   `system-one.relationOf` 都直接读 `player.role`，能看穿所有人的身份；而 LLM 侧（`prompt.maskRole`）
   与 Jev 侧（`jev-advisor`）都是正确遮蔽的。
   修复：`local-engine` 新增 `visibleRole()`（自己/主公/已阵亡 = 公开，其余走 `predictRole()` 行为推断），
   `system-one.relationOf` 改用 `identityGuess`；`evaluateAction` 本来就是用 `predictRole` 的，未动。
   代价：开局没有行为证据时 AI 更"钝"（判不出队友就先当敌人），这是公平的必然结果。
   回归测试：`local-engine.test.ts` 的两条「交换两名存活玩家的隐藏身份不应改变决策 / system-one 敌我关系」，
   已验证"修复前必失败"。

同一轮还确认了两件事：同机单账号守卫按预期工作（第二个同 machineId 连接收到 `closed`「本机已有玩家…在线」）；
30 秒交互超时、AI 托管、座位令牌、`--log-level=info/debug` 均正常。

## 5. 下一步

1. §17 row 5：`priority` 钩子排序（现在 `getPackHooksFor` 只按注册顺序追加，`priority` 完全空转）——实现排序或删字段（`schema` 与 d.ts 也要同步）。
2. Phase 7 残留：`conversions` 只吃一张源牌（龙魂的"至多两张同花色"双牌模式）；`to` 支持延时锦囊/装备（国色的方块当乐不思蜀）。
3. §17 row 7：内置技能模块化迁移（`game.ts` 38 / `resolve.ts` 14 / `skills.ts` 10 / `skill-hooks.ts` 12 个 `hasSkill` 分支）——**已决定先不做**，除非要做"内置与外部能力完全对齐"。
4. 可选：`examples/generals/README.md` 里列的"仍无样例"机制（`hand_card_lost`、`peach_save`、`before_damage`、代码版 `provide_response`）各补一个参考武将。

## 6. 验证命令与当前基线

```bash
npm run typecheck   # 必须干净（当前 0 error）
npm test            # 当前 252 全绿（node --test --import tsx）
npm run lint        # 基线 25 存量错误，不得新增（不改存量）
npm run generals:check -- --dir=examples/generals            # 0 错误 / 0 警告
npm run generals:check -- --dir=examples/generals --selfplay=3
npm run rules:check                                          # rules.md 与注册表同步
npm run host -- --players=3 --generals-pool=all              # 手动验收外部包
```

已知不稳定用例：`src/network/lightning-death.test.ts` 的"闪电在判定阶段劈死玩家"是 90 秒上限的轮询型联机测试，
整包并行 + 机器负载高时偶发超时（单跑约 5s）。重跑即可，不是回归。

## 7. 环境与坑（接手必读）

- **`node_modules` 的平台绑定（本轮再次踩到）**：仓库里的 `node_modules` 如果是在另一个平台装的，测试会直接崩在
  `You installed esbuild for another platform`（本轮本机是 Linux，但 `node_modules/@esbuild` 里只有 `win32-x64`）。
  修法：在目标平台 `npm install`，或最小化补装
  `npm install @esbuild/linux-x64@0.28.1 --no-save --no-audit --no-fund`（**会移除另一个平台的包**，`package.json`/`package-lock.json` 不变）。
- **`npm run dev` 需要 `bun`**；`host/join/webui/test/generals:check/rules:*` 用 `tsx`。
- **`createSkillHooks` 在构造 `SanGuoGame` 时快照外部钩子**：加载武将包必须在建局之前（`loadGeneralPacks` → `new SanGuoGame`）。
  写测试要注册外部技能时，先 `registerPackSkill` 再建对局，否则钩子不会被挂上。
- **注册表挂 `globalThis.__sanguoPackRegistry__`**：热重载会重建 `src/engine` 模块图，挂模块局部变量会失效；
  `reload` 不重新扫 `general-pack` 目录（决策 5）。
- **命名空间技能 id** = `${文件夹}/${技能}`；`Player.skills`/快照/协议存这个 id，展示用 `displayName`。内置技能 id 就是中文名。
- **外部包不能与内置武将同名**（loader 以"武将名重复"整包拒绝）——写 gallery/验收题目时最容易踩。
- **触发性技能没有"交互式选目标"**：`InteractionRequest` 无"选玩家"类型；内置做法是自动挑（英魂）或固定目标（反馈）。
- **`.ts` 技能仅 bun/tsx 可用**（`import type` 运行时被擦除）；跨环境用 `.mjs`，或 `--generals-json-only`。
- **host 默认 `builtin`**、dev 默认 `all`（外部包 = 任意代码执行，联机主机需显式开启）——别写反。
- **TS 严格**：`noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`（可选属性对象展开要 `NonNullable<...>` 或先建对象再条件赋值）；NodeNext ESM 相对导入要带 `.js`。
- **引擎 `decide()` 无 handler 时走 `autoDecision`**：`optional-effect` 默认 `enabled: false`，`respond`/`choose-discard` 默认选第一个来源。
  写测试注意，否则会出现"AI 自动救人"假象；真实对局每个座位都有 handler。
- **`schema/` 与 `types/` 不在 `tsc` 覆盖范围内**（与 `generals/` 同类）：`types/generals-pack.d.ts` 的语法/类型正确性由
  `src/tools/generals-pack-types.test.ts` 用 TS 编译器 API 独立校验；`schema/*.json` 由 `pack-schema.test.ts` 校验。
  新增声明式规则/触发点时，这两个测试会直接失败——别只改 `src/`。
- **改测试数量时同步** `AGENTS.md` 与计划 §九的基线数字（当前 **252**）。
- **改动外部武将/技能/卡牌时同步** `docs/generals-pack-api.md`、`AGENTS.md`、`README.md`、`schema/`、`types/generals-pack.d.ts`。
