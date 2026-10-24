# 界吴懿

蜀势力，男，4 体力。技能：**奔袭**。

| 文件 | 作用 |
|---|---|
| `general.json` | 元数据 + 技能列表（`skills: [\"奔袭\"]`） |
| `奔袭.skill.ts` | **代码**技能：触发性技能的完整可执行实现 |
| `general.md` | 本文件 |

## 技能

- **奔袭**（代码，触发）：每当你使用或打出【杀】或【闪】时，你可以弃置一张牌，然后摸一张牌。

## 用到的 API 与触发点

| 项 | 用法 |
|---|---|
| 技能类型 | `kind: \"triggered\"` + `optional: true` + `triggers: [\"card_used\"]` |
| 触发判定 | `payload.actor` 存活且 `ctx.hasSkill(actor, \"界吴懿/奔袭\")`；`payload.card?.type ∈ {杀, 火杀, 雷杀, 闪}` |
| \"使用\"口径 | `payload.reason ∈ {\"使用\", \"打出\"}` 均触发（见下文规则依据） |
| 发动询问 | `ctx.shouldActivateOptionalEffect(actor, \"界吴懿/奔袭\")`（AI 固定策略自动决策） |
| 弃置手牌 | `ctx.buildUsableSources` 取 `origin === \"hand\"` 来源 → `choose-discard` 选 1 张 → `ctx.removeUsableCardBySourceId` + 手动 `discardPile.push`（与强袭一致） |
| 摸牌 | `ctx.drawCards(actor.id, 1)` |
| 无手牌时 | 直接跳过（无法支付代价，不询问） |

## 已知限制

1. **弃置限定手牌**：官方 FAQ 允许弃置装备区牌；引擎选牌交互暂只支持手牌来源，装备区牌不可弃置。
2. **\"使用\"含\"打出\"为口径假设**：官方卡牌文本只写\"使用\"，此处按技能功能与常用口径把打出响应也计入；若官方严格口径仅限\"使用\"，改一行 `USE_REASONS` 即可收紧。

## 规则依据

吴懿「奔袭」（一将成名 2014，官方卡牌文本）：每当你使用或打出【杀】或【闪】时，你可以弃置一张牌，然后摸一张牌。锁定技但带\"可以\"选择，故按狂骨先例记 `optional: true`。本包完整复刻，仅弃置范围按上述简化。
