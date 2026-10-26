# 界刘谌

蜀势力，男，4 体力。技能：**战绝**。

| 文件 | 作用 |
|---|---|
| `general.json` | 元数据 + 技能列表（`skills: ["战绝"]`） |
| `战绝.skill.ts` | **代码**技能：出牌阶段的主动技能，全部手牌当决斗使用 |
| `general.md` | 本文件 |

## 技能

- **战绝**（代码，主动）：出牌阶段，你可以将所有手牌当使用，然后你和受伤的角色各摸一张牌。若你此法摸过两张或更多的牌，则本回合"战绝"失效。

## 用到的 API 与触发点

| 项 | 用法 |
|---|---|
| 技能类型 | `kind: "active"` + `requiresTarget: true` + `targetIntent: "enemy"` |
| 代价 | 全部手牌（至少一张）：逐张 `ctx.removeUsableCardBySourceId(player, "hand:<id>")`（手牌来源，内部走 `removeHandCardAt`，触发连营等"失去手牌"钩子），调用方手动 `discardPile.push` |
| 决斗结算 | `ctx.resolveDuel(player, target)`（内部已处理空城、无懈可击、轮流出杀、伤害结算；无实体决斗牌，传 undefined） |
| 伤害结算 | 决斗后自行 `resolveDeaths()` → `resolveWinner()` → `advanceIfCurrentPlayerDead(logs)` |
| "受伤的角色"判定 | 决斗前后体力对比（`resolveDuel` 只返回日志不返回胜负） |
| 摸牌规则 | 目标受伤：刘谌摸 1 张，目标摸 1 张；刘谌受伤：刘谌摸 2 张（"你"1 张 + "受伤的角色"1 张）；无人受伤（无懈可击抵消等）：刘谌仍摸 1 张（官方 FAQ） |
| 失效计数 | 本回合刘谌经战绝摸牌累计数，存在 `ctx.skillCountsThisTurn.get(player.id)` 的 `战绝摸牌` key 里（引擎每回合自动重置）；累计 ≥ 2 时 `canUse` 返回 false |

## 已知限制

无。本包为界刘谌官方设计的完整复刻。

## 规则依据

三国杀界限突破界刘谌「战绝」（一将成名2015版）：出牌阶段，你可以将所有手牌当使用，然后你和受伤的角色各摸一张牌。若你此法摸过两张或更多的牌，则本回合"战绝"失效。
