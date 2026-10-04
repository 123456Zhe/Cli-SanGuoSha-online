# 交接文档（给接手的 agent）

> 目的：让一个**没有上下文**的 agent 读完本文 + 下列材料后即可继续开发。
> 当前分支 `main`，最新提交 `b0cfad5`；**M1 + M2 全部改动尚未提交**（33 个文件变动/新增，见 §4）。

## 0. 一句话状态

「武将包与技能模块化」计划的 **M1（契约 + AI 认识本局武将）与 M2（外部武将包进游戏）已完成并验证**：`typecheck` 干净、`npm test` **157 全绿**、`lint` 25 存量错误（无新增）。下一步是 **M3（声明式技能规则数据化）**。

## 1. 必读材料（按顺序）

1. `AGENTS.md` — 命令、架构、约定、坑（**先读这个**，是给 agent 的项目宪法）。
2. `README.md` — 启动流程、§8 规则→代码映射、§11 外部武将包。
3. `docs/generals-pack-plan.md` — **总计划**（M1–M5 分阶段、决策表、遗留问题、验收门槛）；M1 见 §12、M2 见 §13。
4. `docs/generals-pack-api.md` — 外部武将包契约、`SkillModule`/Context 能力清单、隐式约定。
5. `docs/m2-progress-handoff.md` — M2 实施细节（历史记录，已完成）。
6. `rules.md` — 规则参考（help 文本与 AI prompt 用；文档以当前实现为准）。
7. `docs/interaction-refactor-plan.md` — 联机交互协议设计背景。

## 2. 项目是什么

CLI 三国杀（TypeScript，NodeNext ESM），主机权威的**在线多人** + LLM 驱动 AI。
- 纯引擎逻辑在 `src/engine/`（无 I/O，context-interface 模式）。
- `src/agent/` = LLM/Jev/本地策略；`src/network/` = 主机权威 TCP；`src/ui/app.ts` = OpenTUI CLI；`src/webui/` + `webui/` = WebUI。

## 3. 已完成（M1 + M2）

- **M1**：`skill-registry.ts`（45 技能元数据 + 双向校验）、`match-context.ts`（按快照 `player.skills` 生成"本局武将技能"，剔除 `rules.md` §14/§16.3，总长 4000 上限）、AI 三处消费点接线。
- **M2**：
  - 类型：`SkillName` 由 enum 改 `const` 对象 + `SkillId`/`BuiltinSkillId`/`KINGDOM`；`Player.skills`/`kingdom` 改 string；`resolveGeneralByName` 未知名字改抛错。
  - 运行时：`skill-module.ts`（`SkillModule`/`SkillModuleCtx` + 注册表挂 `globalThis.__sanguoPackRegistry__`）；`skill-hooks.ts` 每触发点追加包钩子；`game.ts` 枚举外部 `active` 技能；`skills.ts` 委托外部 `play`（try/catch 不炸对局）。
  - loader：`general-pack.ts`（扫描 `generals/*/general.json`、schema 校验、命名空间 id `${文件夹}/${技能}`、每包 try/catch 隔离、重名跳过、`pool/jsonOnly/strict`）。
  - 入口接线：`src/index.ts`（dev 默认 `pool:"all"`）与 `src/network/host.ts`（host 默认 `pool:"builtin"`）均在构造前 `await loadGeneralPacks`。
  - 示例：`examples/generals/吕蒙/`；测试：`general-pack.test.ts` + `pack-skill-exec.test.ts`（共 11 例）。

## 4. 当前未提交的改动（33 项）

- 新增：`src/engine/{general-pack.ts,skill-module.ts,skill-registry.ts,general-pack.test.ts,pack-skill-exec.test.ts,skill-registry.test.ts}`、`src/agent/{match-context.ts,match-context.test.ts}`、`docs/{generals-pack-api.md,m2-progress-handoff.md,handoff.md}`、`examples/`。
- 修改：`AGENTS.md`、`README.md`、`docs/generals-pack-plan.md`、`src/index.ts`、`src/network/host.ts`，以及 M1/M2 涉及的 `src/engine/*`、`src/agent/*`、`src/network/server.ts`、`src/ui/app.ts`。
- **接手第一步建议：先跑 `npm test` 确认 157 全绿，再决定是否提交。**

