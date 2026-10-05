# 武将包与技能模块化计划

> 目标：让**武将 = 一个文件夹**（`generals/<武将名>/`），`general.json` 声明元数据与技能列表，技能各自成文件（JSON 或代码）；新增武将/技能不需要改本项目的 `src/`，也不需要重新编译。同时让**局内 AI 只注入本场出现的武将及其关联技能说明**，取代现在从 `rules.md` 注入全量武将知识的方式。

状态：**M1（Phase 0 + Phase 4）已完成**（见 §12）；**M2（Phase 1 + Phase 2）已完成**（见 §13）；**M3（Phase 3 谓词层 + §8 规则修复）已完成**（见 §14）；**Phase 6 拦截点（按需子集）与 §四 row 14 的本地策略尾巴已完成**（见 §15）；**M4（Phase 5 校验器 / 自对弈 / 文档生成）已完成**（见 §16）；下一步的关键缺口与排序见 §17，`神赵云` 实测见 §18。附带的两项规则修正已完成，见 §7。

## 一、已确认的决策

| # | 决策 | 说明 |
|---|------|------|
| 1 | 技能文件形态：**`.json` 与 `.ts`/`.mjs` 都允许** | `.ts` 依赖 bun/tsx 运行时（本项目 `dev`=bun、`host/join/webui`=tsx，均可用）；文档标注 `.ts` 仅开发环境，跨环境分发用 `.mjs` |
| 2 | 外部武将**默认进入随机抽将池** | 作者自行先用 AI 审核武将包，本项目不做人工准入；提供 `--generals-pool=builtin` 作为临时排除开关 |
| 3 | 奇才 + 距离限制**先修掉** | 已完成，见 §7 |
| 4 | 武将**不复用**既有技能 | 每包自带技能；技能 id 内部命名空间化（`吕蒙/克己`），显示名才是中文 |
| 5 | 代码热重载**不维护** | 引擎热重载不纳入本计划的验收项；但"改完 JSON 重读生效"会作为后续独立小需求 |
| 6 | 内置武将**留在 `src/engine`** | 与外部包共用同一 descriptor / 注册表接口，但走 TS 以保留 `tsc` 静态检查；外部包走运行时 schema 校验 |

## 二、目录与文件格式

```
generals/                      # 项目根目录（在 src 之外，天然不进 typecheck/lint/test/build）
  吕蒙/
    general.json               # 元数据 + 技能声明
    克己.skill.json            # 声明式技能
    涉猎.skill.ts              # 代码技能（或 .skill.mjs）
    general.md                 # 可选：给 UI/AI 的描述文本
```

`general.json`：

```json
{
  "apiVersion": 1,
  "name": "吕蒙",
  "kingdom": "吴",
  "gender": "男",
  "maxHp": 4,
  "skills": ["克己", "涉猎"],
  "description": "吴国武将，善于据守与突袭。"
}
```

`克己.skill.json`（声明式）：

```json
{
  "id": "克己",
  "displayName": "克己",
  "kind": "triggered",
  "triggers": ["turn_start"],
  "optional": true,
  "priority": 100,
  "description": "若你未于出牌阶段使用或打出过杀，你可以跳过弃牌阶段。",
  "rules": { "skipDiscardPhaseIfNoSlash": true }
}
```

`涉猎.skill.ts`（代码）：

```ts
import type { SkillModule } from "<引擎类型入口>";

export default {
  id: "涉猎",
  displayName: "涉猎",
  kind: "active",
  oncePerTurn: true,
  requiresTarget: false,
  label: "发动涉猎（摸牌阶段改为观看牌堆顶若干张）",
  description: "出牌阶段限一次，你可以观看牌堆顶若干张牌……",
  canUse: (ctx, player) => player.hand.length > 0,
  play: async (ctx, player) => { /* 只能通过 ctx 的能力清单操作 */ return ["……"]; },
} satisfies SkillModule;
```

规则：

- **一个技能一个文件，二选一**（JSON 或代码），不要 `rules.json` + `handler.ts` 成对出现，避免双源真相。
- 技能身份 = `<文件夹名>/<skillId>`；快照/协议/UI/AI 一律使用 `displayName`。
- `description` **必填**（AI 与 UI 的唯一来源，见 §6）。
- 代码技能只能用 `ctx` 暴露的能力，**禁止 `Math.random`**（用 `ctx.randomIndex`），否则 `--seed` 复现与联机一致性失效。

## 三、技能描述符契约

