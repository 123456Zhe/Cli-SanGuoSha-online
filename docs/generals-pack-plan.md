# 武将包与技能模块化计划

> 目标：让**武将 = 一个文件夹**（`generals/<武将名>/`），`general.json` 声明元数据与技能列表，技能各自成文件（JSON 或代码）；新增武将/技能不需要改本项目的 `src/`，也不需要重新编译。同时让**局内 AI 只注入本场出现的武将及其关联技能说明**，取代现在从 `rules.md` 注入全量武将知识的方式。

状态：**待执行**（Phase 0 尚未开始）。附带的两项规则修正已完成，见 §7。

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
  triggers?: SkillTrigger[];      // 复用现有 4 个触发点
  requiresTarget?: boolean;
  label?: string;                 // 出牌动作标签（原 game.ts 手写标签迁到此处）
  rules?: SkillRules;             // 声明式数值/豁免
  canUse?(ctx, player): boolean;
  play?(ctx, player, targetId?): Promise<string[]>;
  onTrigger?: Partial<Record<SkillTrigger, SkillHook>>;
  conversions?: ConversionRule[]; // 当牌规则
  interceptors?: Partial<Record<InterceptorPoint, ...>>;  // Phase 6
};
```

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
| 14 | AI 动态技能说明（详见 §6） | `src/agent/match-context.ts`（新增）、`prompt.ts`、`ai.ts`、`local-engine.ts`、`jev-advisor.ts`、`server.ts`、`app.ts` | 4 |
| 15 | `rules.md` §14/§16.3 改为由注册表 + 武将库生成 | 新增生成脚本 | 4/5 |
| 16 | 独立校验器 `npm run generals:check <dir>` + headless 自对弈不变量断言 | 新增 `src/tools/generals-check.ts` | 5 |
| 17 | 拦截点（按需）：`onJudgment`、`onLoseHandCard`、`onLoseEquip`、`onSlashTargeted`、`onPeachSave`、`provideResponse`、`onCardUsed` | `resolve.ts`、`game.ts` | 6 |

## 五、阶段与里程碑

| 里程碑 | 阶段 | 产出 | 估时 |
|---|---|---|---|
| **M1** 契约 + AI 认识本局武将 | 0 + 4 | 注册表 + 动态技能注入；AI 不再依赖 `rules.md` 武将章节 | 1 天 |
| **M2** 外部武将包进游戏 | 1 + 2 | 放个文件夹就能选将/对局/触发技能 | 1 天 |
| **M3** 声明式技能 | 3 | 距离/目标合法性等规则数据化 | 半天 |
| **M4** 可批量生成 | 5 | 校验器 + 自对弈 + 文档生成 | 半天 |
| M5 | 6 | 按需开放更高阶挂载点 | 按需 |

关键路径 `0 → 1 → 2 → 3 → 5`；**Phase 4 只依赖 Phase 0，可与 Phase 2 并行**。

## 六、AI 侧：只注入本场武将的技能

- **数据源以快照 `player.skills` 为准**，不是武将定义 —— 这样魂姿觉醒获得的英姿/英魂、以及未来任何"临时获得技能"都自动覆盖。
- 新增 `match-context.ts`：从快照收集本场全部技能 id → 查注册表取 `displayName + description` → 生成"本局武将技能"文本块；**设总长上限**（武将多时截断，避免炸上下文）。
- `prompt.ts` 把 `rulesText` 拆两块：`baseRules`（卡牌/流程，来自 `rules.md`，**剔除 §14 与 §16.3**）+ `matchGeneralsText`（动态）。
- 三处消费点同步：LLM（`ai.ts`/`prompt.ts`）、本地策略（`local-engine.ts`）、Jev（`jev-advisor.ts` 的 `state.rules`）；构造入参在 `server.ts:180-201` 与 `app.ts:132-134`。
- 验收：prompt 单测断言"在场武将的技能说明出现、未出场武将不出现、觉醒获得的技能出现"；把 `rules.md` §14 整段删除后 AI 行为不受影响。

## 七、已完成的规则修正（本次）

| 项 | 内容 | 落点 |
|---|---|---|
| 顺手牵羊距离限制 | 只能对距离 1 以内的角色使用 | 目标筛选 `game.ts findTargetsByCard`、动作校验 `game.ts playAction`、结算兜底 `resolve.resolveSnatch` |
| 兵粮寸断距离限制 | 同上（乐不思蜀不受限） | `resolve.resolveDelayedTrick` + `findTargetsByCard` |
| 奇才 | 锁定技：使用受距离限制的锦囊（顺手牵羊/兵粮寸断）无距离限制 | `resolve.canReachForDistanceOneTrick` |
| 新增纯谓词 | `card-utils.isDistanceOneTrickCard` | `card-utils.ts` |
| 测试 | `src/engine/trick-distance.test.ts`，6 例：默认受限 / -1 马 / 奇才豁免 / 兵粮寸断 / 乐不思蜀不受限 / 结算层兜底 | 全量 **140 tests 通过** |
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

## 九、验收门槛（每个阶段）

- `npm run typecheck` 干净
- `npm test` 全绿（当前 140；新增用例同步更新 `AGENTS.md` 计数）
- `npm run lint` 不新增错误（存量 25 个不动）
- 新增逻辑不引入 `no-explicit-any`、不引入浮动 Promise
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
