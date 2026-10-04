# 吕蒙（示例武将包）

吴国武将，善于据守与突袭。本包用于演示外部武将包的最小结构与两种技能形态。

## 文件

| 文件 | 作用 |
|---|---|
| `general.json` | 元数据 + 技能列表（`skills` 为原始技能名） |
| `克己.skill.json` | **声明式**技能：加载 / 校验 / 供 AI 阅读；规则数值走 `rules` 词汇表（本技能的效果不在词汇表内，留待阶段 6 拦截点） |
| `涉猎.skill.ts` | **代码**技能：出牌阶段主动技能，完整可执行 |

## 技能

- **克己**（声明式，触发）：若你未于出牌阶段使用或打出过杀，你可以跳过弃牌阶段。
- **涉猎**（代码，主动）：出牌阶段限一次：观看牌堆顶 3 张牌，选择 1 张获得，其余以任意顺序置于牌堆底。

## 使用

方式一：复制本目录到项目根的 `generals/` 下（`npm run dev` 默认加载该目录）：

```bash
cp -r examples/generals/吕蒙 generals/吕蒙
npm run dev
```

方式二：不复制，直接把示例目录当作武将包目录：

```bash
npm run dev -- --generals-dir=examples/generals
```

联机主机默认**不**加载外部包（外部包等同任意代码执行），需要显式开启：

```bash
npm run host -- --generals-pool=all
# 只信任声明式 JSON、拒绝 .ts/.mjs：追加 --generals-json-only
# 任一包加载失败即退出（CI/严格模式）：追加 --strict-generals
```

## 说明

- `涉猎.skill.ts` 只用 `import type`，类型在运行时被擦除，故该相对路径不影响加载。
- 代码技能只能用 `ctx` 暴露的引擎能力，禁止 `Math.random`（`--seed` 复现与联机一致性依赖 `ctx.randomIndex`）。
