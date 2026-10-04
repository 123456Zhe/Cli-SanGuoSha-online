# M2 进度交接文档（外部武将包）

> 面向接手 agent。对应已批准计划：`~/.commandcode/plans/m2-general-packs.md`；总计划 `docs/generals-pack-plan.md`（Phase 1 + Phase 2）。

## 0. 一句话状态

**M2 已完成。** 编译错误已修（`general-pack.ts` 可选属性用 `NonNullable<...>`）；`npm test` **157 全绿**（新增 `general-pack.test.ts` 7 例 + `pack-skill-exec.test.ts` 4 例）；入口已接线（`src/index.ts` dev 默认 `pool:"all"`、`src/network/host.ts` host 默认 `pool:"builtin"`，均在构造前 `await loadGeneralPacks`）；示例包已建 `examples/generals/吕蒙/`；文档已更新（`docs/generals-pack-api.md` / `README.md §11` / `AGENTS.md` / `docs/generals-pack-plan.md §13`）。下方 §3 原始待办清单仅作历史记录。

## 1. M2 目标与已确认决策

- 目标：**放一个文件夹（`generals/<武将名>/`）就能选将/对局/触发技能**。
- 决策（本轮已与用户确认）：
  1. **完整接线到可执行**：外部包主动技能（出牌）+ 4 个触发点钩子都真正跑；JSON 声明式技能只加载+校验+给 AI 读，规则效果留 M3。
  2. **host 默认 builtin**：`npm run dev` 默认加载 `generals/`；`npm run host` 默认只内置，需 `--generals-pool=all` 才加载外部。
  3. **示例包附带但默认关**：放 `examples/generals/吕蒙/`，不放 `generals/`。
  4. hot-reload 不维护，但外部包注册表挂 `globalThis` 以便 reload 后存活。

## 2. 已完成（逐文件，均已落盘）

### 类型与 kingdom（Phase 1）
- `src/engine/types.ts`
  - `enum SkillName` → `export const SkillName = {...} as const;`（值命名空间保留，`SkillName.X` 全部照旧）。
  - 新增 `export type SkillId = string;`、`export type SkillName = SkillId;`（类型别名，`SkillName[]` 等类型标注零改动）、`export type BuiltinSkillId = (typeof SkillName)[keyof typeof SkillName];`、`export const KINGDOM = { Wei, Shu, Wu, Qun }`。
  - `Player.skills: SkillId[]`；`GameAction` 的 skill 分支 `skill: SkillId`；`GeneralDefinition.kingdom: string`、`skills: SkillId[]`。
- `src/engine/generals.ts`
  - 内部 `BUILTIN_GENERALS`；`GENERAL_LIBRARY` 改为**可变导出数组**（`loader` 用 `setLoadedGenerals` 原地改内容，保持引用稳定）。
  - 新增 `getBuiltinGenerals()` / `setLoadedGenerals(list)` / `resetLoadedGenerals()`。
  - `resolveGeneralByName` **改抛错**（原静默回落孙策，已删除 `return humanGeneral`）。
  - `pickRandomUnusedGeneral` 仍读 `GENERAL_LIBRARY`（已加载池），`humanGeneral` 仅作极端兜底常量保留。
- `src/engine/resolve.ts`：`getPlayerKingdom` 返回 `string`；`getKingdomRespondersInOrder(..., kingdom: string)`；护驾/激将/救援 的 `"魏"/"蜀"/"吴"` → `KINGDOM.*`（已 import KINGDOM）。
- `src/engine/skills.ts`：制霸的 `!== "吴"` → `KINGDOM.Wu`。

### 外部技能运行时注册表
- `src/engine/skill-module.ts`（**新文件，无 I/O**）：`SkillModuleCtx`（= `SkillUseContext & SkillHooksContext`）、`PackSkillHook`、`SkillModule`、`PackSkillEntry` 类型；注册表存 `globalThis.__sanguoPackRegistry__`；API：`registerPackSkill` / `getPackSkill` / `getPackSkills` / `getPackHooksFor(trigger)` / `resetPackSkills`。
- `src/engine/skill-registry.ts`：`SkillDescriptor` 加 `displayName?`；helper 参数改 `SkillId`；`SKILL_REGISTRY: Record<BuiltinSkillId, SkillDescriptor>`；`describeSkill(id)` 只查内置；新增 `resolveSkillDescriptor(id)`（外部包 → 内置 → 未知兜底）。

