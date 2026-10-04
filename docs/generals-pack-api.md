# 武将包 API

对应 `docs/generals-pack-plan.md` §二/§三。M1 落地契约类型与「AI 只读本局武将技能」，M2 落地外部包加载与执行，M3 落地声明式规则数据化（`.skill.json` 的 `rules` 经 `skill-rules.ts` 谓词层参与结算）。

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
  triggers?: SkillTrigger[];      // "turn_start" | "before_draw" | "before_damage" | "after_damage"
  optional?: boolean;
  priority?: number;
  requiresTarget?: boolean;
  label?: string;                 // 出牌动作标签
  rules?: SkillRules;             // 声明式规则数值/豁免（见下「规则词汇表」）
  canUse?(ctx, player): boolean;
  getTargets?(ctx, player): string[];
  play?(ctx, player, targetId?): Promise<string[]>;
  onTrigger?: Partial<Record<SkillTrigger, (ctx, payload, logs) => void | Promise<void>>>;
};
```

内置 45 个技能的元数据登记在 `src/engine/skill-registry.ts`，`description` 以**代码行为**为准（已知与旧文档的漂移按实现写，注释标 `NOTE(§8歧义N)`）。

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

- `TargetImmunityCard` = `"slash" \| "duel" \| "snatch" \| "indulgence" \| "supplies-cut"`。
- `drawPhaseDelta` / `damageDelta` 属「发动后本回合生效」：触发时机仍由技能自身的钩子 / `isSkillUsed` 门控，`rules` 只提供数值。
- 外部包的 `rules` 会被 **schema 校验**（`general-pack.ts validateRules`）：未知键、类型不符、`targetImmunity.cards` 非法 → 抛错（隔离进 `report.errors`；`--strict-generals` 时整体失败）。

## 执行语义（M2/M3）

- **主动技能（`kind: "active"`）**：`getPlayableActions` 会为「持有该技能」的当前玩家枚举 `{type:"skill", skill: id, label, requiresTarget, targets}`；`requiresTarget` 为真但 `getTargets` 返回空时跳过。`playAction` 命中后调用 `play`，返回值并入对局日志。
- **触发钩子（`onTrigger`）**：`createSkillHooks` 会在每个触发点的内置钩子之后追加外部钩子；钩子首参是引擎 ctx（运行时就是存活的 `SanGuoGame` 实例），需自行用 `ctx.hasSkill(player, id)` 判断归属。
- **声明式技能（`.skill.json`）**：M2 加载 + 校验 + 供 AI 阅读；M3 起其 `rules` 经谓词层参与结算（见上表），非 `rules` 词汇表可表达的效果仍待 Phase 6 拦截点。
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
