# AGENTS.md

CLI 三国杀 (SanGuoSha) — a TypeScript CLI card game with a host-authoritative **online multiplayer** mode and LLM-driven AI. Fork/extension of DonyLeno/CLI-SanGuoSha (see `README.md` for full dev notes).

## Commands

- `npm run dev` — run the local single-player game (**requires `bun`**).
- `npm run host -- --players=3` — start an online room server (default `0.0.0.0:9527`, 2–6 players). All players, including the host, join with a separate client. Online AI: `--ai=N` fills N server-side AI seats (LLM-driven, `--ai-driver=qwen|ollama|simple`, fallback to local strategy); see README §联机游玩.
- `npm run join -- --host=IP --port=9527 --name=NAME` — join a room.
- `npm run typecheck` — `tsc --noEmit`. Keep it clean (passes today).
- `npm test` — `node --test --import tsx src/**/*.test.ts`. 62 tests, all pass.
- `npm run build` — `tsc` emit to `dist/`.
- `npm run lint` — eslint. ⚠️ **Not a clean gate**: ~20 pre-existing errors (unused vars in `*.test.ts`, `no-explicit-any`, floating promises in `network/*`). Don't add new ones; don't fix the old ones en masse.

## Architecture

- `src/engine/` — pure game logic, no I/O. `game.ts` = `SanGuoGame`（状态 + 编排 + 交互管线，对拆出模块只保留薄封装）；`cards.ts` = card/enum + deck；`interaction.ts` = request/decision 类型；`types.ts` = 共享类型/枚举（game.ts re-export 保持公共 API 不变）；`generals.ts` = 武将库 + 身份/武将纯帮助函数；`card-utils.ts` = 卡牌谓词等纯函数；`resolve.ts` = 卡牌结算函数族（杀/决斗/锦囊/判定/死亡/胜负…）；`skills.ts` = 主动技能系统（`useSkillAction` + `canUse*` + 技能状态）；`skill-hooks.ts` = 技能触发器钩子表；`ai-heuristics.ts` = 引擎内置 AI 启发式。拆出模块一律以 **context-interface** 模式工作：函数首参是 `XxxContext`，`game.ts` 以 `this as unknown as XxxContext` 传入，模块间不互相 import（跨模块调用走 context），`private` 成员保持私有。`GameSnapshot` 是传给 UI/AI/network 的只读视图。所有脚本化响应（闪/杀/无懈可击/借刀杀人/弃牌/判定…）都通过 `InteractionRequest` + `DecisionHandler` 经 `game.decide()` 流转——引擎从不自动应答（阵亡玩家默认除外）。
- `src/ui/app.ts` — OpenTUI CLI 层；驱动人机输入与 AI 循环；UI modes：`setup/game/response/discard/command`。`action-hints.ts` = 出牌提示纯函数；`render-lines.ts` = 按 mode 的渲染行构建器（显示区/状态区/操作区）。
- `src/agent/` — `ai.ts` decision loop (LLM; reasoning levels fast/normal/deep map to OpenAI-compatible `reasoning_effort`, per-turn thinking time, interaction decisions via `decideInteraction`, end-of-turn strategy review producing a free-text strategy note injected into later contexts), `local-engine.ts` (Simple AI fallback), `prompt.ts` assembly + `pickReasoningLevel`, `round-context.ts` (shared multi-round context builder, `SG_AI_CONTEXT_ROUNDS`), `turn-decision.ts` (shared LLM→local→heuristic picker). Providers `qwen.ts`/`ollama.ts`. Debug via `devlog/ai-log.md` (gitignored, written by `src/devlog/ailog.ts`; stages: probe/decision/decision-repair/interaction/strategy).
- `src/network/` — host-authoritative TCP, newline-delimited JSON (`encodeMessage` in `protocol.ts`). `server.ts` = authoritative room host, `host.ts` = entry, `client.ts`, `protocol.ts` = wire types + `NETWORK_PROTOCOL_VERSION = 4`. `createClientSnapshot` hides other players' hands/roles (viewer-scoped).
- `tools/light-client/` — zero-dependency Go client (`main.go`, go 1.21) with prebuilt binaries committed in `tools/light-client/` and `dist/`. Recompile and refresh binaries whenever the network protocol changes.

## Rules of thumb

- Adding a card/skill/effect must sync all of: `cards.ts` (definition + deck), `resolve.ts` (结算)/`skills.ts` (主动技能)/`game.ts` (可玩动作 + 分发)，以及 `rules.md`/`README.md` 对应章节。Documented rules follow the **current implementation**, not full tabletop rulings.
- Protocol changes: bump `NETWORK_PROTOCOL_VERSION` and update **both** the TS client and the Go light client.
- Server always calls `game.setDeferDyingResolution(true)` and sets one `DecisionHandler` per peer. Disconnects get a 60s reconnect window (`reconnectTimeoutMs`); server auto-restarts after game over / room close.
- `--seed=N` gives a deterministic RNG (also `SG_SEED` env) for reproducible tests/replays.

## TypeScript constraints

- Strict + NodeNext ESM: relative imports need the `.js` extension (`./engine/game.js`).
- `noUncheckedIndexedAccess` (indexing yields `T | undefined`) and `exactOptionalPropertyTypes` are on — handle undefined and optional props explicitly.

## Config / env

- `.env` is gitignored; copy `.env.example`: `QWEN_API_KEY`, `QWEN_BASE_URL`, `QWEN_MODEL`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `SG_ONLINE_PORT`.

## Read before changing

- `README.md` — architecture + startup flow, §8 rule→code mapping, §9 extension points.
- `rules.md` — rule reference used by help text and AI prompts.
- `docs/interaction-refactor-plan.md` — design behind the online interaction protocol.

## Gotchas

- An empty untracked `test-write` file sits at the repo root — leftover, ignore it.
- AI behavior changes usually require updating `prompt.ts` (context structure) and `ai.ts` (decision/fallback) together, not just the engine.
