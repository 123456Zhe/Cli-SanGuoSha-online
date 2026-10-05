# 武将包 API

对应 `docs/generals-pack-plan.md` §二/§三。M1 落地契约类型与「AI 只读本局武将技能」，M2 落地外部包加载与执行，M3 落地声明式规则数据化（`.skill.json` 的 `rules` 经 `skill-rules.ts` 谓词层参与结算），Phase 6 落地拦截点，Phase 7 落地声明式当牌转换 `conversions` / `provide_response` / `useSlash` / 手牌上限（见「触发点与拦截点」「当牌转换」「手牌上限」）。

**作者资源**（不读 `src/` 也能写出武将）：`schema/general.schema.json`、`schema/skill.schema.json`（机器可读结构约束，编辑器/agent 可直接消费）、`types/generals-pack.d.ts`（`SkillModule` / `SkillModuleCtx` 的完整作者接口签名）。

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
- `description` 可选：一句话设定，会保留进已加载池（`getGeneralLibrary()`），供 UI/未来 AI 使用；引擎结算逻辑不读它。
- `skills` 是**原始技能名**数组；对应文件名为 `<技能名>.skill.json|.ts|.mjs`（二选一，不要 JSON+代码成对出现，避免双源真相）。
- **未知字段会被 loader 静默忽略**——拼错字段名不会报错。跑 `npm run generals:check` 会让它变成一条警告。

完整的可运行示例见 `examples/generals/`：

- `吕蒙/`：`克己`（声明式 `rules`）+ `涉猎`（代码主动技能）。
- `神赵云/`：`绝境`（代码技能：`before_draw` 钩子 + `handLimit(player)` 纯函数）+ `龙魂`（声明式 `conversions`：红桃当桃/方块当火杀/梅花当闪/黑桃当无懈可击；校验器 **0 错误 / 0 警告**）。
- 其余参考武将（覆盖改判/取消杀/支援型主动技/失去装备/使用锦囊等机制）见 `examples/generals/`，**默认不加载**。

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
  triggers?: SkillTrigger[];      // 4 个基础触发点 + 8 个拦截点（共 12 个，见下表）
  optional?: boolean;
  priority?: number;
  requiresTarget?: boolean;
  targetIntent?: "enemy" | "ally" | "any";  // 主动技能目标取向（供 AI 选目标，缺省 any）
  label?: string;                 // 出牌动作标签
  rules?: SkillRules;             // 声明式规则数值/豁免（见下「规则词汇表」）
  conversions?: SkillConversion[]; // 当牌转换（见下「当牌转换」；一个技能可多条）
  handLimit?(player): number;     // 手牌上限的运行时修正（纯函数；见下「手牌上限」）
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
| `provide_response` | 拦截 | 需要响应（闪/杀/无懈可击/桃）、**在"没有任何来源 → 判定无法响应"之前** | `responseSources`（就地 push 额外可选来源；push 的来源必须带 `viaSkill`，否则不被接受） |

`provide_response` 让"手上没有闪但技能能变出闪"也能询问玩家。钩子 push 的来源形如：

```ts
onTrigger: {
  provide_response: (ctx, payload) => {
    if (payload.need !== "dodge" || !payload.actor || !payload.responseSources) return;
    for (const card of payload.actor.hand) {
      if (card.suit !== "club") continue;
      payload.responseSources.push({
        sourceId: `hand:${card.id}`,
        origin: "hand",
        card,
        label: `${card.type}当闪`,
        viaSkill: ctx.id,          // 必填：引擎据此复算技能的真实声明
        asType: CardType.Dodge,
      });
    }
  },
}
```

**声明式当牌转换请优先用 `conversions`**（见下节）：它是纯数据、不用写代码，且出牌阶段与响应时机都覆盖。`provide_response` 留给声明不了的情况。

注意：`createSkillHooks` 在 `SanGuoGame` **构造时**快照外部钩子，因此加载武将包必须在建对局之前完成（与 `loadGeneralPacks` 的既有约定一致）；进行中的对局只认建局时已注册的技能。

## 当牌转换（`conversions`，Phase 7）