```ts
type SkillKind = "active" | "triggered" | "conversion" | "passive" | "lord";

type SkillModule = {
  id: string;
  displayName: string;
  kind: SkillKind;
  description: string;            // 必填
  priority?: number;              // 钩子执行顺序（默认 100，升序）
  oncePerTurn?: boolean;
  optional?: boolean;             // 需要"是否发动"询问
  triggers?: SkillTrigger[];      // 基础 4 个触发点 + Phase 6 的 7 个拦截点（同一套 onTrigger）
  requiresTarget?: boolean;
  targetIntent?: "enemy" | "ally" | "any";  // 主动技能目标取向（供 AI 选目标）
  label?: string;                 // 出牌动作标签（原 game.ts 手写标签迁到此处）
  rules?: SkillRules;             // 声明式数值/豁免
  canUse?(ctx, player): boolean;
  play?(ctx, player, targetId?): Promise<string[]>;
  onTrigger?: Partial<Record<SkillTrigger, SkillHook>>;
  conversions?: ConversionRule[]; // 当牌规则（未实现，走代码技能）
};
```

> Phase 6 实现时没有另开 `interceptors` 字段：拦截点与触发点共用 `onTrigger` 与同一张钩子表，
> 区别只在 payload 里是否有"可改写/可否决"的字段（如 `skipDiscardPhase`、`canceled`、`judgmentCard`）。
> 这样 loader 校验、注册表、AI 提示、测试桩全部复用同一条路径。

`SkillRules` 词汇表（Phase 3 目标；"现状"列指今天的实现位置）：

| 字段 | 语义 | 使用者 | 现状 |
|---|---|---|---|
| `distanceDelta` | 计算距离时 -N | 马术 | 硬编码于 `computeDistanceBetween`（resolve.ts） |
| `trickDistanceExempt` | 使用受距离限制的锦囊无距离限制 | 奇才 | **已实现**（硬编码于 `resolve.canReachForDistanceOneTrick`） |
| `slashLimitExempt` | 出牌阶段杀无次数限制 | 咆哮 | 硬编码 5 处（game.ts） |
| `responseMultiplier` | 需 N 张闪/杀响应 | 无双 | 硬编码于 resolveSlash/resolveDuel |
| `targetImmunity` | 不能成为某些牌的目标 | 空城、谦逊 | 硬编码于 `findTargetsByCard` + 结算层 |
| `drawPhaseDelta` | 摸牌阶段 ±N | 英姿、裸衣 | 钩子（skill-hooks.ts） |
| `damageDelta` | 杀/决斗伤害 ±N | 裸衣、酒 | 硬编码于 resolveSlash/resolveDuel |
| `peachSaveBonus` | 被桃救时额外回复 | 救援 | 硬编码于 resolve.ts |
| `skipDiscardPhaseIfNoSlash` | 未出杀时可跳过弃牌阶段 | 克己（示例包） | ✅ Phase 6（`game.endPlayPhase`） |

**能力清单（Context API）必须写进 API 文档**，尤其"调用方还需要自己做什么"这类隐式约定，例如：
`requestDiscardSelection` 返回的牌**不会自动进弃牌堆**，调用方必须自己 `discardPile.push`（见 `skills.ts` 现有写法）；伤害后必须走 `resolveDeaths` → `resolveWinner` → `advanceIfCurrentPlayerDead`；失去手牌必须走 `removeHandCardAt`，否则连营不触发。

## 四、引擎侧改动清单

| # | 改动 | 位置 | 阶段 |
|---|------|------|------|
| 1 | `SkillDescriptor` / `SkillRules` / `SkillModule` 类型 + JSON Schema | 新增 `src/engine/skill-registry.ts` | 0 |
| 2 | 内置 44 个技能的元数据登记（`kind`/`triggers`/`optional`/`description`） | 同上 | 0 |
| 3 | 双向校验单测：①武将声明的技能都有实现 ②已实现技能都有归属或白名单 | `src/engine/*.test.ts` | 0 |
| 4 | API 文档 + doc-conformance 测试 | 新增 `docs/generals-pack-api.md` | 0 |
| 5 | `SkillName` 枚举 → `const SkillName = {...} as const` + `type SkillId = string`（保持 `SkillName.X` 写法，测试零改动） | `types.ts` | 1 |
| 6 | `Player.skills: string[]`、`GeneralDefinition.skills: string[]`、`GameAction.skill: SkillId` | `types.ts` | 1 |
| 7 | `kingdom: string` + 求援响应映射表（现硬编码 `"魏"/"蜀"/"吴"`） | `resolve.ts`、`skills.ts` | 1 |
| 8 | `resolveGeneralByName` 未知名字改为抛错（现静默回落孙策，会让势力判断错成吴） | `generals.ts:82` | 1 |
| 9 | 武将包 loader：扫描 `generals/*/general.json`、schema 校验、技能文件加载（`await import(pathToFileURL(...))`）、命名空间 id、**每包 try/catch 隔离** | 新增 `src/engine/general-pack.ts` | 2 |
| 10 | 异步预载 `loadGeneralPacks()`，在 UI/Game 构造前完成；`getGeneralLibrary()` 保持同步（读已加载池） | `src/index.ts`、`src/network/host.ts`、`src/ui/app.ts:131` | 2 |
| 11 | 开关：`--generals-dir`、`--generals-pool=all\|builtin`（默认 all）、`--generals-json-only`、`--strict-generals` | 同上 + `host.ts` | 2 |
| 12 | 抽将/选将池合并 + 按 id 排序保证确定性 | `game.ts`（`initDefaultGame`/`initNetworkGame`）、`generals.ts` | 2 |
| 13 | 谓词查询层（8 个）+ `SkillRules` 数据化 | `resolve.ts`、`game.ts`、`skills.ts` | 3 |
| 14 | AI 动态技能说明（详见 §6） | `src/agent/match-context.ts`（新增）、`prompt.ts`、`ai.ts`、`local-engine.ts`、`jev-advisor.ts`、`server.ts`、`app.ts` | ✅ 4（`local-engine.ts` 见 §15 补齐） |
| 15 | `rules.md` §14/§16.3 改为由注册表 + 武将库生成 | 新增生成脚本 | ✅ 4/5（`src/tools/gen-rules.ts` + `rules:gen`/`rules:check` + 漂移测试，见 §16） |
| 16 | 独立校验器 `npm run generals:check <dir>` + headless 自对弈不变量断言 | 新增 `src/tools/generals-check.ts` | ✅ 5（`--json`/`--strict`/`--selfplay=N`，见 §16） |
| 17 | 拦截点：`judgment`、`hand_card_lost`、`equip_lost`、`slash_targeted`、`peach_save`、`card_used`、`discard_phase_start` | `resolve.ts`、`game.ts`、`skill-hooks.ts`、`types.ts` | ✅ 6（`provideResponse` 未做，见 §15） |