### 引擎执行接线
- `src/engine/skill-hooks.ts`：新增 `PACK_TRIGGERS`；`createSkillHooks` 由 `return {...}` 改为 `const hooks = {...}`，末尾对每个 trigger 追加 `getPackHooksFor(trigger)` 的包装 `(payload, logs) => entry.onTrigger?.[trigger]?.(packCtx, payload, logs)`，最后 `return hooks`。
- `src/engine/game.ts`：import `getPackSkills` + `SkillModuleCtx`；`getPlayableActions` 在 `"结束出牌阶段"` 之前枚举外部 active 技能（`player.skills.includes(id) && canUse` → push `{type:"skill", skill:id, label, requiresTarget, targets}`，`requiresTarget && targets 为空` 则跳过）。
- `src/engine/skills.ts`：import `getPackSkill`；`useSkillAction` 末尾（`"未知技能"` 之前）查 `getPackSkill(action.skill)`，命中则 `await packSkill.play(ctx as SkillModuleCtx, player, targetId)`，整体 try/catch 返回错误串（不让坏技能炸对局）。
- `src/agent/match-context.ts`：改用 `resolveSkillDescriptor(id)` + `descriptor.displayName ?? skill` 展示。

### 已完成但**有编译错误**的 loader
- `src/engine/general-pack.ts`（**新文件**）：`loadGeneralPacks(options)` / `resetGeneralPacks()`；扫描 `<dir>/*/general.json`；每包 try/catch 隔离；schema 校验；技能文件 `<名字>.skill.json|.ts|.mjs`；命名空间 id `${文件夹名}/${技能名}`；`--generals-json-only` 拒绝代码技能；`strict` 抛错；池合并按 name 排序；`pool==="builtin"` 直接返回。

## 3. 未完成 / 待办（按优先级）——**均已处理，保留作历史**

> 状态：① 编译错误已修；② 测试 157 全绿；③ 入口已接线；④ 示例包已建；⑤ 测试已加（11 例）；⑥ 文档已更新；⑦ 手动验收见 `docs/generals-pack-api.md`「手动验收」。

1. **修编译错误**（阻塞）：
   `src/engine/general-pack.ts:120` 附近 `parseCodeSkill` 的条件展开用了 `SkillModule["canUse"]`（含 `undefined`），在 `exactOptionalPropertyTypes: true` 下不合法。
   - 建议改法：全部用 `NonNullable<SkillModule["canUse"]>` / `NonNullable<SkillModule["getTargets"]>` / `NonNullable<SkillModule["play"]>` / `NonNullable<SkillModule["onTrigger"]>`；或先建 `const entry = { id, displayName, kind, description, ... } as SkillModule;` 再 `if (typeof obj.canUse === "function") entry.canUse = obj.canUse as ...`。同理检查 `parseDeclarativeSkill` 里的可选字段展开。
2. **跑测试**（`npm test`）：接线后未跑过。重点看 `resolveGeneralByName` 改抛错是否影响既有用例（`game.test.ts` / `disabled-generals.test.ts` 等）；`skill-registry.test.ts` 已改用 `getBuiltinGenerals()`（已改，避免受外部池污染）。
3. **入口接线（尚未做）**：
   - `src/index.ts`：`parseRuntimeOptions` 解析 `--generals-dir=`、`--generals-pool=all|builtin`、`--generals-json-only`、`--strict-generals`；`await loadGeneralPacks({ pool: "all", ... })` **在** `new SanGuoGame` 之前。
   - `src/network/host.ts`：目前是顶层同步代码，需包进 `async main()`；`await loadGeneralPacks({ pool: "builtin", ... })` 后再 `new GameServer(options)`；同样解析上述开关（默认 `builtin`）。
   - WebUI relay 不用改（只透传）；`webui/src/protocol.ts` 的 `skills: string[]` 已兼容。
