# 马良

蜀势力，男，3 体力。技能：**自书**、**应援**。

| 文件 | 作用 |
|---|---|
| `general.json` | 元数据 + 技能列表（`skills: ["自书", "应援"]`） |
| `自书.skill.json` | **声明式**技能：`rules.handLimitDelta = 2` |
| `应援.skill.ts` | **代码**技能：`card_used` 事件钩子的完整可执行实现 |
| `general.md` | 本文件 |

## 技能

- **自书**（声明式，被动）：锁定技，你的手牌上限+2。
- **应援**（代码，触发）：每当你于回合内使用一张基本牌、锦囊牌或装备牌时，你可以令一名其他角色摸一张牌。

## 用到的 API 与触发点

| 项 | 用法 |
|---|---|
| 触发点 | `card_used`（`resolveUsedCard` reason="使用" / `consumeResponseCard` reason="打出"） |
| payload | `payload.actor` = 用牌者；`payload.card.type` = 中文牌类名；`payload.reason` = "使用" \| "打出" |
| 回合内判定 | `ctx.currentPlayer.id === actor.id`（只统计马良自己回合内使用的牌） |
| 归属判定 | `ctx.hasSkill(actor, "马良/应援")`——外部技能 id 已按文件夹命名空间化 |
| 可选询问 | `ctx.shouldActivateOptionalEffect(actor, "马良/应援")`（技能声明 `optional: true`） |
| 摸牌 | `ctx.drawCards(beneficiary.id, 1)` |

## 已知限制：目标角色由引擎自动挑选（非玩家选择）

**触发性技能没有交互式"选角色"的请求类型。**"一名其他角色"在本引擎里无法交给玩家/AI
交互完成，排序口径：其他存活角色里手牌最少者优先，手牌相同按 id 升序，
保证 `--seed` 复现与联机一致（与荀彧「节命」的口径一致）。

## 规则依据

界马良（三国杀官方）：自书——锁定技，你的手牌上限+2；应援——每当你于回合内使用一张
基本牌、锦囊牌或装备牌时，你可以令一名其他角色摸一张牌。本包为完整复刻，无简化。