把满足 `from` 的牌当作 `to` 使用或打出，**一个技能可以声明多条**（龙魂就是 4 条花色映射）：

```json
{
  "kind": "conversion",
  "description": "你可以将一张手牌按花色当下列牌使用或打出：红桃当桃，方块当火杀，梅花当闪，黑桃当无懈可击。",
  "conversions": [
    { "from": { "suit": ["heart"] },   "to": "桃",       "asResponse": ["peach"] },
    { "from": { "suit": ["diamond"] }, "to": "火杀" },
    { "from": { "suit": ["club"] },    "to": "闪",       "asResponse": ["dodge"] },
    { "from": { "suit": ["spade"] },   "to": "无懈可击", "asResponse": ["negate"] }
  ]
}
```

| 字段 | 类型 | 语义 |
|---|---|---|
| `from` | `{ suit?: CardSuit[]; color?: ("red"\|"black")[]; type?: CardType[] }` | 源牌筛选。三个条件之间是 **AND**；至少要给一个（什么都不给会被 loader 拒绝，防"任意牌都能变"）。`suit` 取值 `heart/diamond/club/spade` |
| `to` | `CardType` | 当成什么牌。**只放行** `杀 / 火杀 / 雷杀 / 桃 / 闪 / 无懈可击`——其余牌类（延时锦囊、装备、其他锦囊）需要目标/距离/判定区逻辑，loader 会明确报错 |
| `asResponse` | `ResponseKind[]`（可选） | 可作为哪些响应时机**打出**：`dodge`（闪）/`slash`（杀）/`negate`（无懈可击）/`peach`（桃）。必须与 `to` 对得上（杀↔`slash` 允许三种杀）。缺省 = 只能在出牌阶段主动使用 |

生效路径（都是引擎自动的，作者不用写代码）：

- **出牌阶段主动使用**：`getPlayableActions` 为持有者枚举 `{type:"play", convertVia, convertTo, targets}`，
  `cardIndex = -10000 - 手牌下标`（避免与内置转换技的 -100/-200/-400/-500/-1000 段冲突）。
  `playAction` **不信任客户端**：会复算技能归属、`from` 筛选、杀次数、目标合法性（射程/空城/自己）。
  只有 `to` 是可玩牌类（`杀/火杀/雷杀/桃`）才会枚举；`to` 是 `闪/无懈可击` 时必须给 `asResponse`，否则那条转换永远不会生效（校验器会警告）。
- **响应打出**：`requestCardResponse` 在"没有任何来源"判定**之前**发出 `provide_response`，
  把 `asResponse` 命中的转换来源（带 `viaSkill`/`asType`）并入可选来源。所以"手里没有闪但梅花手牌能当闪"会正常询问玩家。
  `consumeResponseCard` 收到该来源后，会以技能的真实声明复算一次 `from`，伪造的 `sourceId` 不被接受。

**内置转换技（武圣/龙胆/国色/倾国/急救）仍是各自硬编码的分支**，不要给它们再填 `conversions`（否则会重复枚举）。
`to` 为延时锦囊/装备的转换（如国色的方块当乐不思蜀）暂不支持。

## 手牌上限（`handLimit` / `rules.handLimitDelta`）

默认手牌上限 = 当前体力值（弃牌阶段"该弃几张"与 UI 提示都走 `skill-rules.ts` 的 `getHandLimit`）：

- `rules.handLimitDelta`：**固定数值**修正（多个技能求和）。
- `handLimit(player)`：**运行时变量**修正，代码技能提供，必须是**纯函数**（只读传入的 player）——
  因为 UI（`render-lines.ts`）与引擎拿同一份快照要算出同一个上限，读全局状态会让两边不一致。

```ts
// 绝境：手牌上限 + 已损失体力值
handLimit: (player) => Math.max(0, player.maxHp - player.hp),
```


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
| `handLimitDelta` | number | 手牌上限 +N（默认上限 = 当前体力值） | 求和 | 无内置使用者；运行时变量请用代码技能的 `handLimit(player)`（示例包神赵云「绝境」） |

