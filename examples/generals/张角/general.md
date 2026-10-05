# 张角（参考实现：`judgment` 改判 + `card_used` 触发判定伤害）

群雄，男，3 体力。技能：**鬼道**、**雷击**。标准版技能文本，受引擎能力限制处见下文「引擎限制」。
本包是 gallery 里 **判定类拦截点（`judgment`）** 与 **事件触发点（`card_used`）** 的抄写样板，
两个技能都真正生效（自对弈日志可复现，见「触发证据」）。

## 文件

| 文件 | 作用 |
|---|---|
| `general.json` | 元数据：`apiVersion: 1`、`name: "张角"`（= 文件夹名）、`kingdom: "群雄"`、`gender: "男"`、`maxHp: 3`、`skills: ["鬼道", "雷击"]` |
| `鬼道.skill.ts` | 代码技能：`judgment` 拦截点改判（对照内置「鬼才」） |
| `雷击.skill.ts` | 代码技能：`card_used` 触发点 → 判定 → `applyDamage` 雷电伤害 |
| `general.md` | 本文档 |

技能 id 由 loader 命名空间化为 `张角/鬼道`、`张角/雷击`——代码里的 `ctx.hasSkill(player, "张角/鬼道")`
写的就是这个命名空间 id（不是 `"鬼道"`）。

## 技能一：鬼道（`judgment` 拦截点）

**触发点**：`judgment` —— 判定牌已翻开并进入弃牌堆后、内置「鬼才」之前发出
（`game.ts` 的 `drawJudgmentCard`）。`payload`：

| 字段 | 含义 |
|---|---|
| `actor` | **判定牌归属者**（`drawJudgmentCard(reason, logs, owner)` 的 `owner`） |
| `reason` | 判定原因文本（如 `甲 的雷击`） |
| `card` / `judgmentCard` | 当前判定牌；把 `judgmentCard` 换成别的牌 = 改判 |

**流程（`鬼道.skill.ts`）**：

1. `payload.actor` 存在且 `ctx.hasSkill(actor, "张角/鬼道")`（自查，与内置钩子写法一致）；
2. 只读遍历 `actor.hand`，筛出 `card.color === "black"` 的**黑色**手牌（黑桃/梅花）——这是与「鬼才」唯一的差别；
3. 用 `ctx.decide({ kind: "choose-discard", ... allowPass: true, passLabel: "不发动鬼道" })` 询问是否发动、用哪张
   （照抄内置「鬼才」的询问结构）；
4. 用牌 id 重新定位下标，`ctx.removeHandCardAt(actor, index, logs)` 把替换牌移出手牌
   （走这条路径才会触发 `hand_card_lost` 等钩子）；
5. `payload.judgmentCard = replacement` 交给引擎——**引擎负责把它置入弃牌堆并记日志，钩子不要自己 push 弃牌堆**。

用到的 ctx 能力：`hasSkill` / `decide` / `nextInteractionId` / `removeHandCardAt`，外加对 `ctx.players`、`player.hand` 的只读遍历。

## 技能二：雷击（`card_used` 事件触发点）

**触发点**：`card_used` —— 使用一张牌（`reason="使用"`，`resolveUsedCard`）或打出一张响应牌
（`reason="打出"`，`consumeResponseCard`）。`payload.actor` = 使用/打出这张牌的玩家（即技能持有者）、
`payload.card` = 那张牌、`payload.reason` = `"使用" | "打出"`。

**流程（`雷击.skill.ts`）**：

1. `payload.actor` 存活且 `ctx.hasSkill(actor, "张角/雷击")`；
2. `payload.card?.type === "闪"` 且 `payload.reason` 是 `"使用"`/`"打出"`；
3. **自动挑选**一名其他存活角色（体力最低者，体力相同取手牌少者）；
4. `ctx.shouldActivateOptionalEffect(actor, "张角/雷击")` 询问是否发动；
5. `ctx.drawJudgmentCard("${actor.name} 的雷击", logs, actor)` 判定，返回牌的 `suit === "spade"` 才算成功
   （返回的是**改判后**的最终判定牌，所以鬼道介入的结果会被正确读到）；
6. 成功则 `ctx.applyDamage(actor, target, 2, "雷击", logs, judgment, "thunder")`
   （`damageKind="thunder"` 让铁索连环按雷电属性传导，`damageCard` = 那张黑桃判定牌）；
7. 伤害之后**必须**依次 `await ctx.resolveDeaths()` → `ctx.resolveWinner()` → `await ctx.advanceIfCurrentPlayerDead(logs)`。

用到的 ctx 能力：`hasSkill` / `shouldActivateOptionalEffect` / `drawJudgmentCard` / `applyDamage` /
`resolveDeaths` / `resolveWinner` / `advanceIfCurrentPlayerDead`，外加对 `ctx.players` 的只读遍历。

