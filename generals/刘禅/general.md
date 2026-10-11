# 刘禅（参考实现：`slash_targeted` 拦截点 + 交互式弃牌 + 取消杀）

蜀势力，男，3 体力。技能：**享乐**（锁定技）。本包的技能是**代码技能**（`享乐.skill.ts`）。

## 文件

| 文件 | 作用 |
|---|---|
| `general.json` | 元数据 + 技能列表（`skills: ["享乐"]`） |
| `享乐.skill.ts` | **代码**技能：`slash_targeted` 拦截点（置 `payload.canceled` 取消杀） |
| `general.md` | 本文 |

## 技能：享乐（`kind: "triggered"`，锁定技）

> 锁定技，当你成为【杀】的目标后，使用者需弃置一张**基本牌**，否则此【杀】对你无效。

### 为什么必须是代码技能

`rules` 词汇表只能表达数值/豁免（距离、摸牌数、伤害、手牌上限…），表达不了
"令使用者做一次**弃牌选择**，失败则**取消本次杀**"这种带交互与分支的效果；
声明式 `.skill.json` 也没有 `onTrigger`。所以本技能落到拦截点 + `ctx` 交互能力上。

### 用到的 API 与拦截语义

| 能力 / 字段 | 用法 |
|---|---|
| `onTrigger.slash_targeted` | 拦截点，发出位置：杀已确定目标、目标尚未响应时（`src/engine/resolve.ts` 的 `resolveSlash`） |
| `payload.source` | 【杀】的使用者；`null` 表示无来源 |
| `payload.target` | 成为【杀】目标的玩家（本技能检查他是否持有 `刘禅/享乐`） |
| `payload.card` | 本次【杀】的源牌（本技能不用，但拦截点会带上） |
| `payload.canceled = true` | **取消本次杀**：引擎 `resolveSlash` 在 emit 之后读同一个 payload 对象，置真即打印「令本次杀无效」并直接返回，后续闪响应/伤害/防具结算全部跳过 |
| `ctx.hasSkill(me, "刘禅/享乐")` | 归属判断，外部技能 id 已命名空间化为 `刘禅/享乐` |
| `ctx.buildUsableSources(user)` | 取使用者的可选来源（手牌 + 木牛流马内存牌，与引擎弃牌/响应交互同一套编号） |
| `ctx.requestDiscardSelection(user, 1, reason, sources)` | 要求使用者弃 1 张（候选已过滤成基本牌）；返回**实际弃置的牌** |
| `ctx.discardPile.push(card)` | **隐式约定**：`requestDiscardSelection` 只把牌移出原区域，**不会自动进弃牌堆**，必须自己 push |

### 触发条件与分支（实现口径）

1. `payload.target`（技能持有者）与 `payload.source`（使用者）都必须存在；
2. **自己对自己不生效**：`me.id === user.id` 时直接返回（不询问、不取消）；
3. 使用者没有**基本牌**可弃（`杀/火杀/雷杀/闪/桃/酒`，且必须是手牌或木牛流马内有实体牌的来源）→ 直接 `payload.canceled = true`，日志「没有可弃置的基本牌，本次杀无效」；
4. 有可弃基本牌 → `ctx.requestDiscardSelection` 询问使用者：
   - 弃了牌 → 自己 push 进弃牌堆，本次杀**继续正常结算**（刘禅仍需出【闪】/结算伤害）；
   - 返回空数组（未弃成，例如响应方放弃）→ `payload.canceled = true`，本次杀无效。

### 锁定技的写法

- `kind: "triggered"` + `triggers: ["slash_targeted"]`；
- **不声明 `optional`**，钩子里也**不调用** `ctx.shouldActivateOptionalEffect` —— 锁定技没有"是否发动"的询问，条件满足即生效。
- 钩子内**不再发起杀**（否则会再次触发 `slash_targeted`，引擎不设递归保护）。

### 限制与注意事项

- **【杀】的使用次数已经消费**：`playAction` 在结算前就置了 `slashUsedThisTurn`，所以即使享乐令此杀无效，使用者本回合的杀次数照样算用掉。
- **弃牌发生在响应之前**：使用者先弃基本牌（拦住享乐），刘禅再照常响应【闪】；弃了牌 ≠ 刘禅一定不掉血。
- **只能筛手牌/木牛内牌**：`buildUsableSources` 不含装备区，所以"装备区的牌当基本牌弃"不成立（装备区的牌本来也不是基本牌）。
- **候选由使用者选择**：真实对局里是人类/AI 决策（AI 走 `choose-discard` 交互）；无 `DecisionHandler` 的座位由引擎 `autoDecision` 兜底弃第一张。
- **无 `Math.random`**：本技能不含随机数；若将来加随机，必须用 `ctx.randomIndex(n)` / `ctx.rng()`。
- **类型导入**：文件顶部 `import type … from "../../../types/generals-pack.js"` 指向仓库根的 `types/generals-pack.d.ts`
  （本文件位于 `examples/generals/刘禅/`，`../../../` 即仓库根）。`import type` 运行时被完全擦除、`generals:check` 也不做类型检查，
  所以它只影响编辑器补全与 `tsc`。

## 自检

```bash
npm run generals:check -- --dir=examples/generals --strict
npm run generals:check -- --dir=examples/generals --selfplay=3
```
