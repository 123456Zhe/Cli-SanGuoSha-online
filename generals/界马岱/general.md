# 界马岱

蜀势力，男，4 体力。技能：**马术**、**潜袭**。

| 文件 | 作用 |
|---|---|
| `general.json` | 元数据 + 技能列表（`skills: ["马术", "潜袭"]`） |
| `马术.skill.json` | **声明式**技能：`rules.distanceDelta: -1` |
| `潜袭.skill.ts` | **代码**技能：`before_damage` 钩子，杀伤害时判定，非红桃则伤害+1 |
| `general.md` | 本文件 |

## 技能

- **马术**（声明式，被动）：锁定技，你计算与其他角色的距离-1。
- **潜袭**（代码，触发）：每当你使用对目标角色造成伤害时，你可以进行一次判定，若判定结果不为红桃，则此伤害+1。

## 用到的 API 与触发点

| 项 | 用法 |
|---|---|
| 技能类型 | 马术 `kind: "passive"` + `rules.distanceDelta: -1`（声明式，无需代码）；潜袭 `kind: "triggered"` + `triggers: ["before_damage"]` |
| 伤害来源确认 | `before_damage` 的 payload 里没有 `actor`，用 `payload.source` 并 `ctx.hasSkill(source, "界马岱/潜袭")` 确认 |
| "使用"判定 | `payload.card?.type` 为 杀/火杀/雷杀（`applyDamage` 的 `damageCard` 透传）；决斗/南蛮/技能伤害不触发 |
| 可选发动 | `ctx.shouldActivateOptionalEffect(source, "界马岱/潜袭")` 询问，AI 按策略回答 |
| 判定 | `ctx.drawJudgmentCard("潜袭", logs, source)`（自动触发 `judgment` 钩子，支持改判；判定牌进弃牌堆由引擎处理） |
| 伤害+1 | 判定牌 `suit!== "heart"` 时 `payload.damage = (payload.damage?? 1) + 1`；引擎在钩子返回后用 `payload.damage` 作最终伤害（game.ts 2616 行），改写即生效 |

## 已知限制

无。本包为界马岱官方设计的完整复刻（马术/潜袭与标准版一致，界限突破未改动）。

## 规则依据

三国杀界限突破界马岱「马术」「潜袭」。