钩子里没有再次"使用"牌，所以 `card_used` 不会自我递归（判定走的是 `judgment` 钩子，伤害走的是 `before/after_damage`）。

## 引擎限制（照抄前请先读）

1. **触发性技能无法交互式选目标**。`InteractionRequest` 只有 `respond / collateral / choose-discard /
   choose-suit / optional-effect`，**没有「选一名玩家」**，所以雷击照内置「英魂」的做法**自动挑选**：
   其他存活角色中体力最低者，体力相同取手牌少者（`[...others].sort((a, b) => a.hp - b.hp || a.hand.length - b.hand.length)[0]`）。
   想真正让玩家选人，只能把技能改成 `kind: "active"` + `getTargets`（那就不是"使用闪时触发"了）。
2. **`judgment` 钩子只分发给「判定牌归属者」的技能**。`createSkillHooks` 的门控是
   `[payload.actor, payload.target, payload.source].some(p => p.skills.includes(技能id))`，
   而 `drawJudgmentCard` 的 payload 只有 `actor = owner`。所以外部包的鬼道**只能改判归属者自己的判定**
   （内置「鬼才」不受此限，因为它的实现写在 `game.ts` 里、对全场玩家做全局搜索）。
   官方鬼道是"当**一名角色**的判定牌生效前"——跨角色改判（含官方经典的"雷击令目标判定 + 鬼道改判"）
   **用现有 API 做不到**。本包按引擎限制处理：雷击的判定归属传**张角本人**
   （`drawJudgmentCard(..., actor)`），这样张角的鬼道才能改判这次判定，连招在本引擎里成立；
   代价是判定人从"被指定的角色"变成了"张角自己"。
3. **可选发动的询问方式不同**：鬼道与内置「鬼才」一样走 `choose-discard`（要同时选牌），
   雷击走 `optional-effect`。两者在自对弈里都被 `answerInteraction` 一律应答为"发动"。

## 触发证据

用与 `runSelfPlay` 相同的编排（全座位强制张角、`answerInteraction` 应答、`mulberry32` 种子 RNG）
跑 3 局并收集日志，节选（seed=20240101）：

```
已加载武将： 张角 群雄 男 3 ["张角/鬼道","张角/雷击"]
总日志行: 1233 | 含鬼道/雷击: 39
  - 甲 发动雷击，指定 丙，开始判定
  - 甲 的雷击判定牌：方片5 铁索连环
  - 甲 发动鬼道，以 黑桃13 杀 替换判定牌 方片5 铁索连环
  - 甲 的雷击判定牌被替换：铁索连环[方片5] → 杀[黑桃K]
  - 甲 的雷击判定成功，对 丙 造成 2 点雷电伤害
  - 乙 发动雷击，指定 丙，开始判定
  - 乙 的雷击判定牌：红桃11 八卦阵
  - 乙 的雷击判定失败（非黑桃），丙 未受到伤害
```

这段日志同时证明了两条代码路径：`card_used`（闪）→ 雷击 → `judgment` → 鬼道改判 → 判定为黑桃 → 2 点雷电伤害；
以及非黑桃时"判定失败、不造成伤害"的分支。

## 验收

```bash
npm run generals:check -- --dir=examples/generals --strict
# [generals-check] 目录：…/examples/generals
# ✔ 张角：群雄 / 技能 2
#     鬼道[triggered]、雷击[triggered]
# [generals-check] 1 个包：0 个错误 / 0 个警告（--strict：警告也视为失败）

npm run generals:check -- --dir=examples/generals --selfplay=3
# [selfplay] 张角：3 局，分出胜负 3 局，违规 0 条
# [generals-check] 1 个包：0 个错误 / 0 个警告
```

## 使用

```bash
# 放到最终位置后（examples/generals/张角）：
npm run dev -- --generals-dir=examples/generals
npm run generals:check -- --dir=examples/generals --selfplay=3

# 或复制进项目根的 generals/ 后 npm run dev 随机抽到张角
cp -r examples/generals/张角 generals/张角 && npm run dev
```

联机主机默认不加载外部包（外部包等同任意代码执行），需显式 `--generals-pool=all`。

## 说明

- 两个技能文件都只用 `import type`，类型在运行时被完全擦除；`../../../types/generals-pack.js` 指向仓库根的
  `types/generals-pack.d.ts`（本文件位于 `examples/generals/张角/`，`../../../` 即仓库根），只影响编辑器补全与 `tsc`。
- 禁止 `Math.random`：本包没有随机决策（鬼道用交互询问、雷击用确定性排序），因此不涉及 `ctx.randomIndex`。
- 顺序：`drawJudgmentCard` 里 `judgment` 钩子先发出，**内置「鬼才」的询问在那之后**才执行
  （包先改、内置最后拍板，见 `skill-hooks.ts` 的注释）。所以同一张判定牌上，内置鬼才若发动，会覆盖鬼道的改判结果。