## 5. 下一步（按计划）

**M3 — 声明式技能（Phase 3，关键路径）**，`docs/generals-pack-plan.md` §四 row 13 + §三 词汇表：
- 建"谓词查询层"（约 8 个查询）把硬编码规则数据化：`distanceDelta`（马术，现硬编码 `resolve.ts computeDistanceBetween`）、`slashLimitExempt`（咆哮，5 处 `game.ts`）、`responseMultiplier`（无双）、`targetImmunity`（空城/谦逊）、`damageDelta`（裸衣/酒）、`peachSaveBonus`（救援）、`drawPhaseDelta`（英姿/裸衣，已在 skill-hooks）、`trickDistanceExempt`（奇才，已实现）。
- 让 `.skill.json` 的 `rules` 真正参与结算（目前只加载保留）。
- 需要：外部包 `rules` 的 schema 校验 + 内置武将的等价迁移。

**M4 — 可批量生成（Phase 5）**：`npm run generals:check <dir>` 独立校验器 + headless 自对弈不变量断言 + 从注册表生成 `rules.md` §14/§16.3。

**M5 — 拦截点（Phase 6，按需）**：`onJudgment`/`onLoseHandCard`/`onLoseEquip`/`onSlashTargeted`/`onPeachSave`/`provideResponse`/`onCardUsed`。

**M2 明确未做**：`local-engine.ts` 仍读静态规则文本（未接入 `matchGeneralsText`）；`priority` 钩子顺序无快照测试。

**遗留 bug/文档漂移**（`docs/generals-pack-plan.md` §八，7 项）：强袭已实现但无武将拥有；`rules.md` 孙策/曹仁条目漂移；遗计"可分配"vs 实现"自己摸 2"；主公 +1 体力上限未实现；决斗触发激昂恒判红；魂姿只在 `turn_start` 检查 `hp===1`。

## 6. 验证命令与当前基线

```bash
npm run typecheck   # 必须干净（当前 0 error）
npm test            # 当前 157 全绿（node --test --import tsx）
npm run lint        # 基线 25 存量错误，不得新增（不改存量）
npm run host -- --players=3 --generals-pool=all   # 手动验收外部包
```

## 7. 环境与坑（接手必读）

- **node_modules 是跨平台的**：仓库里的 `node_modules` 曾在 Windows 安装（`@esbuild/win32-x64`），在 Linux 下所有测试报 "You installed esbuild for another platform"。当前已补装 `@esbuild/linux-x64@0.28.1`（未改 `package.json`/`package-lock.json`）；换平台需重新 `npm install`。
- **`npm run dev` 需要 `bun`**；`host/join/webui/test` 用 `tsx`。
- **注册表挂 `globalThis.__sanguoPackRegistry__`**：热重载会重建 `src/engine` 模块图，挂模块局部变量会失效；`reload` 不重新扫 `general-pack` 目录（代码热重载不维护，决策 5）。
- **命名空间技能 id** = `${文件夹}/${技能}`；`Player.skills`/快照/协议存这个 id，展示用 `displayName`。内置技能 id 就是中文名。
- **`.ts` 技能仅 bun/tsx 可用**（`import type` 运行时被擦除）；跨环境用 `.mjs`，或 `--generals-json-only`。
- **host 默认 `builtin`**、dev 默认 `all`（外部包 = 任意代码执行，联机主机需显式开启）——实现时别写反。
- **TS 严格**：`noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`（可选属性对象展开要 `NonNullable<...>` 或先建对象再条件赋值）；NodeNext ESM 相对导入要带 `.js`。
- **引擎 `decide()` 无 handler 时走 `autoDecision`**：写测试注意，否则会出现"AI 自动救人"假象；真实对局每个座位都有 handler。
- 改动外部武将/技能/卡牌时同步 `docs/generals-pack-api.md`、`AGENTS.md`、`README.md`。
