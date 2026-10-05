# 荀彧（参考武将包：`after_damage` 事件钩子）

魏势力，男，3 体力。技能：**节命**。

| 文件 | 作用 |
|---|---|
| `general.json` | 元数据 + 技能列表（`skills: ["节命"]`） |
| `节命.skill.ts` | **代码**技能：`after_damage` 事件钩子的完整可执行实现 |
| `general.md` | 本文件 |

## 技能

- **节命**（代码，触发）：当你受到 1 点伤害后，你可以令一名角色将手牌补至其体力上限
  （最多摸至 5 张，超出则弃至上限）。

## 用到的 API 与触发点

| 项 | 用法 |
|---|---|
| 触发点 | `after_damage`（事件类，由伤害结算路径在伤害生效后发出） |
| payload | `payload.target` = **受伤者**（不是伤害来源）；`payload.source` = 伤害来源；`payload.damage` = 伤害点数 |
| 归属判定 | `ctx.hasSkill(target, "荀彧/节命")`——只有**受伤者本人**是持有者才发动 |
| 可选询问 | `ctx.shouldActivateOptionalEffect(target, "荀彧/节命")`（技能声明 `optional: true`） |
| 补牌 | `ctx.drawCards(playerId, count)`（返回实际摸到的张数） |

代码写法照抄内置 `after_damage` 钩子（`src/engine/skill-hooks.ts` 的反馈「FanKui」/奸雄「JianXiong」/
遗计「YiJi」），只把动作换成"补手牌"。

## 数值口径

```
上限 ceiling  = max(0, min(5, 目标的体力上限))
补牌数 drawn  = max(0, ceiling - 目标当前手牌数)
```

- **封顶 5**："最多摸至 5 张"。
- 手牌**多于**上限：走 `ctx.discardFromPlayerHand(beneficiary, 超出张数, logs)` 弃至上限
  （对应技能原文的"超出则弃至上限"）。正常对局里几乎走不到这条分支：手牌超过体力上限的角色
  在弃牌阶段已被迫弃到（当前体力值 ≤）体力上限。
- 手牌**正好**在上限：不必补牌也不弃牌，只记一条日志。

## 已知简化：手牌上限按引擎口径 = 体力上限

本技能把"手牌上限"按**引擎口径**取 `target.maxHp`（体力上限），**不**调用
`src/engine/skill-rules.ts` 的 `getHandLimit(player)`（默认上限 = **当前体力值** + 各技能修正）。
因此：

- 目标已受伤时，节命仍按**体力上限**补满，不做"已受伤角色上限更低"的修正；
- 若目标拥有改变手牌上限的技能（如神赵云「绝境」的 `handLimit(player)`），本技能也不叠加那部分修正。

这是刻意的简化（节命原规则就是"补至体力上限"），写在 `节命.skill.ts` 注释里，改版本时请注意。

## 已知限制：目标角色由引擎自动挑选（非玩家选择）

**触发性技能没有交互式"选角色"的请求类型。** `InteractionRequest` 只有
`respond` / `collateral` / `choose-discard` / `choose-suit` / `optional-effect` 五种，
`choose-discard` 只能在**给定 `sources` 列表**里选牌，无法用来"选人"。
所以"令一名角色"这个目标选择无法交给玩家/AI 交互完成。

本实现按内置「英魂」（`src/engine/skill-hooks.ts`，同样是"自动挑一名其他角色"）的先例，
把目标选择**自动化的确定性规则**：

1. 全部**存活**角色（**含自己**——节命可以给自己补牌）；
2. **手牌最少者优先**（补牌收益最大）；
3. 手牌数相同则按 `id` 升序（稳定排序，`--seed` 可复现）；
4. 取第 1 名。

排序是纯比较、不含随机，且不使用 `Math.random`。

> 如果将来引擎为触发性技能补上"选一名角色"的请求类型（如 `choose-target`），
> 这里的自动挑选应替换为一次真实交互。

## 不会递归

本技能只摸牌，不造成伤害、不再触发 `after_damage`（引擎不设递归保护，
"`after_damage` 钩子里再造成伤害"才会无限递归，本技能不做这件事）。

## 自检与"真的会触发"的证据

```bash
npm run generals:check -- --dir=examples/generals --strict      # 0 个错误 / 0 个警告
npm run generals:check -- --dir=examples/generals --selfplay=3  # 违规 0 条
```

在 `forceGeneral=荀彧`（4 人局、`--selfplay=3`）的无头自对弈里包装 `after_damage` 钩子统计，
3 局共调用 **42 次**，每次都在日志里留下"…的节命生效，令…"的结算行——即该技能在真实对局
（受到杀/决斗/南蛮/万箭/火攻/闪电等各类伤害）确实会触发。确定性场景复现的日志：

```
甲 受到 1 点伤害，当前体力 3
甲 的节命生效，令 乙 将手牌补至 4（摸 3 张）        ← 目标手牌 1 → 4（= 目标体力上限）
```

其余已验证分支（同一确定性测试脚本）：

| 场景 | 日志 | 结果 |
|---|---|---|
| 目标 `maxHp=8`、手牌 0 | `令 乙 将手牌补至 5（摸 5 张）` | 手牌 5（封顶 5 ✅） |
| 荀彧自己手牌最少 | `令 甲 将手牌补至 4（摸 4 张）` | 手牌 4（含自己 ✅） |
| 目标手牌 6 > 上限 4 | `甲 弃置了 2 张手牌` / `令 甲 将手牌弃至 4（弃 2 张）` | 手牌 4（超出则弃至上限 ✅） |
| 受伤者不是持有者 | 仅 `甲 受到 1 点伤害`，无节命日志 | 未发动（归属判定 ✅） |

## 使用

把本目录移到武将包根目录即可（`name` 必须与文件夹名一致，技能 id 的命名空间前缀取文件夹名）：

```bash
# 直接以 gallery 目录为武将包目录（本包在其中，会与其它示例一起进池）
npm run dev -- --generals-dir=examples/generals
# 或复制到默认目录
cp -r examples/generals/荀彧 generals/荀彧 && npm run dev
```

联机主机默认**不**加载外部包（外部包等同任意代码执行），需显式开启 `--generals-pool=all`。

## 说明

- `节命.skill.ts` 只用 `import type`，类型在运行时被完全擦除，故该相对路径不影响加载；
  移到最终位置 `examples/generals/荀彧/` 后 `../../../types/generals-pack.js` 正好指向仓库根。
- 代码技能只能用 `ctx` 暴露的能力；只读遍历 `ctx.players` / `player.hand` 是允许的，
  禁止直接改引擎数组。