## 五、阶段与里程碑

| 里程碑 | 阶段 | 产出 | 估时 |
|---|---|---|---|
| **M1** 契约 + AI 认识本局武将 | 0 + 4 | ✅ 已完成（见 §12）：注册表 + 动态技能注入；AI 不再依赖 `rules.md` 武将章节 | 1 天 |
| **M2** 外部武将包进游戏 | 1 + 2 | ✅ 已完成（见 §13）：放个文件夹就能选将/对局/触发技能 | 1 天 |
| **M3** 声明式技能 | 3 | ✅ 已完成（见 §14）：`SkillRules` 词表 + 谓词层，8 条硬编码规则数据化 | 半天 |
| **M4** 可批量生成 | 5 | ✅ 已完成（见 §16）：独立校验器（真实 loader + 静态 lint + 可选自对弈）+ headless 自对弈不变量断言 + `rules.md` 生成 | 半天 |
| M5 | 6 | ✅ 已完成按需子集（见 §15）：7 个拦截点；`provideResponse` 待做 | 按需 |

关键路径 `0 → 1 → 2 → 3 → 5`；**Phase 4 只依赖 Phase 0，可与 Phase 2 并行**。

## 六、AI 侧：只注入本场武将的技能

- **数据源以快照 `player.skills` 为准**，不是武将定义 —— 这样魂姿觉醒获得的英姿/英魂、以及未来任何"临时获得技能"都自动覆盖。
- 新增 `match-context.ts`：从快照收集本场全部技能 id → 查注册表取 `displayName + description` → 生成"本局武将技能"文本块；**设总长上限**（武将多时截断，避免炸上下文）。
- `prompt.ts` 把 `rulesText` 拆两块：`baseRules`（卡牌/流程，来自 `rules.md`，**剔除 §14 与 §16.3**）+ `matchGeneralsText`（动态）。
- 三处消费点同步：LLM（`ai.ts`/`prompt.ts`）、本地策略（`local-engine.ts` 的 `getMatchGeneralsText()` + 技能元数据）、Jev（`jev-advisor.ts` 的 `state.rules` 与 `match_skills`）；构造入参在 `server.ts:180-201` 与 `app.ts:132-134`。
- 验收：prompt 单测断言"在场武将的技能说明出现、未出场武将不出现、觉醒获得的技能出现"；把 `rules.md` §14 整段删除后 AI 行为不受影响。

## 七、已完成的规则修正（本次）

| 项 | 内容 | 落点 |
|---|---|---|
| 顺手牵羊距离限制 | 只能对距离 1 以内的角色使用 | 目标筛选 `game.ts findTargetsByCard`、动作校验 `game.ts playAction`、结算兜底 `resolve.resolveSnatch` |
| 兵粮寸断距离限制 | 同上（乐不思蜀不受限） | `resolve.resolveDelayedTrick` + `findTargetsByCard` |
| 奇才 | 锁定技：使用受距离限制的锦囊（顺手牵羊/兵粮寸断）无距离限制 | `resolve.canReachForDistanceOneTrick` |
| 新增纯谓词 | `card-utils.isDistanceOneTrickCard` | `card-utils.ts` |
| 测试 | `src/engine/trick-distance.test.ts`，6 例：默认受限 / -1 马 / 奇才豁免 / 兵粮寸断 / 乐不思蜀不受限 / 结算层兜底 | 当时基线 **140 tests 通过**（当前基线见 §九） |
| 文档 | `rules.md` §13.2、§13.2.1、§14.2 同步；`AGENTS.md` 测试数更新为 140 | — |