- `TargetImmunityCard` = `"slash" \| "duel" \| "snatch" \| "indulgence" \| "supplies-cut"`。
- `drawPhaseDelta` / `damageDelta` 属「发动后本回合生效」：触发时机仍由技能自身的钩子 / `isSkillUsed` 门控，`rules` 只提供数值。
- 外部包的 `rules` 会被 **schema 校验**（`general-pack.ts validateRules`）：未知键、类型不符、`targetImmunity.cards` 非法 → 抛错（隔离进 `report.errors`；`--strict-generals` 时整体失败）。词汇表的单一真相是 `skill-registry.ts` 的 `SKILL_RULE_KEY_KINDS`（校验器/文档/测试都读它；有测试卡住它与 `validateRules` 的漂移）。

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
- 伤害/死亡：`applyDamage`（随后必须自己结算死亡/胜负，见下）、`useSlash(attacker, target, {kind, card})`（完整结算一张杀：含闪响应/铁骑/藤甲/濒死/胜负/回合推进）。
- 回合状态：`skillUsedThisTurn` / `markSkillUsed`（外部技能无 `oncePerTurn` 自动限制，需要限次请在 `canUse` 里查 `skillUsedThisTurn` 并在 `play` 里 `markSkillUsed`）。

调用方必须自己做的事（漏做会静默坏掉）：

- `requestDiscardSelection` 返回的牌**不会自动进弃牌堆**，调用方必须自己 `discardPile.push`（见 `skills.ts` 现有写法）。
- 造成伤害后必须走 `resolveDeaths` → `resolveWinner` → `advanceIfCurrentPlayerDead`，否则濒死/胜负不结算。
- 失去手牌必须走 `removeHandCardAt`，否则连营不触发。
- 随机数禁止 `Math.random`，用 `ctx.randomIndex`，否则 `--seed` 复现与联机一致性失效。
- `judgment` 钩子改判时，必须自己把替换牌从原区域移除（`removeHandCardAt` / `removeUsableCardBySourceId`）；引擎只负责把它置入弃牌堆。
- `hand_card_lost` 属于"通知"型钩子：调用方没传 `logs` 时（如 `takeRandomHandCard`）钩子日志会被丢弃，别把关键状态只写进日志。
- `peach_save` / `discard_phase_start` 是"拦截"型钩子：改的是 payload 字段（`peachSaveBonus` / `skipDiscardPhase`），不要自己直接改 `player.hp` 或跳过结算。
- **触发性技能没有"交互式选目标"**：`InteractionRequest` 只有 `respond`/`collateral`/`choose-discard`/`choose-suit`/`optional-effect` 五种，没有"选一名玩家"。内置技能的做法是**自动挑选**（「英魂」按体力/手牌排序取第一个）或使用固定目标（「反馈」= 伤害来源、「奸雄」= 自己）。需要玩家真正点人的技能请做成 `kind: "active"`（`getTargets` + `play(targetId)`），或像内置那样自动挑并在 `description` 里说明。
- **`judgment` 钩子只能改判"归属者自己"的判定**：`drawJudgmentCard` 的 payload 只有 `actor = owner`，包钩子又只在事件相关玩家（`actor`/`target`/`source`）拥有该技能时执行。所以外部「鬼道」这类技能影响不到别人的判定——内置「鬼才」不受限，因为它的实现在 `game.ts` 里做全局玩家搜索。这是内置与外部的一处真实能力不对称。
- **别在钩子里做会再次触发同一钩子的事**：`card_used` 钩子里再"使用一张牌"、`hand_card_lost` 钩子里再移除手牌都会无限递归（引擎不设保护）。需要递归语义时用 `skillFlagsThisTurn` 之类的状态自己打断。

## 作者类型补全与结构校验（§17 ②③）

- **类型签名**：`types/generals-pack.d.ts` 是独立于 `src/` 的作者契约。代码技能顶部加
  `import type { SkillModule, SkillModuleCtx } from "../../types/generals-pack.js";`（包在 `examples/generals/<武将>/` 下时多一层 `../../../`），
  对象写成 `export default { … } satisfies SkillModule;`，即可获得补全与类型检查。`import type` 在运行时被完全擦除，因此该相对路径不影响加载。
  > `.ts` 技能只有 bun/tsx（`npm run dev`/`host`/`generals:check`）会做语法转译；纯 node 环境请用 `.mjs` 或 `--generals-json-only`。
