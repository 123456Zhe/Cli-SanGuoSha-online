# 界周仓

蜀势力，男，4 体力。技能：**忠勇**。

| 文件 | 作用 |
|---|---|
| `general.json` | 元数据 + 技能列表（`skills: ["忠勇"]`） |
| `忠勇.skill.ts` | **代码**技能：`slash_targeted` 钩子，出牌阶段出杀指定目标后令其弃一张手牌 |
| `general.md` | 本文件 |

## 技能

- **忠勇**（代码，触发）：当你于出牌阶段内使用指定目标后，你可以令其弃置一张牌。

## 用到的 API 与触发点

| 项 | 用法 |
|---|---|
| 技能类型 | `kind: "triggered"` + `triggers: ["slash_targeted"]` |
| 时机 | `slash_targeted` 在指定目标时触发，payload 里 `source` 为出杀者、`target` 为被杀目标——正好对应"使用指定目标后"（闪响应之前） |
| 出牌阶段内 | `ctx.currentPlayer.id === source.id && ctx.phase === "出牌阶段"` 精确判断，其他阶段出杀不触发 |
| 可选发动 | `ctx.shouldActivateOptionalEffect(source, "界周仓/忠勇")` 询问出杀者，AI 按策略回答 |
| 弃牌 | 目标自己选一张手牌弃置（`requestDiscardSelection(target, …)`，返回的牌调用方手动 `discardPile.push`，与飞军代价同一约定） |
| 不取消杀 | 不改写 `payload.canceled`，忠勇只令目标弃牌、不取消本次杀 |

## 已知限制

无。本包为界周仓「忠勇」的完整复刻。

## 规则依据

三国杀界限突破界周仓「忠勇」：当你于出牌阶段内使用指定目标后，你可以令其弃置一张牌。
