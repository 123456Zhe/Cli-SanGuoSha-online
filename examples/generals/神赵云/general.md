# 神赵云（参考实现：运行时变量的代码技能 + 声明式当牌转换）

神势力，男，2 体力。技能：**绝境**、**龙魂**。标准版技能文本。

本包在 `examples/generals/` 里演示两种"声明式字段不够用"时该怎么办，**两个技能都真正生效**：

1. **`绝境.skill.ts`（代码技能）**：两个数值都是**运行时变量**（X = 已损失体力值），静态 `rules` 声明不了。
   走两条运行时通道：`before_draw` 钩子改写 `payload.drawCount`（额外摸牌）+ 模块级纯函数 `handLimit(player)`（手牌上限 +X）。
2. **`龙魂.skill.json`（声明式 `conversions`）**：一个技能 4 条花色→牌类映射，
   其中 2 条能在出牌阶段主动使用（方块→火杀、红桃→桃），2 条靠 `asResponse` 在响应时机打出（梅花→闪、黑桃→无懈可击）。

> 换版本（界/移动版/十周年）请直接改 JSON 与本文。

## 文件

| 文件 | 作用 |
|---|---|
| `general.json` | 元数据 + 技能列表 |
| `绝境.skill.ts` | **代码**技能：运行时变量的两条通道（`before_draw` 钩子 + `handLimit` 纯函数） |
| `龙魂.skill.json` | **声明式**技能：`conversions` 四条映射，主动使用 + 响应打出都覆盖 |

## 技能现状（已全部生效）

| 技能 | 落点与验证 |
|---|---|
| **绝境** | ✅ 摸牌阶段额外摸 X 张（X = 已损失体力值）：`before_draw` 钩子。✅ 手牌上限 +X：`handLimit(player)` 纯函数，被 `getHandLimit` 求和消费（引擎弃牌阶段与 UI 提示同源）。 |
| **龙魂** | ✅ 方块当火杀 / 红桃当桃：出牌阶段可玩动作（`GameAction.convertVia/convertTo`，`cardIndex = -10000 - 下标`）。✅ 梅花当闪 / 黑桃当无懈可击：`provide_response` 拦截点在"没有任何来源 → 判定无法响应"之前列出转换来源。 |

校验器报告：**0 错误 / 0 警告**。

```bash
npm run generals:check -- --dir=examples/generals
```

## 声明的关键片段

`龙魂.skill.json`——注意 `conversions` 是**数组**（一个技能可以有多条映射），
`asResponse` 缺省表示"只能在出牌阶段主动使用"：

```json
"conversions": [
  { "from": { "suit": ["heart"] },   "to": "桃",         "asResponse": ["peach"] },
  { "from": { "suit": ["diamond"] }, "to": "火杀" },
  { "from": { "suit": ["club"] },    "to": "闪",         "asResponse": ["dodge"] },
  { "from": { "suit": ["spade"] },   "to": "无懈可击",   "asResponse": ["negate"] }
]
```

`绝境.skill.ts`——声明式 `rules` 只能给**固定数值**，运行时变量必须写代码：

```ts
handLimit: (player) => Math.max(0, player.maxHp - player.hp),   // 手牌上限 + 已损失体力值
onTrigger: { before_draw: (ctx, payload, logs) => { payload.drawCount += lost; } },
```

## 标准版里**仍未支持**的部分

- **龙魂的"至多两张同花色"**：引擎的 `conversions` 一次只吃一张源牌，双牌模式（两张红桃当桃回复 2 点等）未实现。
- **绝境的"摸牌阶段额外摸 X 张"** 已实现，但 X 的上限/边界与官方细则（如体力上限变化）未做特殊处理。
- 需要"当延时锦囊"（如国色的方块当乐不思蜀）或"当装备"的转换仍不支持：`conversions.to` 只放行
  `杀 / 火杀 / 雷杀 / 桃 / 闪 / 无懈可击`，loader 会明确拒绝其他牌类（其他牌类需要目标/距离/判定区逻辑）。

## 使用

```bash
# 复制到项目根 generals/（npm run dev 默认加载该目录）
cp -r examples/generals/神赵云 generals/神赵云 && npm run dev

# 或者直接把示例目录当武将包目录（吕蒙 + 神赵云一起进池）
npm run dev -- --generals-dir=examples/generals

# 自检
npm run generals:check -- --dir=examples/generals
npm run generals:check -- --dir=examples/generals --selfplay=3
```

联机主机默认**不**加载外部包（外部包等同任意代码执行），需显式开启：

```bash
npm run host -- --players=3 --generals-pool=all
```

## 说明

- `绝境.skill.ts` 只用 `import type`，类型在运行时被擦除，故该相对路径不影响加载。
- 代码技能只能用 `ctx` 暴露的能力，禁止 `Math.random`（`--seed` 复现与联机一致性依赖 `ctx.randomIndex`）。
- `handLimit` 必须是**纯函数**（只读传入的 player）：UI 与引擎拿同一份快照要算出同一个上限。
- 外部包钩子在**内置钩子之后**执行，所以 `before_draw` 的加法与裸衣等技能可叠加。
