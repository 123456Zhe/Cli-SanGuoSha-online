# 潘璋（吴，男，4 体力）

| 文件 | 作用 |
|---|---|
| `general.json` | 元数据 + 技能列表（`skills: ["夺刀"]`） |
| `夺刀.skill.ts` | **代码**技能：触发技，受杀伤害后弃一张牌，获得伤害来源的武器 |
| `general.md` | 本文件 |

> 官方页为“潘璋&马忠”（合体武将）；队列名为“潘璋”，包名从队列。

## 技能

- **夺刀**（代码，触发）：当你受到造成的伤害后，你可以弃置一张牌，然后获得伤害来源装备区里的武器牌。

## 用到的 API 与触发点

| 项 | 用法 |
|---|---|
| 技能类型 | `kind: "triggered"` + `triggers: ["after_damage"]` + `onTrigger.after_damage` |
| 伤害牌判定 | `payload.card`（after_damage 的 card 即造成伤害的那张牌）为杀/火杀/雷杀 |
| 代价 | `buildUsableSources` 过滤 origin=hand 后 `requestDiscardSelection(target, 1, reason, sources)`，返回的牌手动进弃牌堆 |
| 获得武器 | 装备区只存类型：读 `source.weapon`（WeaponType），置 null 后按引擎 `createCard` 惯例重建一张牌（colorless / suit none / rank 0）进手牌；id 用 WeakMap 计数 |

## 已知限制

- 无武器可获得时不发动（免得白弃一张牌）；伤害来源已死亡时也无法获得（FAQ）。
- 弃置仅限手牌：FAQ 允许弃置装备区牌，但 `buildUsableSources` 只含手牌+木牛内牌，暂不支持。
- 来源武器槽是直接赋值，`equip_lost` 钩子不触发（枭姬不联动）。
- 火杀/雷杀视为杀（与 `isSlashCard` 同口径）。

## 规则依据

- 三国杀 Wiki | Fandom 潘璋&马忠页：体力上限 4；夺刀（新一将成名2013）"当你受到造成的伤害后，你可以弃置一张牌，然后获得伤害来源装备区里的武器牌"；FAQ：弃置一张牌可以弃置装备区里的牌；伤害来源死亡时无法执行获得武器效果。