Phase 3 会把上述硬编码改造成 `trickDistanceExempt` 数据字段，行为不变。

## 八、遗留问题（Phase 0 的双向校验应当抓出）

| # | 问题 | 现状 |
|---|------|------|
| 1 | **强袭（Assault）已实现但无任何武将拥有** | 仅测试手动塞技能可达；`generals.ts` 无人声明 `Assault` |
| 2 | `rules.md` §14.3 写"孙策：英姿、强袭"，实际孙策是 **激昂/魂姿/制霸** | 文档漂移 |
| 3 | `rules.md` §14.1 **漏了曹仁**（据守/解围） | 文档缺失 |
| 4 | `rules.md` §14.1 写遗计"可分配给任意角色"，实现是**固定给自己摸 2 张** | 文档与实现冲突（需裁决改哪边） |
| 5 | 主公 +1 体力上限未实现（`rules.md` §3.4 有该规则） | 规则缺口 |
| 6 | 决斗触发激昂时未判红色（`resolve.ts` `qualifies` 恒真） | 裁定偏差 |
| 7 | 魂姿只在 `turn_start` 检查 `hp === 1` | 回合外掉血要等下个回合开始才觉醒 |

**以上 7 项已在 M3 一并处理**（见 §14）：#1 受控常量、#2/#3/#4 文档修正、#5/#6/#7 代码修复。

## 九、验收门槛（每个阶段）

- `npm run typecheck` 干净
- `npm test` 全绿（**当前基线 206**；新增用例同步更新 `AGENTS.md` 计数）
- `npm run lint` 不新增错误（存量 25 个不动）
- 新增逻辑不引入 `no-explicit-any`、不引入浮动 Promise
- 武将包相关改动：`npm run generals:check -- --dir=examples/generals` **0 错误**（当前基线 2 个警告，均为神赵云 `龙魂` 的已知 `conversion` 缺口；新增警告视同回归）
- 改过技能 `description` / 武将库：`npm run rules:check` 干净（`rules.md` §14/§16.3 是生成物）
- 涉及线协议时：只做等价替换或加可选字段，**不 bump** `NETWORK_PROTOCOL_VERSION`，并同步 `webui/src/protocol.ts`

## 十、不做的事

- 维护代码热重载（决策 5）
- 技能继承/复用机制（决策 4）
- 自造脚本 DSL（等价于发明语言，`tsc` 与测试网全部失效）
- `dist/` 运行支持（当前没有任何 script 在跑 dist）
- 数值平衡调整

## 十一、风险与对策

| 风险 | 对策 |
|---|---|
| 代码技能 = 任意代码执行（读写文件/发网络请求） | 本地单机随意；联机主机加载他人包时提供 `--generals-json-only`，加载前显式提示 |
| 外部 `.ts` 技能在 `dist`/纯 node 下加载失败 | 文档标注 `.ts` 仅开发环境；跨环境用 `.mjs` |
| 钩子顺序变化导致行为变更 | `priority` 显式声明 + 顺序快照测试 |
| 100 个武将 = 250+ 技能文件，人工 review 不现实 | 依赖 §16 校验器 + headless 自对弈不变量断言，而不是人读 |
| 中文技能名做唯一键易冲突 | 内部命名空间 id；显示名仅用于展示与 prompt |
| AI 上下文膨胀 | §6 的总长上限 + 只注本场武将 |
| `SkillName` 改动波及 20+ 测试 | 保留 `const` 常量对象写法，测试零改动 |
| 坏包导致服务器崩溃 | 每包 try/catch 隔离 + 报告；CI 用 `--strict-generals` |

## 十二、M1 完成情况（Phase 0 + Phase 4）

已完成，落点：

- `src/engine/skill-registry.ts` — `SkillKind` / `SkillDescriptor` + 45 个技能的元数据（`description` **以代码行为为准**；已知文档漂移按实现写并标 `NOTE(§8歧义N)`：孙策=激昂/魂姿/制霸、遗计=自己摸 2、激昂决斗恒判红）。导出 `SKILL_REGISTRY` / `describeSkill`。
- `src/engine/skill-registry.test.ts` — 双向校验：①武将声明的技能都有登记 ②无归属技能必须在白名单。白名单当前为 `强袭`（§8 问题 1）与 `英魂`（仅魂姿觉醒获得），把问题 1 变成了受控断言。
- `src/agent/match-context.ts` — `stripGeneralsSections`（加载时剔除 `rules.md` §14 与 §16.3，文件原件不动，`/help` 仍显示全文）+ `buildMatchGeneralsText`（按快照 `player.skills` 去重生成，总长上限 4000 字符）。
- `docs/generals-pack-api.md` — 契约与 Context 能力清单骨架（含隐式约定）。
- 接线：`prompt.ts` 4 个 builder 各加可选 `matchGeneralsText` 注入 systemPrompt；`ai.ts` 4 处调用点每次用快照生成（觉醒获得的技能自动生效）；`jev-advisor.ts` 给 Jev state 加 `match_skills`；`server.ts loadRules()` 与 `app.ts baseRulesText` 改用剥离后的基础规则。
- 测试 140 → **146**（新增 6 例），`typecheck` 干净，lint 仍 25 个存量错误（无新增）。

