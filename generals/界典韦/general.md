# 界典韦

魏势力，男，4 体力。技能：**强袭**。

| 文件 | 作用 |
|---|---|
| `general.json` | 元数据 + 技能列表（`skills: ["强袭"]`） |
| `强袭.skill.ts` | **代码**技能：主动技能的完整可执行实现 |
| `general.md` | 本文件 |

## 技能

- **强袭**（代码，主动）：出牌阶段对每名角色各限一次，你可以失去 1 点体力或弃置一张武器牌，然后对攻击范围内的一名其他角色造成 1 点伤害。

## 用到的 API 与触发点

| 项 | 用法 |
|---|---|
| 技能类型 | `kind: "active"` + `requiresTarget: true` + `targetIntent: "enemy"`（只影响 AI 选目标） |
| 对每名角色各限一次 | 按目标分别计数，key 为 `强袭:<targetId>`，存在 `ctx.skillCountsThisTurn.get(player.id)` 里（引擎每回合自动重置）；`canUse` 只判断是否还有可指定的目标，`getTargets` 过滤掉本回合已指定过的 |
| 代价二选一 | 有武器牌时 `ctx.decide({kind: "optional-effect"})` 询问"弃置武器牌 / 失去 1 点体力"；无武器牌时直接失去体力 |
| 失去体力 | 直接 `player.hp -= 1`（是"失去"非"受到伤害"，不走 `applyDamage`，不触发 before/after_damage 钩子）；1 体力也可发动，发动后先结算自己的濒死/死亡 |
| 弃置武器牌 | 手牌中的武器牌走 `choose-discard` 选牌（调用方手动 `discardPile.push`）；已装备的武器无 Card 实体，直接置空并向 `discardPile` 补一张合成牌（`{type: 武器名, suit: "none", rank: 0, color: "colorless"}`） |
| 伤害结算 | `ctx.applyDamage(player, target, 1, "强袭", logs)` → `resolveDeaths()` → `resolveWinner()` → `advanceIfCurrentPlayerDead(logs)` |
| 对局结束判断 | `resolveWinner()` 返回非空数组即已分出胜负，此时不再对目标造成伤害 |

## 已知限制

1. **"攻击范围内"简化为任意其他存活角色**：距离计算需要引擎内部逻辑，本引擎未向武将包暴露距离 API，不计距离/马匹修正。
2. **弃置已装备武器未触发 `equip_lost` 钩子**：`SkillModuleCtx` 未暴露 `onLoseEquip`，枭姬等"失去装备"类技能不触发。

## 规则依据

三国杀界限突破界典韦「强袭」（2020 版）：出牌阶段对每名角色各限一次，你可以失去 1 点体力或弃置一张武器牌，然后对攻击范围内的一名其他角色造成 1 点伤害。官方 FAQ：武器牌包括手牌和已装备的牌；1 体力时可以失去体力发动，典韦先进入濒死结算，无论是否被救回（只要对局未结束）目标仍受到 1 点伤害。本包完整复刻，仅"攻击范围"按上述简化。
