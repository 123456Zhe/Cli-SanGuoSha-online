# 武将包与技能模块化计划

> 目标：让**武将 = 一个文件夹**（`generals/<武将名>/`），`general.json` 声明元数据与技能列表，技能各自成文件（JSON 或代码）；新增武将/技能不需要改本项目的 `src/`，也不需要重新编译。同时让**局内 AI 只注入本场出现的武将及其关联技能说明**，取代现在从 `rules.md` 注入全量武将知识的方式。

状态：**M1（Phase 0 + Phase 4）已完成**（见 §12）；**M2（Phase 1 + Phase 2）已完成**（见 §13）；**M3（Phase 3 谓词层 + §8 规则修复）已完成**（见 §14）；**Phase 6 拦截点（按需子集）与 §四 row 14 的本地策略尾巴已完成**（见 §15）；**M4（Phase 5 校验器 / 自对弈 / 文档生成）已完成**（见 §16）；**Phase 7（声明式当牌转换 `conversions` / 响应拦截点 `provide_response` / `ctx.useSlash` / 手牌上限）已完成**（见 §19，补完 §17 的 ① 与 §18 给出的 `provide_response`）；`神赵云` 实测见 §18。§17 的 ②③④（JSON Schema / 作者 `.d.ts` / 参考武将 gallery）见 §20。附带的两项规则修正已完成，见 §7。

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
  priority?: number;              // 钩子执行顺序（当前仍是空转，见 §17 row 5）
  optional?: boolean;             // 需要"是否发动"询问
  triggers?: SkillTrigger[];      // 4 个基础触发点 + 8 个拦截点（共 12 个，同一套 onTrigger）
  requiresTarget?: boolean;
  targetIntent?: "enemy" | "ally" | "any";  // 主动技能目标取向（供 AI 选目标）
  label?: string;                 // 出牌动作标签（原 game.ts 手写标签迁到此处）
  rules?: SkillRules;             // 声明式数值/豁免
  handLimit?(player): number;     // 手牌上限运行时修正（纯函数；Phase 7）
  canUse?(ctx, player): boolean;
  getTargets?(ctx, player): string[];
  play?(ctx, player, targetId?): Promise<string[]>;
  onTrigger?: Partial<Record<SkillTrigger, SkillHook>>;
  conversions?: SkillConversion[]; // 当牌转换（Phase 7 已实现）
};
```

> 上面是设计期草图；**实现后的权威契约**见 `docs/generals-pack-api.md` 与 `src/engine/skill-module.ts`
> （外部技能没有 `oncePerTurn` 自动限制，需要限次请在 `canUse` 里查 `skillUsedThisTurn`）。

> Phase 6 实现时没有另开 `interceptors` 字段：拦截点与触发点共用 `onTrigger` 与同一张钩子表，
> 区别只在 payload 里是否有"可改写/可否决"的字段（如 `skipDiscardPhase`、`canceled`、`judgmentCard`）。
> 这样 loader 校验、注册表、AI 提示、测试桩全部复用同一条路径。

`SkillRules` 词汇表（Phase 3 目标；下表"现状"已全部落在 `skill-rules.ts` 谓词层，权威表见 `docs/generals-pack-api.md`）：

| 字段 | 语义 | 内置使用者 |
|---|---|---|
| `distanceDelta` | 计算距离时 -N | 马术 |
| `trickDistanceExempt` | 使用受距离限制的锦囊无距离限制 | 奇才 |
| `slashLimitExempt` | 出牌阶段杀无次数限制 | 咆哮 |
| `responseMultiplier` | 需 N 张闪/杀响应 | 无双 |
| `targetImmunity` | 不能成为某些牌的目标 | 空城、谦逊 |
| `drawPhaseDelta` | 摸牌阶段 ±N | 英姿、裸衣 |
| `damageDelta` | 杀/决斗伤害 ±N | 裸衣 |
| `peachSaveBonus` | 被桃救时额外回复 | 救援 |
| `skipDiscardPhaseIfNoSlash` | 未出杀时可跳过弃牌阶段 | 克己（示例包） |
| `handLimitDelta` | 手牌上限 +N | 无内置（Phase 7；运行时变量用代码技能 `handLimit(player)`） |

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
| 17 | 拦截点：`judgment`、`hand_card_lost`、`equip_lost`、`slash_targeted`、`peach_save`、`card_used`、`discard_phase_start` | `resolve.ts`、`game.ts`、`skill-hooks.ts`、`types.ts` | ✅ 6（第 8 个 `provide_response` 由 Phase 7 补齐，见 §19） |

## 五、阶段与里程碑

| 里程碑 | 阶段 | 产出 | 估时 |
|---|---|---|---|
| **M1** 契约 + AI 认识本局武将 | 0 + 4 | ✅ 已完成（见 §12）：注册表 + 动态技能注入；AI 不再依赖 `rules.md` 武将章节 | 1 天 |
| **M2** 外部武将包进游戏 | 1 + 2 | ✅ 已完成（见 §13）：放个文件夹就能选将/对局/触发技能 | 1 天 |
| **M3** 声明式技能 | 3 | ✅ 已完成（见 §14）：`SkillRules` 词表 + 谓词层，8 条硬编码规则数据化 | 半天 |
| **M4** 可批量生成 | 5 | ✅ 已完成（见 §16）：独立校验器（真实 loader + 静态 lint + 可选自对弈）+ headless 自对弈不变量断言 + `rules.md` 生成 | 半天 |
| M5 | 6 | ✅ 已完成按需子集（见 §15）：7 个拦截点（Phase 7 又补第 8 个 `provide_response`） | 按需 |

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

**以上 7 项已在 M3 一并处理**（见 §14）：#1 受控常量、#2/#3/#4 文档修正、#5 主公 +1 体力。

> **复审更正（commit `74086e5`）**：#6/#7 的 M3 处理与官方规则不符，已改回官方口径——
> **激昂**：【决斗】不分颜色一律触发（原先"判色"只适用于【杀】，且仅红色【杀】触发）；
> **魂姿**：只在准备阶段（`turn_start`）判定 `hp === 1`，移除"受伤即时觉醒"。
> `rules.md` §14 与技能注册表的 `description` 曾滞后于该改动，已按实现同步（`rules:gen`）。

## 九、验收门槛（每个阶段）

- `npm run typecheck` 干净
- `npm test` 全绿（**当前基线 252**；新增用例同步更新 `AGENTS.md` 与本行计数）
- `npm run lint` 不新增错误（存量 25 个不动）
- 新增逻辑不引入 `no-explicit-any`、不引入浮动 Promise
- 武将包相关改动：`npm run generals:check -- --dir=examples/generals` **0 错误 / 0 警告**（Phase 7 修复 `conversions` 后已从"2 个已知警告"回到干净基线；任何新增警告视同回归）
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
  > **后续更正**：激昂决斗判色与魂姿即时觉醒这两条已在 `74086e5` 按官方规则改回（见 §8 复审更正），此处仅作 M3 阶段的历史记录。
- **测试**：新增 `skill-rules.test.ts`（4）、`m3-rule-fixes.test.ts`（3，覆盖主公体力/激昂判色/魂姿），`general-pack.test.ts` +3（rules 校验），157 → **167**，`typecheck` 干净，lint 无新增。

M3 明确未做：非 `rules` 词汇表可表达的效果（如克己跳弃牌、反击类）仍待 **Phase 6 拦截点**；`local-engine.ts` 仍读静态规则文本；`priority` 钩子顺序快照测试未做（Phase 4）。

## 十五、Phase 6 拦截点（按需子集）+ row 14 收尾

已完成，落点：

- **触发点/拦截点合并为一套机制**：`types.ts` 新增 `SKILL_TRIGGERS` 常量数组（`SkillTrigger` 由它派生，单一真相），4 个基础触发点 + 7 个拦截点（Phase 7 又补 `provide_response`，共 12 个）：
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
| 1 | ~~**`conversions` 完全没实现**~~ | ✅ **Phase 7 已补**（见 §19）：声明式当牌转换 + 出牌阶段枚举 + 响应时机 | — |
| 2 | ~~没有 **JSON Schema**~~ | ✅ **已补**（§20）：`schema/general.schema.json` + `schema/skill.schema.json`，enum/字段与代码单一真相由 `src/tools/pack-schema.test.ts` 卡住 | — |
| 3 | ~~没有**作者用 `.d.ts`**~~ | ✅ **已补**（§20）：`types/generals-pack.d.ts`（含 `SkillModuleCtx` 全部签名），与真实类型的漂移由 `src/tools/generals-pack-types.test.ts` 卡住 | — |
| 4 | ~~**参考实现只有 2 个**~~ | ✅ **已补到 7 个**（§20）：新增 `张角`（改判 + 使用【闪】触发判定伤害）、`凌统`（失去装备）、`荀彧`（受伤补牌）、`卧龙诸葛亮`（纯声明式当牌转换）、`刘禅`（取消杀）；**仍未覆盖** `hand_card_lost`/`peach_save`/`before_damage` 与代码版 `provide_response`（见 §20 覆盖矩阵） | — |
| 5 | `priority` 是**空转**（`getPackHooksFor` 只按注册顺序追加，从不排序）；`kind` 的部分语义没有落点 | 钩子顺序不可控、`kind` 与实际行为可能不一致（校验器只能警告） | `skill-hooks.ts` 排序，或删掉 `priority` 字段 |
| 6 | ~~pack 钩子**没有 try/catch**（`skill-hooks.ts` 的 `onTrigger` 调用），只有 `play` 有~~ | ✅ **已修**（`74086e5`）：单个包钩子抛错只记日志，不打断整局 | — |
| 7 | 内置技能行为散在 74 个 `hasSkill` 分支（`game.ts` 38 / `resolve.ts` 14 / `skills.ts` 10 / `skill-hooks.ts` 12） | 外部包能表达的能力 = 这些分支能表达的子集；不一致会让作者"按内置抄却抄不出来" | 内置技能模块化迁移（**已决定先不做**） |

**Phase 7 后新增的残留缺口**：`conversions` 一次只吃**一张**源牌（龙魂的"至多两张同花色"双牌模式未实现）；
`to` 只放行 `杀/火杀/雷杀/桃/闪/无懈可击`（当延时锦囊/装备的转换，如国色的方块当乐不思蜀，仍不支持）。

验收标准（"独立写出武将"这件事算不算成立）：起一个**没有本仓库上下文**的 subagent，只给 `docs/generals-pack-api.md`
+ `schema/` + `types/generals-pack.d.ts`（禁止读 `src/`、`examples/`），让它写三个武将。
判定：`npm run generals:check -- --json` 零错误、`--selfplay=100` 零违规、日志里技能都真的触发过、`src/` 一行未改。

> **验收题目必须避开内置武将名**：原稿用「张飞 / 司马懿 / 黄月英」，但这三个都是**内置武将**，
> 外部包一旦同名，loader 会以"武将名重复"**整包拒绝**（`loadOnePack` 的重名检查），
> 于是无论作者写得多好都过不了验收。请改用非内置名，例如
> **张角**（`judgment` 改判 + 使用【闪】触发判定伤害）、**凌统**（`equip_lost`）、**卧龙诸葛亮**（一张当牌转换）。
> §20 的 gallery 已经把这三个写成可抄的参考实现。

第 2/3/4 项已补完（见 §20）；剩余的第 5 项（`priority` 空转）与第 7 项（内置技能模块化）按原决定优先级最低。

## 十八、神赵云参考实现（"能不能只用武将包写出来"的实测）

`examples/generals/神赵云/`（标准版：神/男/2 体力，`绝境` + `龙魂`）是一次**刻意不动 `src/`** 的试验，
用来把 §17 的缺口从"分析"变成"实测证据"。结论：

| 技能 | 写法 | 当时的实测结果（Phase 7 之前） |
|---|---|---|
| 绝境（摸牌阶段额外摸"已损失体力值"张） | `.skill.ts` 代码技能，`before_draw` 钩子改写 `payload.drawCount` | ✅ **生效**。1/2 体力时摸 **3** 张（基础 2 + 绝境 1）。外部钩子在**内置钩子之后**执行，因此与英姿/裸衣可叠加。 |
| 绝境（你的手牌上限 +X） | —— | ❌ **表达不了**：引擎手牌上限硬编码为体力值（`game.ts` 的 `endPlayPhase` / `discardForCurrentPlayer`），`SkillRules` 无对应字段，全仓 grep `手牌上限` 零命中。 |
| 龙魂（当牌转换：红桃当桃/方块当火杀/梅花当闪/黑桃当无懈可击） | `.skill.json` 声明 `kind: "conversion"` | ❌ **完全不生效**：引擎不为 `conversion` 枚举可玩动作；"当闪/当无懈可击打出"还需要未实现的 `provideResponse`。 |

为什么当时**不用代码技能硬凑**龙魂：`SkillModuleCtx` 里有 `applyDamage`/`resolveDuel`，但**没有 `resolveSlash`**；
红桃当桃姑且能靠直接赋值 `hp` 糊出来，方块当火杀/梅花当闪/黑桃当无懈可击则完全做不到——
写个"只能回血、不能当杀、不能响应"的半成品只会把缺口藏起来。

由此得到 3 条可执行的判断（**均已在 §19 落地**）：

1. §17 的缺口 ① 是**真实阻塞**（不是理论问题）：一个只读 API 文档的作者写龙魂/武圣/龙胆/国色/倾国/急救时，
   会得到"加载成功、校验只有警告、对局里毫无效果"的最坏结果。
2. 光有 `conversions` 还不够：**一半的当牌转换发生在"打出"时机**（闪/无懈可击），必须同时补 `provideResponse`
   （或让 `conversions` 声明可响应的牌类），否则只解决"出牌阶段主动使用"那一半。
3. 校验器把缺口变成了**可观测的基线**：当时 `examples/generals` 是 **0 错误 / 2 警告**，
   `src/tools/generals-check.test.ts` 逐字钉住那 2 条警告——这正是"实现 `conversions` 那天该用例必须失败"的提醒机制，
   它按计划生效了（见 §19）。

## 十九、Phase 7：当牌转换 / 响应拦截点 / 运行时变量（补完 §17 的 ①②③④）

`docs/generals-pack-api.md` 是唯一契约，本节只记实现与取舍。

| # | 能力 | 落点 |
|---|---|---|
| ① | **声明式当牌转换 `conversions`** | `skill-registry.ts` 的 `SkillConversion`/`CONVERTIBLE_CARD_TYPES`/`CONVERSION_RESPONSE_KINDS`；`card-utils.ts` 的 `matchesConversionFilter`/`responseKindToCardType`/`slashKindFromCardType`；`general-pack.ts parseConversions`（严格校验）；`game.ts` 的 `appendConversionActions`/`playerConversions`/`resolveConversionUse` |
| ② | **响应拦截点 `provide_response`** | `SKILL_TRIGGERS` +1（共 12）；`SkillEventPayload.need`/`responseSources`；`CardSource.viaSkill`/`asType`（防伪造）；`game.ts` 的 `appendConversionSources` + `requestCardResponse` 在"无来源判定之前"发射 + `consumeResponseCard` 复算凭据 |
| ③ | **`ctx.useSlash`** | `skills.ts` 的 `SkillUseContext.useSlash`；`game.ts` 的公开 `useSlash`（结算+濒死+胜负+阵亡推进） |
| ④ | **手牌上限** | `SkillRules.handLimitDelta`（静态求和）+ `SkillDescriptor/Module.handLimit(player)`（运行时纯函数）；`skill-rules.ts` 的 `getHandLimit` 统一出口；`game.ts` 三处 + `render-lines.ts` UI 提示 |

关键设计取舍：

- **动作编码**：出牌阶段用 `GameAction.convertVia/convertTo` + `cardIndex = -10000 - 下标`，**必须排在所有内置负下标分支之前**
  （`<= -1000` 是木牛流马，否则被它先吃掉——这是实现时踩到并修掉的真实 bug）；`playAction` 侧全部复算，不信任客户端。
- **不迁移内置技能**：武圣/龙胆/国色/倾国/急救仍是各自硬编码分支，不给它们填 `conversions`（否则重复枚举）。
  内置模块化仍按原决定"先不做"。
- **`to` 白名单**：只放行 `杀/火杀/雷杀/桃/闪/无懈可击`。当延时锦囊（国色）需要目标/距离/判定区逻辑，loader 明确拒绝而不是静默半支持。
- **`handLimit` 必须是纯函数**：UI 的弃牌提示与引擎的弃牌判定走同一个 `getHandLimit(player)`，读全局状态会让两边算出不同上限。
- **只支持单张源牌**：龙魂的"至多两张同花色"双牌模式未实现（§17 残留缺口）。

测试：新增 `src/engine/conversions.test.ts`（12 例：出牌阶段火杀/桃、伪造与非法目标拒绝、无闪时当闪响应、
无凭据来源被拒、真闪优先、`handLimitDelta` 与 `handLimit` 的弃牌采用、loader 7 种非法声明）；
`generals-check.test.ts` 新增"抓合法但永不生效的 conversions"，并把神赵云恢复为 **0 错误 / 0 警告**基线。
`SKILL_TRIGGERS` 计数用例 11 → 12。



## 二十、§17 的 ②③④：JSON Schema / 作者 `.d.ts` / 参考武将 gallery

§17 的三项"让没有本仓库上下文的作者也能写对"的缺口已补完，落点如下。

### ② JSON Schema（`schema/`）

- `schema/general.schema.json`、`schema/skill.schema.json`（draft-07，`additionalProperties: false`）：
  `general.json` 的字段/必填/`maxHp`/`gender`/技能名 pattern；`.skill.json` 的 `kind`/`triggers`/`targetIntent`/
  `rules` 各键类型/`conversions` 的 `to` 白名单与 `from` 筛选项/`asResponse` 时机，全部机器可读。
- **`src/tools/pack-schema.test.ts`（7 例）**三个方向：
  ① **schema ↔ 代码**：enum/字段名逐项比对引擎的单一真相（`SKILL_TRIGGERS`、`SKILL_RULE_KEY_KINDS`、
  `CONVERTIBLE_CARD_TYPES`、`CONVERSION_RESPONSE_KINDS`、`CardType` 全部取值、`SKILL_KINDS`、`SKILL_TARGET_INTENTS`、
  `generals-check` 的 `KNOWN_*_KEYS`）；② **schema ↔ 示例包**：`examples/generals/` 每个 `general.json`/`.skill.json` 必须通过；
  ③ **反向用例**：未知字段/坏枚举/缺必填/空 `from`/非白名单 `to`/`.skill.json` 里写代码字段都必须被报出来。
- 为此把散落的清单**导出成单一真相**：`general-pack.ts` 的 `SKILL_KINDS`/`TARGET_IMMUNITY_CARDS`/`CONVERSION_SUITS`，
  `generals-check.ts` 的 `KNOWN_GENERAL_KEYS`/`KNOWN_SKILL_KEYS`/`CODE_ONLY_SKILL_KEYS`。
- 取舍：**没有**把 schema 接进 `generals-check` 的运行时校验（loader 才是权威，且不想引入 JSON Schema 依赖）。
  schema 的职责是"编辑器/agent 的机器可读约束"，它与代码的一致性由上面的测试保证。

### ③ 作者 `.d.ts`（`types/generals-pack.d.ts`）

- 独立于 `src/` 的完整作者契约：`SkillModule`、`SkillModuleCtx`（两个真实 context 的**全部** 39 个成员 + 隐式约定 JSDoc）、
  `SkillEventPayload`、`SkillRules`、`SkillConversion`、`CardSource`、`InteractionRequest`/`Decision`、
  `Player`/`Card`/`GeneralDefinition`、全部词表（`CardType` 等用**字符串字面量联合**，作者不必 import 引擎枚举）。
- 用法：代码技能顶部 `import type { SkillModule, SkillModuleCtx } from "../../../types/generals-pack.js";` + `satisfies SkillModule`；
  `import type` 运行时被擦除，故不影响加载。仓库内 7 个 gallery 代码技能已实测按该 d.ts **严格编译零诊断**。
- **`src/tools/generals-pack-types.test.ts`（9 例）**：
  ① 用 TS 编译器 API 把 d.ts 当独立程序编译，断言**零诊断**（不依赖 `tsconfig`，因为 `types/` 与 `generals/` 一样不进 `tsc`）；
  ② AST 逐项比对字段名与字面量联合（`SkillModuleCtx` == `SkillUseContext & SkillHooksContext`、`SkillModule`/`SkillEventPayload`/
  `Player`/`Card`/`SkillConversion`/`CardSource` 字段名、装备词表、`SkillRules` 键、各枚举）；
  ③ **运行时守卫**：`SkillModuleCtx` 的每个成员都必须在真实 `SanGuoGame` 实例上存在（方法须是函数、字段须在实例上）。

### ③ 顺带修掉的一个真 bug（运行时守卫抓到的第一例）

- `SkillHooksContext.hasRemovableCard` 只写在**类型与文档**里，从来没挂到 `SanGuoGame` 实例上；
  内置「反馈」（`skill-hooks.ts` 的 `after_damage` 钩子里 `ctx.hasRemovableCard(source)`）一旦玩家确认发动就会抛
  `ctx.hasRemovableCard is not a function`。它长期没暴露，是因为测试里没有 handler 时 `autoDecision` 把
  `optional-effect` 默认成"不发动"，`&&` 短路掉了那一步。
- 修复：`SanGuoGame` 增加 `hasRemovableCard(player)`（委托 `card-utils.ts` 的同名纯函数，原先的两处调用改用别名导入）；
  上面 ③ 的运行时守卫测试是这类"类型里有、运行时没有"漂移的通用防线。
- gallery 的「凌统/旋风」最初为绕开这个 bug 写了本地谓词，修复后已改回 `ctx.hasRemovableCard`（更好的教学样例）。

### ④ 参考武将 gallery（`examples/generals/`，默认不加载）

在 `吕蒙`（声明式 rules + 代码主动技）、`神赵云`（`before_draw` 运行时变量 + `handLimit` 纯函数 + 声明式 `conversions`）
之外新增 5 个包，共 **7 个**，`--strict` 0 错误 / 0 警告、`--selfplay=3` 全部 0 违规：

| 武将 | 技能 | 覆盖机制 |
|---|---|---|
| 张角 | 鬼道 | `judgment` 改判（`choose-discard` 询问 + `removeHandCardAt` + `payload.judgmentCard`） |
| 张角 | 雷击 | `card_used` → `drawJudgmentCard` → `applyDamage(...,"thunder")` → 死亡/胜负/回合推进链 |
| 凌统 | 旋风 | `equip_lost` + `ctx.hasRemovableCard` + `removeRandomCardFromPlayer` |
| 荀彧 | 节命 | `after_damage` + `drawCards`/`discardFromPlayerHand`（补至体力上限、封顶 5） |
| 卧龙诸葛亮 | 看破 | 纯声明式当牌转换（黑色手牌当【无懈可击】，`asResponse:["negate"]`） |
| 刘禅 | 享乐 | `slash_targeted` 取消杀 + `buildUsableSources` + `requestDiscardSelection` + 自己 `discardPile.push` |

- `examples/generals/README.md` 是**机制覆盖矩阵**：12 个触发点里 8 个有样例（`discard_phase_start`/`provide_response` 为声明式路径），
  `turn_start` 只有内置样例，`hand_card_lost`/`peach_save`/`before_damage` **仍无样例**（原因写在矩阵里：贴切的真实技能与内置重叠，或需要引擎新能力）。
- **实测暴露的两处引擎能力不对称**（已写进 `docs/generals-pack-api.md` 与 gallery README，属 §17 row 7 的具体证据）：
  ① **触发性技能无法交互式选目标**（`InteractionRequest` 没有"选玩家"），gallery 里的选人都照内置「英魂」自动挑选；
  ② **`judgment` 钩子只分发给"判定牌归属者"**（`drawJudgmentCard` 的 payload 只有 `actor = owner`），
  所以外部「鬼道」只能改判自己的判定，而内置「鬼才」因写在 `game.ts` 里做全局搜索，能改判任意角色。

### 测试与基线

- 测试 226 → **252**：远端两个本地 AI 提交（System-One / simple 升级）先加到 232，本轮再加 18 —— `pack-schema.test.ts` 7 例 + `generals-pack-types.test.ts` 9 例 + 联机实测带出的 2 例回归（铁索连环自选目标、重开后空对局不崩服务端）；
  另按 gallery 更新了 `general-pack.test.ts`/`generals-check.test.ts` 里钉死"示例包恰好 2 个"的断言（改为"gallery 全员加载成功"）。
- `typecheck` 干净；`lint` 仍是 25 个存量错误（新增文件里的 `void test(...)` 已按仓库惯例处理，无新增）；
  `generals:check --dir=examples/generals --strict` 与 `rules:check` 干净。