M1 明确未做（留给后续阶段）：`local-engine.ts` 仍读静态规则文本；`SkillName` 枚举/`Player.skills` 类型/抽将逻辑未动；`SkillRules` 数据化（Phase 3）与拦截点（Phase 6）未做。

## 十三、M2 完成情况（Phase 1 + Phase 2）

已完成，落点：

- **Phase 1 类型与 kingdom**：`types.ts` 的 `enum SkillName` → `const SkillName = {...} as const`（`SkillName.X` 值与 `SkillName[]` 类型标注零改动）；新增 `SkillId`/`BuiltinSkillId`/`KINGDOM`；`Player.skills`/`GameAction.skill`/`GeneralDefinition.kingdom|skills` 改为字符串；`generals.ts` 的 `GENERAL_LIBRARY` 改为可变池（`getBuiltinGenerals`/`setLoadedGenerals`/`resetLoadedGenerals`），`resolveGeneralByName` 未知名字**改抛错**；`resolve.ts`/`skills.ts` 的硬编码势力名改用 `KINGDOM.*`。
- **外部技能运行时**：`skill-module.ts`（`SkillModule`/`SkillModuleCtx` + 注册表挂 `globalThis.__sanguoPackRegistry__`）；`skill-hooks.ts` 每个触发点追加包钩子；`game.ts` 在 `getPlayableActions` 枚举外部 `active` 技能；`skills.ts` 的 `useSkillAction` 委托包 `play`（try/catch 不炸对局）；`skill-registry.ts` 加 `resolveSkillDescriptor`（外部→内置→兜底）；`match-context.ts` 改用 `resolveSkillDescriptor`。
- **loader**：`general-pack.ts`（`loadGeneralPacks`/`resetGeneralPacks`）扫描 `generals/*/general.json`、schema 校验、`.skill.json|.ts|.mjs` 加载、命名空间 id `${文件夹}/${技能}`、每包 try/catch 隔离、重名跳过、`jsonOnly`/`strict`/`pool` 开关。
- **接线**：`src/index.ts`（dev 默认 `pool:"all"`）与 `src/network/host.ts`（host 默认 `pool:"builtin"`）均在构造 `SanGuoGame`/`GameServer` **之前** `await loadGeneralPacks`；开关 `--generals-dir` / `--generals-pool` / `--generals-json-only` / `--strict-generals`。
- **示例**：`examples/generals/吕蒙/`（`general.json` + `克己.skill.json` 声明式 + `涉猎.skill.ts` 代码主动技能 + `general.md`）。
- **测试**：新增 `general-pack.test.ts`（7 例）与 `pack-skill-exec.test.ts`（4 例），146 → **157**，`typecheck` 干净，lint 无新增。
- **文档**：`docs/generals-pack-api.md` 补全契约/Context/命名空间/开关；`README.md` §11；`AGENTS.md`。

M2 明确未做：声明式 `.skill.json` 的 `rules` 只加载保留、不参与结算（Phase 3）；`local-engine.ts` 仍读静态规则文本；`priority` 钩子顺序未做快照测试（Phase 3/4）。

## 十四、M3 完成情况（Phase 3 谓词层 + §8 规则修复）

已完成，落点：

- **`SkillRules` 词汇表**（`skill-registry.ts`）：`distanceDelta`/`trickDistanceExempt`/`slashLimitExempt`/`responseMultiplier`/`targetImmunity`/`drawPhaseDelta`/`damageDelta`/`peachSaveBonus` + `TargetImmunityCard`；`SkillDescriptor.rules?` 与 `SkillModule.rules?` 改为强类型；内置技能填数值（马术/咆哮/无双/空城/谦逊/奇才/救援/裸衣/英姿）。
- **谓词层**（新 `skill-rules.ts`）：`getSkillRules(player)`（求和/OR/取最大/并集）、`sumActivatedRules(player, key, isUsed)`（裸衣等「发动后生效」）、`isImmuneTo(player, card)`；经 `resolveSkillDescriptor` 合并，内置与外部包统一。
- **调用点迁移（行为不变）**：`resolve.ts`（马术距离、奇才锦囊减免、无双响应数、裸衣伤害、空城/谦逊免疫、救援回复、激昂决斗判色）、`game.ts`（咆哮次数豁免 5 处、空城/谦逊目标筛选、主公 +1 体力）、`skills.ts`（`canPlaySlashInTurn`）、`skill-hooks.ts`（英姿/裸衣摸牌数值、魂姿即时觉醒）。
- **外部 `rules` 校验**（`general-pack.ts validateRules`）：未知键/类型不符/非法 `targetImmunity.cards` → 抛错（隔离进 `report.errors`，`--strict-generals` 整体失败）；`examples/generals/吕蒙/克己.skill.json` 已改为不含无效 rules。
- **§8 修复**：`UNOWNED_BUILTIN_SKILLS`（强袭/英魂）替代测试白名单；主公 ≥5 人局 +1 体力上限；激昂决斗按牌色判定（无牌来源的技能型决斗不触发）；魂姿掉血到 1 即时觉醒；`rules.md` 孙策/曹仁/遗计条目修正。
- **测试**：新增 `skill-rules.test.ts`（4）、`m3-rule-fixes.test.ts`（3，覆盖主公体力/激昂判色/魂姿），`general-pack.test.ts` +3（rules 校验），157 → **167**，`typecheck` 干净，lint 无新增。

