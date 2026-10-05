# 武将包 API

对应 `docs/generals-pack-plan.md` §二/§三。M1 落地契约类型与「AI 只读本局武将技能」，M2 落地外部包加载与执行，M3 落地声明式规则数据化（`.skill.json` 的 `rules` 经 `skill-rules.ts` 谓词层参与结算），Phase 6 落地 7 个拦截点（见「触发点与拦截点」）。

## 目录与文件格式

```
generals/                      # 项目根目录（在 src 之外，不进 typecheck/lint/test/build）
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

- `apiVersion` 必须为 `1`；`name`/`kingdom`/`gender`（`男`/`女`）/`maxHp`（正整数）/`skills`（字符串数组）必填。
- `skills` 是**原始技能名**数组；对应文件名为 `<技能名>.skill.json|.ts|.mjs`（二选一，不要 JSON+代码成对出现，避免双源真相）。

完整的可运行示例见 `examples/generals/吕蒙/`（`克己` 声明式 + `涉猎` 代码主动技能）。

## 技能身份与命名空间

- 外部技能 id = `${文件夹名}/${技能名}`（如 `吕蒙/克己`）。`Player.skills`、快照、线协议存这个 id；UI/AI 展示用 `displayName`。
- 内置技能 id 就是技能名本身（如 `制衡`）。
- `type SkillName = SkillId = string`：`SkillName.X` 值写法与 `SkillName[]` 类型标注都保留；`SKILL_REGISTRY[某string]` 需 `as BuiltinSkillId`。

## SkillKind

`active`（出牌阶段发动）/ `triggered`（钩子触发）/ `conversion`（当牌转换）/ `passive`（锁定被动）/ `lord`（主公技）。

## 技能契约（`SkillModule`，见 `src/engine/skill-module.ts`）

```ts
type SkillModule = {
  id: string;
  displayName: string;
  kind: SkillKind;
  description: string;            // 必填：AI 与 UI 的唯一来源
  triggers?: SkillTrigger[];      // 基础 4 个触发点 + Phase 6 的 7 个拦截点（见下表）
  optional?: boolean;
  priority?: number;
  requiresTarget?: boolean;
  targetIntent?: "enemy" | "ally" | "any";  // 主动技能目标取向（供 AI 选目标，缺省 any）
  label?: string;                 // 出牌动作标签
  rules?: SkillRules;             // 声明式规则数值/豁免（见下「规则词汇表」）
  canUse?(ctx, player): boolean;
  getTargets?(ctx, player): string[];
  play?(ctx, player, targetId?): Promise<string[]>;
  onTrigger?: Partial<Record<SkillTrigger, (ctx, payload, logs) => void | Promise<void>>>;
};
```

内置 45 个技能的元数据登记在 `src/engine/skill-registry.ts`，`description` 以**代码行为**为准（已知与旧文档的漂移按实现写，注释标 `NOTE(§8歧义N)`）。

## 触发点与拦截点（`SkillTrigger`）

单一真相是 `src/engine/types.ts` 的 `SKILL_TRIGGERS` 数组（`SkillTrigger` 由它派生），loader 的 `triggers` 校验与钩子分发都读它。

| 触发点 | 类别 | 发出位置 | payload 里钩子可改写的字段 |
|---|---|---|---|
| `turn_start` | 事件 | 回合开始 | — |
| `before_draw` | 事件 | 摸牌阶段开始前 | `drawCount` |
| `before_damage` | 事件 | 造成伤害前 | — |
| `after_damage` | 事件 | 造成伤害后 | — |
| `judgment` | 拦截 | 判定牌已翻开并进入弃牌堆后、内置鬼才之前 | `judgmentCard`（换成别的牌 = 改判；替换牌须由钩子自己从原区域移除，引擎负责把它置入弃牌堆并记日志） |
| `slash_targeted` | 拦截 | 杀已确定目标、目标尚未响应时 | `canceled = true` 取消本次杀 |
| `hand_card_lost` | 事件 | 任何"失去手牌"路径（`removeHandCardAt`） | — |
| `equip_lost` | 事件 | 装备离开装备区（被弃置/获得/替换） | — |
| `card_used` | 事件 | 使用一张牌（`reason="使用"`）或打出一张响应牌（`reason="打出"`） | — |
| `peach_save` | 拦截 | 濒死时每消耗一张救援桃 | `peachSaveBonus`（累加额外回复点数） |
| `discard_phase_start` | 拦截 | 弃牌阶段入口 | `skipDiscardPhase = true` 跳过整个弃牌阶段（钩子自行处理"是否发动"询问） |

未实现（Phase 6 剩余项）：`provideResponse`（技能提供响应牌，需改交互管线）。

注意：`createSkillHooks` 在 `SanGuoGame` **构造时**快照外部钩子，因此加载武将包必须在建对局之前完成（与 `loadGeneralPacks` 的既有约定一致）；进行中的对局只认建局时已注册的技能。

## 目标取向（`targetIntent`）

`kind: "active"` 且 `requiresTarget` 的技能建议声明 `targetIntent`，否则本地策略 AI 会按"敌方"处理目标：

- `enemy`：强袭/反间/离间…
- `ally`：青囊/仁德/结姻/制霸…
- `any`（缺省）

它只影响 AI 选目标的启发式（`src/agent/local-engine.ts`），不参与引擎的合法性校验——把 `targetIntent` 写错不会让非法目标变合法，只会让 AI 打错人。

## 规则词汇表（`SkillRules`）

声明式技能通过 `rules`（见 `src/engine/skill-registry.ts`）表达数值/豁免；`src/engine/skill-rules.ts` 的谓词层把玩家拥有的**全部技能**（内置 + 外部包，经 `resolveSkillDescriptor`）合并后供引擎调用。合并语义：

| 字段 | 类型 | 语义 | 合并 | 内置使用者 |
|---|---|---|---|---|
| `distanceDelta` | number | 计算与他人距离时 -N | 求和 | 马术 |
| `trickDistanceExempt` | boolean | 使用受距离限制的锦囊无距离限制 | OR | 奇才 |
| `slashLimitExempt` | boolean | 出牌阶段使用杀无次数限制 | OR | 咆哮 |
| `responseMultiplier` | number | 需 N 张闪/杀响应 | 取最大（默认 1） | 无双 |
| `targetImmunity` | `{ cards: TargetImmunityCard[]; requireEmptyHand?: boolean }` | 不能成为某些牌的目标 | 并集 | 空城（`slash/duel` + requireEmptyHand）、谦逊（`snatch/indulgence`） |
| `drawPhaseDelta` | number | 摸牌阶段 ±N | 求和 | 英姿、裸衣 |
| `damageDelta` | number | 杀/决斗伤害 ±N | 求和（仅「本回合已发动」的技能） | 裸衣 |
| `peachSaveBonus` | number | 被桃救时额外回复 N | 求和 | 救援（吴势力主公） |
| `skipDiscardPhaseIfNoSlash` | boolean | 本回合未使用/打出过杀时可跳过弃牌阶段 | OR（需玩家确认发动） | 无内置使用者（示例包吕蒙「克己」） |

- `TargetImmunityCard` = `"slash" \| "duel" \| "snatch" \| "indulgence" \| "supplies-cut"`。
- `drawPhaseDelta` / `damageDelta` 属「发动后本回合生效」：触发时机仍由技能自身的钩子 / `isSkillUsed` 门控，`rules` 只提供数值。
- 外部包的 `rules` 会被 **schema 校验**（`general-pack.ts validateRules`）：未知键、类型不符、`targetImmunity.cards` 非法 → 抛错（隔离进 `report.errors`；`--strict-generals` 时整体失败）。

## 执行语义（M2/M3）

- **主动技能（`kind: "active"`）**：`getPlayableActions` 会为「持有该技能」的当前玩家枚举 `{type:"skill", skill: id, label, requiresTarget, targets}`；`requiresTarget` 为真但 `getTargets` 返回空时跳过。`playAction` 命中后调用 `play`，返回值并入对局日志。
- **触发钩子（`onTrigger`）**：`createSkillHooks` 会在每个触发点的内置钩子之后追加外部钩子；钩子首参是引擎 ctx（运行时就是存活的 `SanGuoGame` 实例），需自行用 `ctx.hasSkill(player, id)` 判断归属。
- **声明式技能（`.skill.json`）**：M2 加载 + 校验 + 供 AI 阅读；M3 起其 `rules` 经谓词层参与结算（见上表）；Phase 6 起 `skipDiscardPhaseIfNoSlash` 这类"开关型"效果也能声明。非 `rules` 词汇表可表达的效果仍需代码技能 + 拦截点。
- **`play` 抛错不炸对局**：`useSkillAction` 对包技能的 `play` 整体 try/catch，返回 `发动…失败：<msg>` 日志。

## Context 能力清单与隐式约定

代码技能只能用 `ctx`（`SkillModuleCtx = SkillUseContext & SkillHooksContext`，见 `skills.ts`、`skill-hooks.ts`）暴露的能力，禁止直接碰牌堆/手牌数组（只读遍历除外）。常用能力：

- 摸牌/看牌：`drawCard` / `drawCards` / `drawTopCards` / `placeCardsOnTop` / `placeCardsOnBottom`。
- 交互：`decide(request)` + `nextInteractionId()` + `shouldActivateOptionalEffect`。
- 弃牌/失去牌：`requestDiscardSelection` / `requestFlexibleDiscard` / `removeHandCardAt` / `removeUsableCardBySourceId` / `discardFromPlayerHand` / `discardSelfCards`。
- 伤害/死亡：`applyDamage`（随后必须自己结算死亡/胜负，见下）。
- 回合状态：`skillUsedThisTurn` / `markSkillUsed`（外部技能无 `oncePerTurn` 自动限制，需要限次请在 `canUse` 里查 `skillUsedThisTurn` 并在 `play` 里 `markSkillUsed`）。

调用方必须自己做的事（漏做会静默坏掉）：

- `requestDiscardSelection` 返回的牌**不会自动进弃牌堆**，调用方必须自己 `discardPile.push`（见 `skills.ts` 现有写法）。
- 造成伤害后必须走 `resolveDeaths` → `resolveWinner` → `advanceIfCurrentPlayerDead`，否则濒死/胜负不结算。
- 失去手牌必须走 `removeHandCardAt`，否则连营不触发。
- 随机数禁止 `Math.random`，用 `ctx.randomIndex`，否则 `--seed` 复现与联机一致性失效。
- `judgment` 钩子改判时，必须自己把替换牌从原区域移除（`removeHandCardAt` / `removeUsableCardBySourceId`）；引擎只负责把它置入弃牌堆。
- `hand_card_lost` 属于"通知"型钩子：调用方没传 `logs` 时（如 `takeRandomHandCard`）钩子日志会被丢弃，别把关键状态只写进日志。
- `peach_save` / `discard_phase_start` 是"拦截"型钩子：改的是 payload 字段（`peachSaveBonus` / `skipDiscardPhase`），不要自己直接改 `player.hp` 或跳过结算。
- **别在钩子里做会再次触发同一钩子的事**：`card_used` 钩子里再"使用一张牌"、`hand_card_lost` 钩子里再移除手牌都会无限递归（引擎不设保护）。需要递归语义时用 `skillFlagsThisTurn` 之类的状态自己打断。

## AI 如何认识本局武将（4 个消费点）

数据源统一是**快照的 `player.skills`**（不是武将定义），因此魂姿觉醒等"临时获得技能"自动覆盖：

| 消费点 | 落点 | 用法 |
|---|---|---|
| LLM | `src/agent/prompt.ts` + `ai.ts`、`server.ts`、`app.ts` | `buildMatchGeneralsText(snapshot)` 作为 `matchGeneralsText` 注入 systemPrompt |
| Jev 快决策 | `src/agent/jev-advisor.ts` | state 的 `match_skills` 字段 |
| 本地策略 | `src/agent/local-engine.ts` | `getMatchGeneralsText()` 持有同一份文本（缓存），并用 `resolveSkillDescriptor` 读 `targetIntent` 等元数据选目标 |
| 规则文本 | `src/agent/match-context.ts` | `stripGeneralsSections` 从 `rules.md` 剔除 §14/§16.3，避免与动态注入重复 |

## 加载与开关

`loadGeneralPacks(options)`（`src/engine/general-pack.ts`）：

- `dir`：武将包根目录，默认 `generals`（相对 `process.cwd()`）。
- `pool`：`all` 合并外部包；`builtin` 只保留内置池并清空外部技能。
- `jsonOnly`：只允许声明式 JSON 技能，遇到 `.ts`/`.mjs` 报错。
- `strict`：任一包加载失败即抛错（CI / 主机严格模式）。
- 每包 try/catch 隔离：坏包只记录错误，不影响其他包；与内置或已加载包重名的武将整包跳过。

命令行开关：

| 命令 | 默认 | 说明 |
|---|---|---|
| `--generals-dir=<dir>` | `generals` | 武将包目录 |
| `--generals-pool=all\|builtin` | dev=`all`，host=`builtin` | host 默认不加载外部包（等价任意代码执行），需显式 `all` |
| `--generals-json-only[=true]` | 关 | 拒绝代码技能 |
| `--strict-generals[=true]` | 关 | 任一包失败即退出 |

- `.ts` 技能依赖 bun/tsx 运行时（`dev`/`host`/`join`/`webui` 均可用）；跨环境分发用 `.mjs`。
- 注册表挂 `globalThis.__sanguoPackRegistry__`，热重载重建 `src/engine` 模块图后仍存活；`reload` 不重新扫目录（决策 5，不维护代码热重载）。
- 外部包默认进入随机抽将池；提供 `--generals-pool=builtin` 作为临时排除开关。

## 手动验收

```bash
# 方式一：复制示例到项目根 generals/ 后 npm run dev 选将出现吕蒙
cp -r examples/generals/吕蒙 generals/吕蒙 && npm run dev

# 方式二：直接把示例目录当武将包目录
npm run dev -- --generals-dir=examples/generals

# host 默认不含吕蒙；显式 all 才加载
npm run host -- --players=3
npm run host -- --players=3 --generals-pool=all
```
