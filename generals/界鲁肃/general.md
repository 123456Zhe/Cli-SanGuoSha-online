# 界鲁肃

吴势力，男，3 体力。技能：**好施**、**缔盟**。

| 文件 | 作用 |
|---|---|
| `general.json` | 元数据 + 技能列表（`skills: ["好施", "缔盟"]`） |
| `好施.skill.ts` | **代码**技能：`before_draw` 钩子，额外摸两张 + 给两张手牌 |
| `缔盟.skill.ts` | **代码**技能：出牌阶段限一次的主动技能，两名其他角色交换手牌 |
| `general.md` | 本文件 |

## 技能

- **好施**（代码，触发）：摸牌阶段，你可以额外摸两张牌，然后将两张手牌交给一名手牌最少的其他角色。
- **缔盟**（代码，主动）：出牌阶段限一次，你可以令两名手牌数不同的其他角色交换手牌。

## 用到的 API 与触发点

| 项 | 用法 |
|---|---|
| 技能类型 | 好施 `kind: "triggered"` + `triggers: ["before_draw"]`；缔盟 `kind: "active"` + `requiresTarget: false` + `targetIntent: "ally"` |
| 好施可选发动 | `ctx.shouldActivateOptionalEffect(actor, "界鲁肃/好施")` 询问，AI 按策略回答 |
| 额外摸两张 | 钩子里直接 `ctx.drawCards(actor.id, 2)`（走绝境同路），不改 `payload.drawCount`，随后引擎仍正常执行摸牌阶段摸牌 |
| 给牌 | `ctx.requestDiscardSelection(actor, 2, reason, 手牌来源限定)` 选两张（内部已 `removeUsableCardBySourceId` 移出手牌，触发连营等"失去手牌"钩子）；调用方不进弃牌堆，改为 `target.hand.push(card)` 交给目标 |
| 给牌目标 | 手牌最少者（并列取 id 升序首位），与荀彧「节命」同口径 |
| 缔盟目标 | 触发技无交互式选角请求类型，故 `requiresTarget: false`，在 `play` 里自动挑选：手牌最多者与手牌最少者（并列取 id 升序首位）；若两者手牌数相同则 `canUse` 返回 false |
| 缔盟交换 | 直接数组互换（`splice` 取出再 `push` 回，保持数组引用不变） |
| 缔盟限一次 | `canUse` 查 `ctx.skillUsedThisTurn`，`play` 里 `ctx.markSkillUsed(player.id, "缔盟")` |

## 已知限制

1. **好施的界版绑定效果暂不支持**：界鲁肃好施在给牌后还有"成为/单体锦囊目标时对方可给你牌"的绑定效果，但锦囊指定目标没有对应钩子（只有 `slash_targeted`），部分实现反而误导，故整段略去。
2. **缔盟交换手牌不触发失去/获得钩子**：官方「交换」不视为"失去/获得"（不触发连营等），故直接数组互换、不走 `removeHandCardAt`。

## 规则依据

三国杀界限突破界鲁肃「好施」「缔盟」。除上述两点如实记录的限制外完整复刻。