M3 明确未做：非 `rules` 词汇表可表达的效果（如克己跳弃牌、反击类）仍待 **Phase 6 拦截点**；`local-engine.ts` 仍读静态规则文本；`priority` 钩子顺序快照测试未做（Phase 4）。

## 十五、Phase 6 拦截点（按需子集）+ row 14 收尾

已完成，落点：

- **触发点/拦截点合并为一套机制**：`types.ts` 新增 `SKILL_TRIGGERS` 常量数组（`SkillTrigger` 由它派生，单一真相），4 个基础触发点 + 7 个拦截点：
  `judgment`（改判：payload `judgmentCard` 可替换）、`slash_targeted`（payload `canceled` 可取消杀）、
  `hand_card_lost`、`equip_lost`（payload `equip`）、`card_used`（payload `reason` = 使用/打出）、
  `peach_save`（payload `peachSaveBonus` 累加回复）、`discard_phase_start`（payload `skipDiscardPhase` 跳弃牌）。
  没有另开 `interceptors` 字段：loader 校验、注册表、AI 提示、测试桩全部复用既有 `onTrigger` 路径。
- **emit 位置**：`judgment`/`hand_card_lost`/`card_used`/`discard_phase_start` 在 `game.ts`；
  `slash_targeted`/`equip_lost`/`peach_save` 在 `resolve.ts`（`ResolveContext` 新增 `emitSkillTrigger`）。
  `skill-hooks.ts` 的 pack 钩子分发改为遍历 `SKILL_TRIGGERS`（原 `PACK_TRIGGERS` 局部清单已删）。
- **使用 vs 打出（克己判定用）**：新增 `slashPlayedThisTurn`（打出响应杀，与出牌阶段"使用"的 `slashUsedThisTurn` 分开），
  在 `consumeResponseCard` 里置位，`card_used` 同处发出——克己的"使用**或打出**过杀"才判得准。
- **声明式规则 `skipDiscardPhaseIfNoSlash`**：`skill-registry.ts` 词表 + `skill-rules.ts` 谓词层（OR 合并）+
  `findSkillWithBooleanRule(player, key)` 定位归属技能 + `general-pack.ts` schema 校验；
  `game.endPlayPhase` 两条路径（代码钩子 / 声明式规则）任一命中即跳过弃牌阶段。
  **示例包 `examples/generals/吕蒙/克己.skill.json` 由此真正生效**（原计划 §二 的示例写法终于兑现）。
- **`targetIntent`**（`enemy`/`ally`/`any`）：`SkillDescriptor` + `SkillModule` + loader 校验 + 内置 7 个主动技能标注
  （强袭/反间/离间=enemy，青囊/仁德/结姻/制霸=ally）。
- **row 14 收尾（`local-engine.ts`）**：`getMatchGeneralsText()` 持有与 LLM/Jev 同源的在场技能文本（按快照签名缓存）；
  `evaluateAction` 用 `resolveSkillDescriptor` 读技能元数据，支援技按 `ally` 选目标（修掉了"青囊丢给敌人"的旧启发式）。
- **测试**：新增 `phase6-interceptors.test.ts`（14 例，含"加载 examples 后克己在真实对局里生效"的端到端用例）、
  `general-pack.test.ts` +5、`local-engine.test.ts` +2，167 → **188**，`typecheck` 干净，lint 仍是 25 个存量错误（无新增）。

Phase 6 明确未做：`provideResponse`（技能提供响应牌，需要改交互管线：请求牌前先问技能能否代为响应）；
`priority` 钩子顺序快照测试；声明式 `conversions`（当牌规则）。

已知不稳定用例：`src/network/lightning-death.test.ts` 的"闪电在判定阶段劈死玩家"是 90 秒上限的轮询型联机测试，
在整包并行跑 + 机器负载高时偶发超时（单跑 ~5s）；重跑即可，不是回归。

## 十六、M4 完成情况（Phase 5 校验器 / 自对弈 / 文档生成）

已完成，落点：