4. **示例包（尚未建）**：`examples/generals/吕蒙/`：`general.json`、`克己.skill.json`（声明式）、`涉猎.skill.ts`（代码主动技能 demo：`canUse`/`getTargets`/`play` 用 `ctx`）、`general.md`（说明拷到 `generals/` 后 `npm run dev` 生效）。
5. **测试（尚未加）**：
   - `src/engine/general-pack.test.ts`：临时目录建包 → 加载成功/命名空间 id/`resolveGeneralByName("吕蒙")`；坏包隔离 + `strict` 抛错；`jsonOnly` 拒绝 `.ts`；`pool:"builtin"` 不加载。
   - `src/engine/pack-skill-exec.test.ts`：主动技能出现在 `getPlayableActions` 且 `playAction` 生效；`after_damage` 钩子触发；`play` 抛错不中断。
   - 测试须在 `beforeEach/afterEach` 调 `resetGeneralPacks()`（`resetPackSkills` + `resetLoadedGenerals`）。
6. **文档（尚未更新）**：`docs/generals-pack-api.md` 补全契约/`SkillModuleCtx`/命名空间/开关；`README.md` 新增“武将包”小节；`AGENTS.md` architecture 增补 `general-pack.ts`/`skill-module.ts`、host 默认 builtin、测试计数（当前 146，加完新用例同步）；`docs/generals-pack-plan.md` 的 M2 状态与 §12。
7. **手动验收**：拷 `examples/generals/吕蒙` → `generals/吕蒙`，`npm run dev` 选将出现吕蒙、主动技能可发动；`npm run host`（无开关）不含吕蒙，`npm run host -- --generals-pool=all` 含。

## 4. 关键设计约束 / 坑（接手必读）

- **命名空间技能 id** = `${文件夹名}/${技能名}`（如 `吕蒙/克己`）。`Player.skills`/快照/协议存这个 id；UI/AI 展示用 `displayName`。内置技能 id 就是中文技能名本身。
- **`type SkillName = SkillId = string`**：`SkillName.X` 值写法与 `SkillName[]` 类型标注都保留，理论上 546 处引用零改动；但注意 `SKILL_REGISTRY[某string]` 需 `as BuiltinSkillId`（`skill-registry.test.ts` 已示范）。
- **`globalThis.__sanguoPackRegistry__`**：热重载会重建 `src/engine` 模块图，注册表挂 globalThis 才能存活；`general-pack.ts` 的 options 不跨图，`reload` 不重新扫目录（决策 5，不维护）。
- **`.ts` 技能动态 import**：`await import(pathToFileURL(abs).href)`，仅 bun/tsx/dev 可用；跨环境用 `.mjs`。参考 `src/engine/hot-reload.ts` 的 import 写法。
- **外部 `onTrigger(ctx, payload, logs)`**：第一参是引擎 ctx（运行时就是 `SanGuoGame`），钩子内部自行 `ctx.hasSkill(player, id)` 判断归属，与内置写法一致；禁止 `Math.random`（用 `ctx.randomIndex`）。
- **解析式技能（`.skill.json`）M2 只加载不生效**：`rules` 原样保留，等 Phase 3 谓词层消费。
- **host 与 dev 默认池不同**（见决策 2），实现时别把两者默认写反。
- `general.json` 的 `skills` 是**原始技能名**数组；文件名为 `<技能名>.skill.*`；loader 用技能名拼命名空间 id。
- 武将名重复（与内置或已加载包）→ 该包报错跳过。

## 5. 验证命令

```bash
npm run typecheck   # 必须干净（当前 1 error，见 §3.1）
npm test            # 当前基线 146 例；接线后需全绿 + 新增用例
npm run lint        # 基线 25 个存量错误，不得新增
```

## 6. 本次改动的文件清单

- 改：`src/engine/types.ts`、`src/engine/generals.ts`、`src/engine/resolve.ts`、`src/engine/skills.ts`、`src/engine/skill-registry.ts`、`src/engine/skill-hooks.ts`、`src/engine/game.ts`、`src/engine/skill-registry.test.ts`、`src/agent/match-context.ts`
- 新：`src/engine/skill-module.ts`、`src/engine/general-pack.ts`
- 尚未动：`src/index.ts`、`src/network/host.ts`、`examples/**`、`docs/generals-pack-api.md`、`README.md`、`AGENTS.md`、`docs/generals-pack-plan.md`
