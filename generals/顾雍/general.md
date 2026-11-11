# 顾雍（吴，男，3 体力）

| 文件 | 作用 |
|---|---|
| `general.json` | 元数据 + 技能列表（`skills: ["慎行"]`） |
| `慎行.skill.ts` | **代码**技能：主动技，出牌阶段弃两张手牌摸一张牌，可重复发动 |
| `general.md` | 本文件 |

## 技能

- **慎行**（代码，主动）：出牌阶段，你可以弃置两张牌，然后摸一张牌。

## 用到的 API 与触发点

| 项 | 用法 |
|---|---|
| 技能类型 | `kind: "active"` + `canUse` / `play`（无目标，不设 `requiresTarget` / `getTargets`） |
| 代价 | `buildUsableSources(player)` 过滤 origin=hand 后 `requestDiscardSelection(player, 2, reason, sources)`，返回的牌手动进弃牌堆 |
| 收益 | `drawCards(player.id, 1)` |

## 已知限制

- 无次数限制（文本无“限一次”），出牌阶段可重复发动，每次净 -1 手牌。
- 弃置仅限手牌（origin=hand），木牛内牌与装备牌不计入代价。

## 规则依据

- 三国杀 Wiki | Fandom 顾雍页：慎行（身份局与 2V2 文本相同）"出牌阶段，你可以弃置两张牌，然后摸一张牌"；体力上限 3。
