# 界关银屏（蜀，女，3 体力）

| 文件 | 作用 |
|---|---|
| `general.json` | 元数据 + 技能列表（`skills: ["雪恨"]`） |
| `雪恨.skill.ts` | **代码**技能：主动技，出牌阶段限一次，弃红牌横置至多 X 人并对其中一人造成 1 点火伤 |
| `general.md` | 本文件 |

## 技能

- **雪恨**（代码，主动）：出牌阶段限一次，你可以弃置一张红色牌，然后选择至多 X 名角色，横置这些角色并对其中一名角色造成 1 点火焰伤害（X 为你已损失的体力值且至少为 1）。

## 用到的 API 与触发点

| 项 | 用法 |
|---|---|
| 技能类型 | `kind: "active"` + `canUse` / `getTargets` / `play` |
| 限一次 | `canUse` 查 `skillUsedThisTurn`（plain "雪恨"，与飞军同一约定），`play` 里 `markSkillUsed` |
| 代价 | 红色手牌：`buildUsableSources` 过滤 origin=hand 且 color=red，`requestDiscardSelection` 选 1 张，调用方手动 `discardPile.push` |
| X | `max(1, maxHp - hp)`，满血时 X=1（FAQ 确认满血可发动） |
| 横置 | `chained` 字段直接赋值 |
| 火焰伤害 | `ctx.applyDamage(..., "fire")`，随后 `resolveDeaths` → `resolveWinner` → `advanceIfCurrentPlayerDead` |

## 已知限制

- 引擎主动技能只支持单目标选择（`getTargets` + `play(targetId)`），无法让玩家依次选至多 X 名角色：本包由玩家选伤害目标，其余至多 X-1 名横置角色自动挑选（未横置、存活、非自己，id 升序）。
- 不选自己：官方文本允许选自己，但自横置+自烧伤几乎无收益且有 AI 自伤风险，故 getTargets 与自动挑选均排除自己。
- 已横置的伤害目标按 FAQ 视为少指定一名（横置无效果），但火焰伤害照常结算（并按引擎规则向连环角色传导）。

## 规则依据

- 三国杀 Wiki | Fandom 关银屏页（桌游志 91 期）：雪恨"出牌阶段限一次，你可以弃置一张红色牌，然后选择至多 X 名角色，横置这些角色并对其中一名角色造成 1 点火焰伤害（X 为你已损失的体力值且至少为 1）"；FAQ 确认满血可发动、已横置者再指定相当于少指定一名。
