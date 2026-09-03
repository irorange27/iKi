# AGENTS.md — iKi orientation

**iKi**: macOS Electron chat client that wraps third-party LLM APIs with local tool-calling, SQLite persistence, and an optional headless daemon (QQ-bot bridge). Not itself an AI — intelligence comes from the wired provider (OpenAI / Anthropic / DeepSeek / Kimi / MiniMax / Ollama / ACP).

**Golden rule:** all business logic lives in `packages/backend` (pure Node/TS). `desktop/` (Electron) and `daemon/` (headless HTTP+WS) are thin shells; dependencies point one way only: `desktop`/`daemon` → `backend`.

## Workflow

1. Get it running first: `pnpm run app:dev` (or `daemon:start`).
2. Find the file via the table below; read before writing. Smallest reversible change, no speculative abstraction.
3. `pnpm run ci:quality` must pass before declaring done. UI changes: click through in the running app — type-check ≠ feature-correct.
4. Commit only when the user asks (`pnpm run commit`). Never `--no-verify`. Single test file: `pnpm vitest run <path>`.
5. Non-negotiables (full list in `docs/conventions.md`): no `pnpm-lock.yaml`/`.github` edits without explicit request; no native/OTel/Langfuse deps in the Vite main chunk.

## Where things are

```
packages/backend   ← business logic — README has the architecture + chat-turn pipeline
packages/desktop   ← Electron shell: main (IPC translation only) / preload / renderer
packages/daemon    ← headless server: server_http / server_ws / napcat_adapter / tool_access
packages/theme     ← shared CSS tokens
tests/             ← vitest, partially mirrors packages/*/src
docs/              ← ADRs, conventions, design notes (gitignored — may be absent on fresh clones)
postmortem/        ← incident write-ups
```

**Task starting points**

| You want to… | Start here |
|---|---|
| Add/modify a tool | `packages/backend/src/tools/` + `tools/schemas.ts` + register in `tools/index.ts` |
| Change prompt assembly | `packages/backend/src/agent_session/context.ts`, `context_blocks.ts` |
| LLM-call surface / add a provider | `packages/backend/src/provider/llm/factory.ts` |
| Tool approval UX | `packages/backend/src/agent_session/approval.ts` + renderer `modules/chat/tool_approval_service.ts` |
| New IPC channel | `desktop/src/preload/index.ts` + `main/ipc/` + types in `packages/backend/src/types/electron_api.ts` |
| New daemon route | `packages/daemon/src/server_http.ts` or `server_ws.ts` |
| Understand the chat-turn pipeline / harness | `packages/backend/README.md` (pipeline) + `docs/harness.md` (concepts) |

## Details live here (read on demand)

- `packages/backend/README.md` — chat-turn pipeline, backend directory map, harness invariants (memory, approval, observability)
- `docs/harness.md` — runtime concept model in current framework vocabulary (context engineering, op-loop/steering, HITL approvals, durable execution); read before renaming or moving these concepts
- `packages/{desktop,daemon}/README.md` — shell boundary rules
- `docs/conventions.md` — code conventions, prohibited actions, landmines, testing & coverage gates, commit governance
- `docs/decisions/` — ADRs: why `AgentHarness` exists, why `agent_session/` is the boundary, why `@iki/core` was deleted
- `docs/napcat-integration.md` — QQ bridge via NapCat; `postmortem/backend-bugs-2026-04.md` — bug patterns (pre-monorepo paths, see its banner)
- `docs/design/` — live subsystem notes only (MCP, awaiters, proactive tasks, logging contract, ACP, affect) — see its README index
- `README.md` — user-facing (tech stack, download); `.impeccable.md` — UI design philosophy
- `CLAUDE.md` / `IKI.md` — pointer stubs to this file; don't add content there
