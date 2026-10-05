# 凌统（参考武将包：`equip_lost` 事件钩子）

吴势力，男，4 体力。技能：**旋风**。

| 文件 | 作用 |
|---|---|
| `general.json` | 元数据 + 技能列表（`skills: ["旋风"]`） |
| `旋风.skill.ts` | **代码**技能：`equip_lost` 事件钩子的完整可执行实现 |
| `general.md` | 本文件 |

## 技能

- **旋风**（代码，触发）：每当你失去装备区里的一张牌时，你可以依次弃置一至两名其他角色的各一张牌。

## 用到的 API 与触发点

| 项 | 用法 |
|---|---|
| 触发点 | `equip_lost`（事件类拦截点，由 `src/engine/resolve.ts` 的 `onLoseEquip` 发出） |
| payload | `payload.actor` = 失去装备的玩家；`payload.equip` = 失去的装备**牌类**（装备区没有 `Card` 实体，只有牌类） |
| 归属判定 | `ctx.hasSkill(actor, "凌统/旋风")`——外部技能 id 已按文件夹命名空间化 |
| 可选询问 | `ctx.shouldActivateOptionalEffect(actor, "凌统/旋风")`（技能声明 `optional: true`） |
| 弃牌 | `removeRandomCardFromPlayer(player, "弃置", undefined)`（文档中列出的 `ctx.hasRemovableCard(player)` **在此仓库的运行时 ctx 上并不存在**，故文件内自带同名本地谓词 `hasRemovableCard()`，语义与引擎一致）；返回**日志字符串数组**，用 `logs.push(...)` 并入 |

> ⚠️ 已实测的契约缺口：`docs/generals-pack-api.md` 与 `types/generals-pack.d.ts` 都把
> `hasRemovableCard(player)` 列为 ctx 能力，但运行时 ctx（= 存活的 `SanGuoGame` 实例）上它是
> `undefined`，直接调用会抛 `ctx.hasRemovableCard is not a function`，并被包钩子的 try/catch
> 记成一条"触发器执行失败"日志（技能静默失效）。作者应自行按 `Player` 字段判定，或改用
> `ctx.removeRandomCardFromPlayer`（无牌可弃时返回空数组，天然安全）。

`equip_lost` 在装备被弃置 / 被获得 / 被替换时都会发出，因此**过河拆桥、顺手牵羊、寒冰剑、
自己打出新装备顶掉旧装备、以及被旋风弃掉装备**都会让旋风有发动机会。

## 已知限制：目标角色由引擎自动挑选（非玩家选择）

**触发性技能没有交互式"选角色"的请求类型。** `InteractionRequest` 只有
`respond` / `collateral` / `choose-discard` / `choose-suit` / `optional-effect` 五种，
其中 `choose-discard` 只能在**给定 `sources` 列表**里选牌，无法用来"选人"。
所以"一至两名其他角色"这个目标选择在本引擎里**无法交给玩家/AI 交互完成**。

本实现按内置「英魂」（`src/engine/skill-hooks.ts` 的 `SkillName.YingHun` 钩子，同样是
"自动挑一名其他角色"）的先例，把目标选择**自动化的确定性规则**：

1. 其他**存活**角色；
2. **有牌可弃**（`ctx.hasRemovableCard`）；
3. **手牌多者优先**（弃牌收益最大），手牌数相同则按 `id` 升序；
4. 取前 **1～2 名**（排序后 `slice(0, 2)`；不足两名时只弃一名，无人可弃时只记日志）。

排序是纯比较、不含随机，且整条链路只用 `ctx.randomIndex`（不用 `Math.random`），
所以同一 `--seed` 的结果可复现，联机主机与客户端口径一致。

> 如果将来引擎为触发性技能补上"选一名角色"的请求类型（如 `choose-target`），
> 这里的自动挑选应替换为一次真实交互。

## 为什么不会递归

技能本身**不碰装备区**（只弃置其他角色的牌）。虽然被旋风弃掉的装备会让那个角色也发出
`equip_lost`（那是引擎的正确行为，也让该角色的旋风/枭姬有机会发动），但旋风每次发动都从
目标手里**实打实地拿走一张牌**，可弃牌数严格递减，不存在无限递归。

## 自检与"真的会触发"的证据

```bash
npm run generals:check -- --dir=examples/generals --strict      # 0 个错误 / 0 个警告
npm run generals:check -- --dir=examples/generals --selfplay=3  # 违规 0 条
```

在 `forceGeneral=凌统`（4 人局、`--selfplay=3`）的无头自对弈里包装 `equip_lost` 钩子统计，
3 局共调用 **32 次**，每次都在日志里留下"失去装备…发动旋风弃置…"的结算行——
即该技能在真实对局（含 AI 自动换装、过河拆桥、顺手牵羊、寒冰剑弃装备等路径）确实会触发。
确定性场景复现（`resolveEquip` 换装）的日志：

```
甲 的旧武器 青釭剑 被替换并弃置
甲 失去装备青釭剑，发动旋风弃置 乙 的牌
乙 的 1 张手牌被弃置
甲 的旋风结算完毕
甲 装备了诸葛连弩
```

## 使用

把本目录移到武将包根目录即可（`name` 必须与文件夹名一致，技能 id 的命名空间前缀取文件夹名）：

```bash
# 直接以 gallery 目录为武将包目录（本包在其中，会与其它示例一起进池）
npm run dev -- --generals-dir=examples/generals
# 或复制到默认目录
cp -r examples/generals/凌统 generals/凌统 && npm run dev
```

联机主机默认**不**加载外部包（外部包等同任意代码执行），需显式开启 `--generals-pool=all`。

## 说明

- `旋风.skill.ts` 只用 `import type`，类型在运行时被完全擦除，故该相对路径不影响加载；
  移到最终位置 `examples/generals/凌统/` 后 `../../../types/generals-pack.js` 正好指向仓库根。
- 代码技能只能用 `ctx` 暴露的能力；只读遍历 `ctx.players` / `player.hand` 是允许的，
  禁止直接改引擎数组。
