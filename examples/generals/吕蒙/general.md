# 吕蒙（示例武将包）

吴国武将，善于据守与突袭。本包用于演示外部武将包的最小结构与两种技能形态。

## 文件

| 文件 | 作用 |
|---|---|
| `general.json` | 元数据 + 技能列表（`skills` 为原始技能名） |
| `克己.skill.json` | **声明式**技能：效果走 `rules` 词汇表（`skipDiscardPhaseIfNoSlash`），由引擎在弃牌阶段入口消费 |
| `涉猎.skill.ts` | **代码**技能：出牌阶段主动技能，完整可执行 |

## 技能

- **克己**（声明式，触发）：若你未于出牌阶段使用或打出过杀，你可以跳过弃牌阶段。
  声明式字段只有 `rules: { "skipDiscardPhaseIfNoSlash": true }`，不需要写任何代码；
  引擎在弃牌阶段入口询问玩家是否发动（`optional: true`），发动即整段跳过弃牌。
- **涉猎**（代码，主动）：出牌阶段限一次：观看牌堆顶的 5 张牌（不足则全看），将其中任意数量的黑桃/梅花牌交给一名其他角色，其余以任意顺序置于牌堆顶。

## 使用

把本目录放进任意武将包根目录即可（`name` 必须与文件夹名一致，技能 id 的命名空间前缀取文件夹名）。
本包在仓库里有两份**逐字节相同**的拷贝：默认目录 `generals/吕蒙/` 与参考 gallery `examples/generals/吕蒙/`
（后者由 `npm run examples:sync` 从前者镜像，改包只改 `generals/`）：

```bash
# 默认目录就有本包（npm run dev 默认加载 generals/）
npm run dev
# 或者把 gallery 副本当作武将包目录（只含参考武将）
npm run dev -- --generals-dir=examples/generals
# 复制到你自己的武将包目录
cp -r generals/吕蒙 <你的武将包目录>/吕蒙
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
