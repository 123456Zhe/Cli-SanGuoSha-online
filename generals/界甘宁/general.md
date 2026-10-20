# 界甘宁

吴势力，男，4 体力。技能：**奇袭**。

| 文件 | 作用 |
|---|---|
| `general.json` | 元数据 + 技能列表（`skills: ["奇袭"]`） |
| `奇袭.skill.ts` | **代码**技能：主动技能的完整可执行实现 |
| `general.md` | 本文件 |

## 技能

- **奇袭**（代码，主动）：出牌阶段，你可以将一张黑色手牌当使用，弃置一名其他角色区域里的一张牌。

## 用到的 API 与触发点

| 项 | 用法 |
|---|---|
| 技能种 | `kind: "active"`，`requiresTarget: true`（引擎提供交互式选目标），`targetIntent: "enemy"`（只影响 AI 选目标） |
| 可用判断 | `canUse`：手牌中有黑色牌（`card.color === "black"`，含黑桃/梅花） |
| 选牌 | `ctx.decide({ kind: "choose-discard",...})`，来源限定黑色手牌（`buildUsableSources` 过滤 `origin === "hand"`） |
| 弃置自己所选的牌 | `ctx.removeUsableCardBySourceId(player, sourceId)`，返回的牌**不会**自动进弃牌堆，调用方手动 `ctx.discardPile.push` |
| 弃置目标的牌 | `ctx.removeRandomCardFromPlayer(target, "弃置", undefined)`（无牌可弃时返回空数组，天然安全） |

## 已知限制

官方奇袭是"由你选择弃置目标角色区域里的一张牌"（可指定弃手牌/装备/判定区）。
本引擎的主动技能选牌只能选自己的牌，无法交互式指定"对方的哪张牌"，因此被弃置的牌
由引擎在目标的手牌/装备区里随机选择（`randomIndex`，`--seed` 可复现）。数值期望一致，
策略精度略有损失，已在描述中如实说明。

## 规则依据

三国杀界限突破界甘宁「奇袭」。除上述"被弃牌随机选择"简化外完整复刻。