- **文档生成**（新 `src/tools/gen-rules.ts` + `npm run rules:gen` / `rules:check`）：`rules.md` §14（按势力的武将+技能详细说明）
  与 §16.3（武将速查）改为**从武将库 + 技能注册表生成**，只替换 `<!-- GENERATED:… -->` 标记之间的内容
  （标记缺失即报错，宁可失败也不误删文档）；生成幂等，`--check` 用首个不同行报错。
  顺带修掉 §14 的顺序漂移与 §16.3 缺曹仁的漂移。**技能 `description` 从此是文档的唯一定义**（rules.md 说"以代码行为准"）。
- **独立校验器**（新 `src/tools/generals-check.ts` + `npm run generals:check -- --dir=<dir>`）：
  ①调用**真实 loader** 拿权威错误；②静态 lint 抓 loader **静默吞掉**的写法——未知触发点名（`triggers.filter` 会丢掉）、
  未知顶层字段（拼错 `rule`/`trigers`/`titel`）、`.skill.json` 与 `.skill.ts` 双源真相、`kind: "active"` 但无 `play()`、
  `kind: "triggered"` 但无 `triggers`/`rules` 的"空技能"、非主动技能上的 `targetIntent`、`general.json` 的 name 与文件夹名不一致、
  代码技能 `onTrigger` 的键不是已知触发点；
  ③`--selfplay=N` 对每个成功加载的武将强制上场跑 N 局不变量断言；`--json` 输出完整报告（可直接喂给 agent 当反馈），
  `--strict` 警告即失败。`examples/generals` 目前 **0 错误 / 2 警告**（那 2 条是神赵云 `龙魂` 故意钉住的 `conversion` 缺口）。
- **自对弈不变量框架**（新 `src/tools/selfplay.ts`）：`runSelfPlay` 用确定性 `mulberry32(seed)` + 全座位 `isAI` 打通整局，
  统一应答交互（可选效果一律发动，走遍技能分支），把违规记成**结构化记录**而非抛错：
  `crashed` / `turn-stuck` / `hp-over-max` / `alive-without-hp` / `dead-with-hp`（后两条只在延迟结算消费完后才判定）。
  为模拟联机主机，`settleStagedTurn` 复刻 `server.ts` 的延迟结算链
  （`resolvePendingDeaths`→`ensureTurnState`→`consumePendingTurnEnd`→`finishTurn`→`consumePendingNextTurn`→`startTurn`）
  并**反复消费到没有挂起状态为止**——只消费一次会把局面停在"弃牌阶段但无人可动"的死角（`startTurn` 自身还会因
  跳过出牌阶段/下个玩家已阵亡而再次挂起）。这是 M4 抓到的第一个真问题。
- **`SKILL_RULE_KEY_KINDS`**（`skill-registry.ts`）：`SkillRules` 键→类型的**单一真相**，校验器/文档/测试都读它；
  `general-pack.test.ts` 新增用例卡住它与 `validateRules` 的漂移（逐键生成合法取值试跑 loader）。
- **`general.json` 的 `description` 不再被静默丢弃**：`GeneralDefinition.description?` 贯通 loader → `getGeneralLibrary()`
  （此前 API 文档承诺了该字段、loader 却直接丢弃）。
- **测试**：新增 `selfplay-invariants.test.ts`（2）、`src/tools/generals-check.test.ts`（8）、`src/tools/gen-rules.test.ts`（6）、
  `general-pack.test.ts` +2，188 → **206**，`typecheck` 干净，lint 仍是 25 个存量错误（无新增）。

M4 明确未做（属下一步"独立武将系统"的关键缺口，见 §十七）：JSON Schema（`schema/*.json`，让编辑器/agent 有机器可读的结构约束）、
武将包作者的 `.d.ts`、`conversions`（当牌转换，**目前 `kind: "conversion"` 写了完全不生效**，校验器只把它标成警告）。

## 十七、"拿 API 文档独立写出一个武将"还差什么（下一步排序）

目标：一个**只能读 `docs/generals-pack-api.md` + schema/类型声明，不能读 `src/`** 的 agent，能独立写出一个
能加载、能对局、技能真的会触发的武将，并自己判断写对了。

现状盘点（M4 之后）：