- **结构约束**：`schema/general.schema.json` / `schema/skill.schema.json`（JSON Schema draft-07）供编辑器与 agent 机器读取。
  两份 schema 与代码的枚举/字段一一对应，由 `src/tools/pack-schema.test.ts` 卡住漂移；`.skill.json` 里写代码技能专有字段（`play`/`onTrigger`/`handLimit`…）会被 schema 判为未知字段。
- **可抄的参考实现**：`examples/generals/`（默认不加载），机制覆盖矩阵见 `examples/generals/README.md`。
  注意外部包**不能与内置武将同名**（loader 会以"武将名重复"整包拒绝）。

## AI 如何认识本局武将（4 个消费点）

数据源统一是**快照的 `player.skills`**（不是武将定义），因此魂姿觉醒等"临时获得技能"自动覆盖：

| 消费点 | 落点 | 用法 |
|---|---|---|
| LLM | `src/agent/prompt.ts` + `ai.ts`、`server.ts`、`app.ts` | `buildMatchGeneralsText(snapshot)` 作为 `matchGeneralsText` 注入 systemPrompt |
| Jev 快决策 | `src/agent/jev-advisor.ts` | state 的 `match_skills` 字段 |
| 本地策略 | `src/agent/local-engine.ts` | `getMatchGeneralsText()` 持有同一份文本（缓存），并用 `resolveSkillDescriptor` 读 `targetIntent` 等元数据选目标 |
| 规则文本 | `src/agent/match-context.ts` | `stripGeneralsSections` 从 `rules.md` 剔除 §14/§16.3，避免与动态注入重复 |

## 写完就自检（M4）

**不读 `src/`** 也能拿到反馈的三条通道：

```bash
npm run generals:check -- --dir=generals          # schema + 语义 lint（文本报告）
npm run generals:check -- --dir=generals --json   # 机器可读（CI / agent 消费）
npm run generals:check -- --dir=generals --strict # 警告也算失败
npm run generals:check -- --dir=generals --selfplay=3  # 每个武将强制上场跑 3 局不变量断言
```

校验器（`src/tools/generals-check.ts`）做两件事：

1. **权威检查**：直接调用真实 loader，报告 schema/文件缺失/rules 非法等错误；
2. **静态 lint**：抓 loader 会**静默吞掉**的东西——未知触发点名（会被丢弃）、未知顶层字段（拼错 `rule`/`trigers`）、
   既无 `triggers` 也无 `rules` 的"空技能"、`kind: "active"` 但没有 `play()`、`kind: "conversion"` 却没有 `conversions`、
   非主动技能上写了 `targetIntent`、`general.json` 的 name 与文件夹名不一致、技能同时存在 JSON 与代码版本……
   （"合法但永远不会生效"的 `conversions`——比如 `to` 是闪却没有 `asResponse`——也在这一类。）

退出码：有错误（或 `--strict` 下的警告）为 `1`，`--json` 时完整报告打到 stdout，可直接给 agent 当反馈。

`--selfplay=N` 会用 `src/tools/selfplay.ts` 的无头自对弈（`forceGeneral` 把该武将指派给全场，保证技能被走到），
断言"不崩、不卡死、体力/生死自洽"，同一 seed 必然复现同一局。规则文档的武将章节则由 `npm run rules:check` 卡住漂移。

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
# 方式一：复制示例到项目根 generals/ 后 npm run dev 选将出现吕蒙/神赵云
cp -r examples/generals/吕蒙 generals/吕蒙 && npm run dev

# 方式二：直接把示例目录当武将包目录（吕蒙 + 神赵云一起进池）
npm run dev -- --generals-dir=examples/generals

# 自检：0 错误 / 0 警告（示例包是干净基线）
npm run generals:check -- --dir=examples/generals

# host 默认不含外部包；显式 all 才加载
npm run host -- --players=3
npm run host -- --players=3 --generals-pool=all
```
