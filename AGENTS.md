# AGENTS.md

CLI 三国杀 (SanGuoSha) — a TypeScript CLI card game with a host-authoritative **online multiplayer** mode and LLM-driven AI. Fork/extension of DonyLeno/CLI-SanGuoSha (see `README.md` for full dev notes).

## Commands

- `npm run dev` — run the local single-player game (**requires `bun`**).
- `npm run host -- --players=3` — start an online room server (default `0.0.0.0:9527`, 2–6 players). All players, including the host, join with a separate client.
- `npm run join -- --host=IP --port=9527 --name=NAME` — join a room.
- `npm run typecheck` — `tsc --noEmit`. Keep it clean (passes today).
- `npm test` — `node --test --import tsx src/**/*.test.ts`. 51 tests, all pass.
- `npm run build` — `tsc` emit to `dist/`.
- `npm run lint` — eslint. ⚠️ **Not a clean gate**: ~20 pre-existing errors (unused vars in `*.test.ts`, `no-explicit-any`, floating promises in `network/*`). Don't add new ones; don't fix the old ones en masse.

## Architecture

- `src/engine/` — pure game logic, no I/O. `game.ts` = `SanGuoGame`; `cards.ts` = card/enum + deck; `interaction.ts` = request/decision types. `GameSnapshot` is the read-only view passed to UI/AI/network. All scripted responses (闪/杀/无懈可击/借刀杀人/弃牌/判定…) flow through `InteractionRequest` + `DecisionHandler` via `game.decide()` — never auto-answered by the engine (except dead-player defaults).
- `src/ui/app.ts` — OpenTUI CLI layer; drives human input and the AI loop; UI modes: `setup/game/response/discard/command`.
- `src/agent/` — `ai.ts` decision loop, `local-engine.ts` (Simple AI fallback), `prompt.ts` assembly, providers `qwen.ts`/`ollama.ts`. Debug via `devlog/ai-log.md` (gitignored, written by `src/devlog/ailog.ts`).
- `src/network/` — host-authoritative TCP, newline-delimited JSON (`encodeMessage` in `protocol.ts`). `server.ts` = authoritative room host, `host.ts` = entry, `client.ts`, `protocol.ts` = wire types + `NETWORK_PROTOCOL_VERSION = 4`. `createClientSnapshot` hides other players' hands/roles (viewer-scoped).
- `tools/light-client/` — zero-dependency Go client (`main.go`, go 1.21) with prebuilt binaries committed in `tools/light-client/` and `dist/`. Recompile and refresh binaries whenever the network protocol changes.

## Rules of thumb

- Adding a card/skill/effect must sync all of: `cards.ts` (definition + deck), `game.ts` (playable actions + resolution), and the matching section of `rules.md`/`README.md`. Documented rules follow the **current implementation**, not full tabletop rulings.
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