| # | 缺口 | 影响 | 落点 |
|---|------|------|------|
| 1 | **`conversions` 完全没实现**（`kind: "conversion"` 只登记不生效，零引用） | 黄月英「奇才/集智」之外的"当牌转换"类武将（武圣/龙胆/国色/倾国/急救）**只能写代码技能**，声明式表达不了 | `skill-module.ts` + `game.ts getPlayableActions`（按 `conversion.toCard` 枚举虚拟动作）+ loader 校验 |
| 2 | 没有 **JSON Schema**（`schema/general.schema.json` / `schema/skill.schema.json`） | 编辑器/agent 没有机器可读的结构约束，只能靠 `generals:check` 事后反馈 | 新增 `schema/`，`generals-check` 直接用它校验 |
| 3 | 没有**作者用 `.d.ts`**（`SkillModuleCtx` 的能力清单只在文档里，没有签名） | 代码技能作者只能猜 `ctx.drawCards(...)` 的签名与返回值 | 新增 `types/generals-pack.d.ts`（从 `skill-module.ts` 导出，或生成） |
| 4 | **参考实现只有 2 个**（`examples/generals/吕蒙`、`examples/generals/神赵云`） | 已覆盖"声明式 rules / 代码主动技能 / 代码触发钩子"；**改判/取消杀/当牌转换/主公技/AI 选目标**仍没有可抄的样例 | `examples/generals/` 继续补到 8–12 个覆盖各机制的武将（**默认不加载**） |
| 5 | `priority` 是**空转**（`getPackHooksFor` 只按注册顺序追加，从不排序）；`kind` 的部分语义没有落点 | 钩子顺序不可控、`kind` 与实际行为可能不一致（校验器只能警告） | `skill-hooks.ts` 排序，或删掉 `priority` 字段 |
| 6 | pack 钩子**没有 try/catch**（`skill-hooks.ts` 的 `onTrigger` 调用），只有 `play` 有 | 外部钩子抛错会**炸掉整局**（CLI/联机都一样） | 包一层 try/catch + 归属技能名写进日志（与 `useSkillAction` 对齐） |
| 7 | 内置技能行为散在 74 个 `hasSkill` 分支（`game.ts` 38 / `resolve.ts` 14 / `skills.ts` 10 / `skill-hooks.ts` 12） | 外部包能表达的能力 = 这些分支能表达的子集；不一致会让作者"按内置抄却抄不出来" | 内置技能模块化迁移（**已决定先不做**） |

验收标准（"独立写出武将"这件事算不算成立）：起一个**没有本仓库上下文**的 subagent，只给 `docs/generals-pack-api.md`
+ `schema/` + 作者 `.d.ts`（禁止读 `src/`、`examples/`），让它写三个武将：
张飞（纯声明式）、司马懿（`judgment` 改判 + 反馈）、黄月英（奇才 + 集智 + 一张当牌转换）。
判定：`npm run generals:check -- --json` 零错误、`--selfplay=100` 零违规、日志里三个技能都真的触发过、`src/` 一行未改。
按现状，第 2/3/4 项不补则"写对"几乎全靠运气，第 1 项会让黄月英直接写不出来——所以顺序建议是 **1 → 2+3+4 → 5+6**。

## 十八、神赵云参考实现（"能不能只用武将包写出来"的实测）

`examples/generals/神赵云/`（标准版：神/男/2 体力，`绝境` + `龙魂`）是一次**刻意不动 `src/`** 的试验，
用来把 §17 的缺口从"分析"变成"实测证据"。结论：

| 技能 | 写法 | 实测结果 |
|---|---|---|
| 绝境（摸牌阶段额外摸"已损失体力值"张） | `.skill.ts` 代码技能，`before_draw` 钩子改写 `payload.drawCount` | ✅ **生效**。1/2 体力时摸 **3** 张（基础 2 + 绝境 1），日志出现"绝境生效，额外摸 1 张牌"；满体力时不加牌。外部钩子在**内置钩子之后**执行，因此与英姿/裸衣可叠加。 |
| 绝境（你的手牌上限 +X） | —— | ❌ **表达不了**：引擎手牌上限硬编码为体力值（`game.ts` 的 `endPlayPhase` / `discardForCurrentPlayer`），`SkillRules` 无对应字段，全仓 grep `手牌上限` 零命中。 |
| 龙魂（当牌转换：红桃当桃/方块当火杀/梅花当闪/黑桃当无懈可击） | `.skill.json` 声明 `kind: "conversion"` | ❌ **完全不生效**：引擎不为 `conversion` 枚举可玩动作；"当闪/当无懈可击打出"还需要未实现的 `provideResponse`。 |

为什么**不用代码技能硬凑**龙魂：`SkillModuleCtx` 里有 `applyDamage`/`resolveDuel`，但**没有 `resolveSlash`**；
红桃当桃姑且能靠直接赋值 `hp` 糊出来，方块当火杀/梅花当闪/黑桃当无懈可击则完全做不到——
写个"只能回血、不能当杀、不能响应"的半成品只会把缺口藏起来。

由此得到 3 条可执行的判断：

1. §17 的缺口 ① 是**真实阻塞**（不是理论问题）：一个只读 API 文档的作者写龙魂/武圣/龙胆/国色/倾国/急救时，
   会得到"加载成功、校验只有警告、对局里毫无效果"的最坏结果。
2. 光有 `conversions` 还不够：**一半的当牌转换发生在"打出"时机**（闪/无懈可击），必须同时补 `provideResponse`
   （或让 `conversions` 声明可响应的牌类），否则只解决"出牌阶段主动使用"那一半。
3. 校验器把缺口变成了**可观测的基线**：`examples/generals` 现在是 **0 错误 / 2 警告**，
   `src/tools/generals-check.test.ts` 逐字钉住那 2 条警告——实现 `conversions` 那天该用例会失败，
   提醒作者把龙魂改成可真执行的形式。

