# 卧龙诸葛亮（参考实现：纯声明式当牌转换 `conversions`）

蜀势力，男，3 体力。技能：**看破**。本包**只有这一个技能**，且**不含任何代码**（纯 `.skill.json` 声明式）。

## 文件

| 文件 | 作用 |
|---|---|
| `general.json` | 元数据 + 技能列表（`skills: ["看破"]`） |
| `看破.skill.json` | **声明式**技能：一条 `conversions` 映射（黑色手牌 → 无懈可击） |
| `general.md` | 本文 |

## 技能：看破（`kind: "conversion"`）

> 你可以将一张**黑色**手牌当【无懈可击】**使用或打出**。

声明本体（`看破.skill.json`）：

```json
{
  "id": "看破",
  "displayName": "看破",
  "kind": "conversion",
  "optional": true,
  "description": "你可以将一张黑色手牌当无懈可击使用或打出。",
  "conversions": [
    { "from": { "color": ["black"] }, "to": "无懈可击", "asResponse": ["negate"] }
  ]
}
```

### 用到的声明式字段

| 字段 | 取值 | 语义 |
|---|---|---|
| `from` | `{ "color": ["black"] }` | 源牌筛选：只吃**黑色**牌（`suit`/`color`/`type` 之间是 AND，至少要给一个；红桃/方块不命中） |
| `to` | `"无懈可击"` | 当成什么牌。白名单是 `杀/火杀/雷杀/桃/闪/无懈可击`，其它牌类 loader 直接报错 |
| `asResponse` | `["negate"]` | 可作为哪个响应时机**打出**。`to` 与时机必须对得上：**无懈可击 ↔ `negate`**（闪↔`dodge`、桃↔`peach`、杀↔`slash`） |
| `kind` | `"conversion"` | 走引擎自动的当牌转换通道，作者不写代码 |
| `optional` | `true` | 元数据：技能文本是"你可以…"，是否转换由持有者决定（转换本身不会弹出"是否发动"询问） |

`id` / `displayName` 是可选项；引擎的技能 id 固定为命名空间形式 **`卧龙诸葛亮/看破`**（`${文件夹名}/${技能名}`），`id` 写错只会让校验器给警告。

### 生效路径（引擎自动，作者零代码）

1. **响应时机（本技能唯一的实际生效路径）**：需要打出【无懈可击】时，引擎在
   `buildResponseSources(kind="negate")` → `buildNegateSources` → `appendConversionSources` 里，
   把持有者手上每张满足 `from`（黑色）且牌类不是【无懈可击】的牌，标记为
   `{ viaSkill: "卧龙诸葛亮/看破", asType: "无懈可击" }` 的来源并入候选列表；
   `provide_response` 拦截点还会在"没有任何来源 → 判定无法响应"**之前**再给一次补充机会。
   玩家选中该来源后，`consumeResponseCard` 会**以技能的真实声明复算一次 `from`**（防伪造 `sourceId`），
   然后打出并置入弃牌堆，日志形如 `X 发动看破当无懈可击（杀）`。
2. **出牌阶段不枚举**：`getPlayableActions` 只为 `to ∈ {杀, 火杀, 雷杀, 桃}` 的转换生成可玩动作。
   `to = 无懈可击`（以及闪）是纯响应牌，**不会被列进出牌阶段的动作列表**——
   这条转换只有在 `asResponse: ["negate"]` 命中的响应时机才会生效。
   因此 `asResponse` 不是可选装饰：若漏写，校验器会警告"这条转换永远不会生效"。

### 限制与注意事项

- **一次一张牌**：一条转换只把**一张**源牌当【无懈可击】；没有"两张黑色牌当一张无懈"之类的多牌模式。
- **只能变响应牌**：`to` 仅放行 `杀/火杀/雷杀/桃/闪/无懈可击`。当延时锦囊（如"黑色当乐不思蜀"）或当装备需要目标/距离/判定区逻辑，**引擎不支持**，loader 会明确报错。
- **任何黑色手牌都行**：包括黑色的锦囊、装备牌（在手里就是手牌）。`from` 只筛 `color`，没有再限制牌类。
- **木牛流马内的黑色牌也算来源**：响应候选走 `buildUsableSources`（手牌 + 木牛流马内存牌），与引擎其它弃牌/响应交互同口径。
- **真正的【无懈可击】不会被重复列出**：`appendConversionSources` 跳过牌类已等于目标牌类的牌，真牌走普通来源。
- **`id` 字段只是元数据**：技能 id 由 `<文件夹名>/<技能名>` 决定，本包为 `卧龙诸葛亮/看破`；`general.json` 的 `name` 必须与文件夹名一致（否则校验器警告）。
- **外部包默认不加载**：只有 `--generals-dir=examples/generals`（或 `--generals-pool=all` + 相应目录）时才进池；详见 `docs/generals-pack-api.md`。

## 自检

```bash
npm run generals:check -- --dir=examples/generals --strict
npm run generals:check -- --dir=examples/generals --selfplay=3
```

> 本包是**纯数据包**（只有 `general.json` + `看破.skill.json`），没有任何相对导入，复制到任何目录都一样。
