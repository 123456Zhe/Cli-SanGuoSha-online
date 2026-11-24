# 参考武将 gallery

这里是**可抄的参考实现**：每个武将包都真正可加载、可对局、技能真的会触发（`generals:check --strict` 0 错 0 警、`--selfplay` 0 违规）。

**默认不加载**：`npm run dev` 默认扫项目根的 `generals/`；本目录只在显式指定时进池：

```bash
npm run dev -- --generals-dir=examples/generals        # 全部示例武将进抽将池
npm run host -- --players=3 --generals-pool=all        # 联机主机需显式开启外部包
npm run generals:check -- --dir=examples/generals --strict   # 写完自检
```

> ⚠️ **单一数据源**：本目录里的 7 个包是 `generals/` 同名包的**逐字节镜像**（`generals/` 才是数据源）。
> 改包只改 `generals/<武将>/`，然后跑 `npm run examples:sync` 同步过来；`npm run examples:check`
> （以及 `npm test`）会卡住任何漂移。所以两份拷贝不会再有"只改了一边"的失步。
> 也正因如此，包内文档不能写只在其中一边成立的路径或数量。

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
| 刘禅 | 享乐 | 代码 `triggered`（锁定技） | **`slash_targeted` 取消杀** + 交互式弃牌 | `payload.canceled`、`buildUsableSources`、`requestDiscardSelection`、`ctx.discardCards` |

触发点/拦截点覆盖情况（共 16 个 = 11 事件 + 5 拦截；单一真相是 `src/engine/types.ts` 的 `SKILL_TRIGGERS`）：

| 触发点 | 类别 | gallery 参考实现 | 其它 `generals/` 包里的例子 |
|---|---|---|---|
| `prepare_phase_start` | 事件 | ❌ 无样例 | 群杜预/三陈 |
| `turn_start` | 事件 | ❌ 无样例 | 界孙坚/英魂、魏杜预/倾势 |
| `before_draw` | 事件 | ✅ 神赵云/绝境 | 界鲁肃/好施、诸葛瑾/弘援 |
| `before_damage` | 事件 | ❌ 无样例 | 界马岱/潜袭 |
| `after_damage` | 事件 | ✅ 荀彧/节命 | 潘璋/夺刀、界曹冲/称象、界魏延/狂骨 |
| `judgment` | 拦截 | ✅ 张角/鬼道 | （内置「鬼才」） |
| `slash_targeted` | 拦截 | ✅ 刘禅/享乐 | 界刘繇/戡难、界周仓/忠勇、界文聘/镇卫、界诸葛瞻/父荫 |
| `hand_card_lost` | 事件 | ❌ 无样例 | 界王平/兵略 |
| `equip_lost` | 事件 | ✅ 凌统/旋风 | 群杜预/武库 |
| `card_used` | 事件 | ✅ 张角/雷击 | 界吴懿/奔袭、界赵云/涯角、界骆统/勤政、群杜预/武库、马良/应援、魏杜预/倾势 |
| `peach_save` | 拦截 | ❌ 无样例 | （内置「救援」用它做追加回复） |
| `dying` | 事件 | ❌ 无样例 | 卞夫人/挽危、卞夫人/约俭 |
| `card_discarded` | 事件 | ❌ 无样例（享乐只是**发出**该触发点：它经 `ctx.discardCards` 弃牌） | 曹植/落英（监听方） |
| `discard_phase_start` | 拦截 | ✅（声明式） 吕蒙/克己 | （代码钩子版在 `generals/` 里也没有样例） |
| `end_phase_start` | 事件 | ❌ 无样例 | 夏侯氏/樵拾、群杜预/三陈 |
| `provide_response` | 拦截 | ✅（声明式） 卧龙诸葛亮/看破 | 界张嶷/矢志（代码钩子版） |

gallery 本身刻意只覆盖**入门机制**；想要更全的触发点样例，直接看 `generals/` 里的同名/其它包（`generals:check --dir=generals` 同样 0 错 0 警）。
`hand_card_lost` / `peach_save` / `before_damage` 在 `generals/` 里也各有真实 skill，只是没搬进 gallery：
贴切的真实技能多半与内置重叠，或需要 gallery 之外的上下文（如 `peach_save` 目前只有内置「救援」用到）。

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
- 镜像自检：`npm run examples:check`（改了 gallery 里的包却没同步 `generals/`，或反之，都会失败）

## 写在样例里的引擎限制（写自己的武将前务必知道）

- **触发性技能无法交互式选目标**：`InteractionRequest` 没有"选一名玩家"，所以样例里的选人（张角/雷击、凌统/旋风、荀彧/节命）都是**自动挑选**（照内置「英魂」的写法）。需要玩家点人的效果请做成 `kind: "active"` + `getTargets`。
- **`judgment` 钩子只分发给"判定牌归属者"**：`drawJudgmentCard` 的 payload 只有 `actor = owner`，而包钩子只对事件相关玩家（`actor`/`target`/`source`）拥有该技能时执行。所以外部「鬼道」只能改判**归属者自己**的判定；内置「鬼才」不受限（它在 `game.ts` 里全局搜索玩家）。这是内置与外部的一处真实能力不对称（计划 §17 row 7）。
- **当牌转换一次只吃一张源牌**，且 `to` 只放行任意基本牌与普通锦囊共 18 类（`杀/火杀/雷杀/桃/酒/闪/无懈可击/过河拆桥/顺手牵羊/决斗/无中生有/南蛮入侵/万箭齐发/借刀杀人/火攻/铁索连环/桃园结义/五谷丰登`），延时锦囊与装备 loader 会明确拒绝。
- **自动挑选/随机必须走引擎 RNG**：`ctx.randomIndex(n)` / `ctx.rng()`，禁止 `Math.random`，否则 `--seed` 复现与联机一致性失效。
- **隐式约定**（漏做会静默坏掉）：`requestDiscardSelection` 返回的牌不会自动进弃牌堆，要自己走 `ctx.discardCards([card], actor, "弃置", logs)`（发 `card_discarded` 触发点，供落英等技能监听；**不要直接 `ctx.discardPile.push`**，"使用/打出"的牌入堆才算例外）；造成伤害后必须走 `resolveDeaths()` → `resolveWinner()` → `advanceIfCurrentPlayerDead(logs)`；失去手牌必须走 `removeHandCardAt`。
