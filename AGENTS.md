# AGENTS.md — iKi orientation

**iKi**: macOS Electron chat client that wraps third-party LLM APIs with local tool-calling, SQLite persistence, and an optional headless daemon (QQ-bot bridge). Not itself an AI — intelligence comes from the wired provider (OpenAI / Anthropic / DeepSeek / Kimi / MiniMax / Ollama / ACP).

**Golden rule:** all business logic lives in `packages/backend` (pure Node/TS). `desktop/` (Electron) and `daemon/` (headless HTTP+WS) are thin shells; dependencies point one way only: `desktop`/`daemon` → `backend`.

## Workflow

1. Get it running first: `pnpm run app:dev` (or `daemon:start`).
2. Find the file via the table below; read before writing. Smallest reversible change, no speculative abstraction.
3. `pnpm run ci:quality` must pass before declaring done. UI changes: click through in the running app — type-check ≠ feature-correct. Cross-layer wiring (renderer→IPC→backend→SDK→tools→persistence): run `pnpm run test:e2e` (real app + scripted provider; entry `tests/integration/e2e/run_smoke.mjs`).
4. Commit only when the user asks (`pnpm run commit`). Never `--no-verify`. Single test file: `pnpm vitest run <path>`.
5. Non-negotiables (full list in `docs/conventions.md`): no `pnpm-lock.yaml`/`.github` edits without explicit request; no native/OTel/Langfuse deps in the Vite main chunk.

## Commands

| Command | Purpose |
|---|---|
| `pnpm run app:dev` | Desktop app in dev mode |
| `pnpm run app:preview` | Launch the latest packaged app from `out/` |
| `pnpm run app:build` | Build distributable artifacts |
| `pnpm run daemon:start` | Headless daemon |
| `pnpm run -s ci:quality` | Completion gate: lint + tsc + vue-tsc + architecture + coverage run |
| `pnpm test` | All tests |
| `pnpm run test:harness` | Focused harness regression set |
| `pnpm run test:e2e` | Cross-layer smoke (real app + scripted provider) |
| `pnpm run test:renderer` | Renderer-only tests |
| `pnpm vitest run <path>` | One test file |
| `pnpm run commit` | Interactive semantic commit |
| `pnpm run changelog:check` | Verify `changelogs/` matches the generator |
| `python3 scripts/generate-icon.py` | Regenerate the app icon (requires Pillow) |

DevTools auto-open is on in dev (`app:dev`, `start`); set `IKI_AUTO_OPEN_DEVTOOLS=false` to disable. Packaged builds never auto-open.

## Changing the harness

Read the [backend ownership and regression map](packages/backend/README.md#runtime-contracts) before editing a core path. It is tracked; design notes under `docs/` may be missing or stale.

- For concurrency, recovery or tool lifecycle changes, use the [implementation and review checklist](packages/backend/HARNESS_REVIEW.md). State the invariant and scope, then prove it through the real consumer before claiming completion.
- Reproduce at the actual consumer boundary: provider inputs, SDK step count, persisted approval decision, or exported trajectory. A mock returning the expected text does not validate the wiring.
- Extend the existing owner; do not add another history slicer, approval policy evaluator, retry loop, or trajectory recorder in a caller.
- Change behavior, its boundary regression, and the ownership map together. Preserve unrelated uncommitted edits; do not “repair” a failing regression by restoring behavior that the contract explicitly forbids.
- Use `pnpm run test:harness` for the focused loop; `pnpm run ci:quality` remains the completion gate. Keep fixes local to backend unless the transport contract changes.

## Where things are

```
packages/backend   ← business logic — README has the architecture + chat-turn pipeline
packages/desktop   ← Electron shell: main (IPC translation only) / preload / renderer
packages/daemon    ← headless server: server_http / server_ws / napcat_adapter / tool_access
packages/theme     ← shared CSS tokens
tests/             ← vitest, partially mirrors packages/*/src
docs/              ← conventions, ADRs, design notes, reports, process (gitignored — may be absent on fresh clones)
postmortem/        ← incident write-ups
```

**Task starting points**

| You want to… | Start here |
|---|---|
| Add/modify a tool | `packages/backend/src/tools/` + `tools/schemas/` + register in `tools/index.ts` |
| Change context budget / compaction | `packages/backend/src/agent/context_budget.ts` + runner `prepareStep`; see backend contract |
| Change prompt assembly | `packages/backend/src/turn_prep/context.ts`, `context_blocks.ts` |
| LLM-call surface / add a provider | `packages/backend/src/provider/llm/factory.ts` |
| Tool approval UX | `packages/backend/src/turn_prep/approval.ts` + renderer `modules/chat/tool_approval_controller.ts` |
| New IPC channel | `desktop/src/preload/index.ts` + `main/ipc/` + types in `packages/backend/src/types/electron_api.ts` |
| New daemon route | `packages/daemon/src/server_http.ts` or `server_ws.ts` |
| Understand the chat-turn pipeline / harness | `packages/backend/README.md` (pipeline) + `docs/harness.md` (concepts) |

## Details live here (read on demand)

- `packages/backend/README.md` — chat-turn pipeline, backend directory map, harness invariants (memory, approval, observability)
- `docs/harness.md` — runtime concept model in current framework vocabulary (context engineering, op-loop/steering, HITL approvals, durable execution); read before renaming or moving these concepts
- `packages/{desktop,daemon}/README.md` — shell boundary rules
- `docs/conventions.md` — code conventions, prohibited actions, landmines, testing, commit governance
- `docs/decisions/` — ADRs: why `AgentHarness` exists, why `turn_prep/` is the boundary, why `@iki/core` was deleted
- `docs/napcat-integration.md` — QQ bridge via NapCat; `postmortem/backend-bugs-2026-04.md` — bug patterns (pre-monorepo paths, see its banner)
- `docs/design/` — operative subsystem notes only (MCP, awaiters, proactive tasks, logging contract, ACP) — see its README index
- `docs/reports/` — dated audits and their measured results; `docs/process/` — proposals and research notes
- `README.md` — user-facing (features, download, quick start); `.impeccable.md` — UI design philosophy
- `CLAUDE.md` / `IKI.md` — pointer stubs to this file; don't add content there
