# 神赵云（参考实现：代码技能 + "写不出来"的标本）

神势力，男，2 体力。技能：**绝境**、**龙魂**。

本包在 `examples/generals/` 里有两个用途：

1. **正面样例**：`绝境.skill.ts` 是"声明式表达不了、必须写代码技能"的标准写法
   （数值是运行时变量 → 用 `before_draw` 钩子改写 `payload.drawCount`，与内置英姿/裸衣可叠加）；
2. **反面标本**：`龙魂.skill.json` 是**当前武将包格式写不出来**的技能，用来把引擎缺口钉在明面上
   （跑校验器会稳定报出两条警告，见下）。

> 技能文本按**标准版**整理。换版本（界/移动版/十周年）请直接改 JSON 与本文。

## 文件

| 文件 | 作用 |
|---|---|
| `general.json` | 元数据 + 技能列表 |
| `绝境.skill.ts` | **代码**技能：`before_draw` 钩子，摸牌阶段额外摸"已损失体力值"张 |
| `龙魂.skill.json` | **声明式**技能：`kind: "conversion"`，声明了但引擎不会执行（见下） |

## 技能现状

| 技能 | 引擎里到底能不能生效 |
|---|---|
| **绝境** | ✅ **生效**：摸牌阶段额外摸"已损失体力值"张。❌ 后半句「你的手牌上限 +X」**不生效**——引擎手牌上限硬编码为体力值（`game.ts` 的 `endPlayPhase`/`discardForCurrentPlayer`），`SkillRules` 里没有 `handLimitDelta` 这类字段（全仓 grep `手牌上限` 零命中）。 |
| **龙魂** | ❌ **完全不生效**：引擎不认识 `kind: "conversion"` 的可玩动作；"当闪/当无懈可击打出"还需要未实现的 `provideResponse` 拦截点。 |

校验器对这个包的报告是**长期稳定**的（0 错误 / 2 警告）：

```
⚠ 龙魂：kind = "conversion"（当牌转换）目前不会被引擎枚举为可玩动作，写了也不会生效（已知缺口，优先待补）
⚠ 龙魂：既没有 triggers 也没有 rules，这个技能不会有任何效果
```

**这两条警告是结论，不是笔误。** 补完引擎后应当：把龙魂改成真正可执行的形式（声明式 `conversion` 或代码技能），
并同步更新 `src/tools/generals-check.test.ts` 里钉住这两条警告的用例。

## 为什么不用代码技能硬凑龙魂

`SkillModuleCtx`（= `SkillUseContext & SkillHooksContext`）里有 `applyDamage`/`resolveDuel`，但**没有 `resolveSlash`**。
红桃当桃姑且能靠直接赋值 `hp` 糊出来，方块当火杀 / 梅花当闪 / 黑桃当无懈可击则完全做不到；
写个"只能回血、不能当杀、不能响应"的半成品只会把缺口藏起来。

## 要让它真正可用，缺的是引擎能力（4 项，与 `docs/generals-pack-plan.md` §17 一致）

| # | 缺口 | 影响 | 落点 |
|---|---|---|---|
| ① | 声明式 `conversions`（当牌转换）完全没实现 | 龙魂/武圣/龙胆/国色/倾国/急救 只能写代码技能，引擎也不会为它枚举可玩动作 | `skill-module.ts` + `game.ts getPlayableActions` |
| ② | `provideResponse` 拦截点未实现 | 一切"当闪/当无懈可击**打出**"的转换在包层都不可能 | `skill-hooks.ts` + 交互管线 |
| ③ | `SkillUseContext` 没有 `resolveSlash` | 包代码技能无法真正"使用一张杀"（闪/铁骑/藤甲等结算必须走引擎） | `skills.ts` |
| ④ | 手牌上限不可改 | 绝境的「手牌上限 +X」表达不了 | `SkillRules` 增 `handLimitDelta` + 弃牌两处读它 |

## 使用

方式一：复制本目录到项目根的 `generals/` 下（`npm run dev` 默认加载该目录）：

```bash
cp -r examples/generals/神赵云 generals/神赵云
npm run dev
```

方式二：不复制，直接把示例目录当武将包目录（吕蒙 + 神赵云一起进池）：

```bash
npm run dev -- --generals-dir=examples/generals
```

自检（会打出上面那两条已知警告）：

```bash
npm run generals:check -- --dir=examples/generals
npm run generals:check -- --dir=examples/generals --selfplay=3
```

联机主机默认**不**加载外部包（外部包等同任意代码执行），需显式开启：

```bash
npm run host -- --players=3 --generals-pool=all
# 只信任声明式 JSON、拒绝 .ts/.mjs：追加 --generals-json-only
# 任一包加载失败即退出（CI/严格模式）：追加 --strict-generals
```

## 说明

- `绝境.skill.ts` 只用 `import type`，类型在运行时被擦除，故该相对路径不影响加载。
- 代码技能只能用 `ctx` 暴露的能力，禁止 `Math.random`（`--seed` 复现与联机一致性依赖 `ctx.randomIndex`）。
- `before_draw` 的 payload 含 `drawCount`，可写；外部包钩子在**内置钩子之后**执行，所以加法与裸衣等可叠加。
