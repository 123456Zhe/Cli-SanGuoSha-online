# 参考武将 gallery

这里是**可抄的参考实现**：每个武将包都真正可加载、可对局、技能真的会触发（`generals:check --strict` 0 错 0 警、`--selfplay` 0 违规）。

**默认不加载**：`npm run dev` 默认扫项目根的 `generals/`；本目录只在显式指定时进池：

```bash
npm run dev -- --generals-dir=examples/generals        # 全部示例武将进抽将池
npm run host -- --players=3 --generals-pool=all        # 联机主机需显式开启外部包
npm run generals:check -- --dir=examples/generals --strict   # 写完自检
```

> ⚠️ **外部包不能与内置武将同名**：loader 的重名检查会以"武将名重复"**整包拒绝**（内置 25 名见 `src/engine/generals.ts`）。
> 写自己的武将时先确认名字没被内置占用。

## 机制覆盖矩阵

| 武将 | 技能 | 形态 | 覆盖的机制 / 触发点 | 主要 API / 字段 |
|---|---|---|---|---|
| 吕蒙 | 克己 | 声明式 `.skill.json` | 声明式规则在**弃牌阶段入口**生效 | `rules.skipDiscardPhaseIfNoSlash` |
| 吕蒙 | 涉猎 | 代码 `active` | 出牌阶段主动技、看牌堆顶、分牌给其他角色、任意顺序置顶 | `canUse`/`getTargets`/`play`、`drawTopCards`、`placeCardsOnTop`、`placeCardsOnBottom`、`decide`、`markSkillUsed` |
| 神赵云 | 绝境 | 代码 `triggered` | **运行时变量**：改写摸牌数 + 手牌上限 | `before_draw` 的 `payload.drawCount`、`handLimit(player)` 纯函数 |
| 神赵云 | 龙魂 | 声明式 `.skill.json` | 声明式当牌转换（4 条花色映射），出牌阶段 + 响应时机 | `conversions[].from/to/asResponse` |
| 张角 | 鬼道 | 代码 `triggered` | **`judgment` 改判**（消费黑色手牌） | `payload.judgmentCard`、`removeHandCardAt`、`decide`(`choose-discard`) |
| 张角 | 雷击 | 代码 `triggered` | **`card_used`** → 判定 → 雷电伤害（完整死亡/胜负链） | `drawJudgmentCard`、`applyDamage`、`resolveDeaths`、`resolveWinner`、`advanceIfCurrentPlayerDead` |
| 凌统 | 旋风 | 代码 `triggered` | **`equip_lost`** + 弃置其他角色的牌 | `hasRemovableCard`、`removeRandomCardFromPlayer`、`shouldActivateOptionalEffect` |
| 荀彧 | 节命 | 代码 `triggered` | **`after_damage`** + 补牌 | `drawCards`、`discardFromPlayerHand`、`shouldActivateOptionalEffect` |
| 卧龙诸葛亮 | 看破 | 声明式 `.skill.json` | 黑色手牌当【无懈可击】**打出**（`provide_response` 路径） | `conversions` + `asResponse: ["negate"]` |
| 刘禅 | 享乐 | 代码 `triggered`（锁定技） | **`slash_targeted` 取消杀** + 交互式弃牌 | `payload.canceled`、`buildUsableSources`、`requestDiscardSelection`、`ctx.discardPile.push` |

触发点/拦截点覆盖情况（共 12 个）：

| 触发点 | 状态 | 参考实现 |
|---|---|---|
| `before_draw` | ✅ | 神赵云/绝境 |
| `after_damage` | ✅ | 荀彧/节命 |
| `judgment` | ✅ | 张角/鬼道 |
| `slash_targeted` | ✅ | 刘禅/享乐 |
| `equip_lost` | ✅ | 凌统/旋风 |
| `card_used` | ✅ | 张角/雷击 |
| `discard_phase_start` | ✅（声明式） | 吕蒙/克己（代码钩子版暂无样例） |
| `provide_response` | ✅（声明式） | 卧龙诸葛亮/看破（代码钩子版暂无样例） |
| `turn_start` | ⬜️ | 内置「观星」「英魂」是例子，但它们是内置实现 |
| `hand_card_lost` | ❌ 无样例 | 贴切的真实技能（连营类）与内置重叠；需要"牌进弃牌堆"事件的技能也放不进这个触发点 |
| `peach_save` | ❌ 无样例 | 真实技能里只有内置「救援」用它做追加回复 |
| `before_damage` | ❌ 无样例 | payload 没有可改写的"伤害数值/取消"字段，真实技能（天香/铁骑）需要引擎新能力 |

## 每个包的结构

```
<武将名>/
  general.json          # apiVersion/name（= 文件夹名）/kingdom/gender/maxHp/skills
  <技能名>.skill.json   # 声明式技能（或）
  <技能名>.skill.ts     # 代码技能（.mjs 跨环境；用 import type + satisfies SkillModule）
  general.md            # 机制、用到的 API、限制与触发证据
```

作者资源（都不需要读 `src/`）：

- 契约与能力清单：`docs/generals-pack-api.md`
- 结构约束：`schema/general.schema.json`、`schema/skill.schema.json`
- 类型签名：`types/generals-pack.d.ts`（代码技能顶部 `import type { SkillModule, SkillModuleCtx } from "../../../types/generals-pack.js";`）
- 自检：`npm run generals:check -- --dir=<dir> [--strict] [--selfplay=N] [--json]`

## 写在样例里的引擎限制（写自己的武将前务必知道）

- **触发性技能无法交互式选目标**：`InteractionRequest` 没有"选一名玩家"，所以样例里的选人（张角/雷击、凌统/旋风、荀彧/节命）都是**自动挑选**（照内置「英魂」的写法）。需要玩家点人的效果请做成 `kind: "active"` + `getTargets`。
- **`judgment` 钩子只分发给"判定牌归属者"**：`drawJudgmentCard` 的 payload 只有 `actor = owner`，而包钩子只对事件相关玩家（`actor`/`target`/`source`）拥有该技能时执行。所以外部「鬼道」只能改判**归属者自己**的判定；内置「鬼才」不受限（它在 `game.ts` 里全局搜索玩家）。这是内置与外部的一处真实能力不对称（计划 §17 row 7）。
- **当牌转换一次只吃一张源牌**，且 `to` 只放行 `杀/火杀/雷杀/桃/闪/无懈可击`（延时锦囊/装备不支持）。
- **自动挑选/随机必须走引擎 RNG**：`ctx.randomIndex(n)` / `ctx.rng()`，禁止 `Math.random`，否则 `--seed` 复现与联机一致性失效。
- **隐式约定**（漏做会静默坏掉）：`requestDiscardSelection` 返回的牌不会自动进弃牌堆，要自己 `ctx.discardPile.push`；造成伤害后必须走 `resolveDeaths()` → `resolveWinner()` → `advanceIfCurrentPlayerDead(logs)`；失去手牌必须走 `removeHandCardAt`。
