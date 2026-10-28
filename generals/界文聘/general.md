# 界文聘

魏势力，男，4 体力。技能：**镇卫**。

| 文件 | 作用 |
|---|---|
| `general.json` | 元数据 + 技能列表（`skills: ["镇卫"]`） |
| `镇卫.skill.ts` | **代码**技能：`slash_targeted` 钩子，成为杀目标后可摸一张牌 |
| `general.md` | 本文件 |

## 技能

- **镇卫**（代码，触发）：当你成为其他角色使用或的目标后，你可以摸一张牌。

## 用到的 API 与触发点

| 项 | 用法 |
|---|---|
| 技能类型 | `kind: "triggered"` + `triggers: ["slash_targeted"]` |
| 目标与来源确认 | `slash_targeted` 的 payload 里 `target` 为被杀目标、`source` 为出杀者；钩子确认 `target` 拥有本技能且 `source` 是其他存活角色（自己对自己出杀不触发，官方"其他角色"限定） |
| 可选发动 | `ctx.shouldActivateOptionalEffect(target, "界文聘/镇卫")` 询问，AI 按策略回答 |
| 摸牌 | `ctx.drawCards(target.id, 1)` |
| 不取消杀 | 不改写 `payload.canceled`，镇卫只摸牌、不取消本次杀 |

## 已知限制

1. **决斗目标部分暂不支持**：成为目标没有对应钩子（只有 `slash_targeted`），故本包只实现"成为目标"的部分。

## 规则依据

三国杀界限突破界文聘「镇卫」：当你成为其他角色使用或的目标后，你可以摸一张牌。除上述如实记录的限制外完整复刻。
