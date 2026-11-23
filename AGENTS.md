# AGENTS.md — iKi orientation

**iKi**: an  AI agent harness for durable, multi-agent, long-horizon work, with terminal CLI (`@iki/cli`) and macOS Electron (`@iki/desktop`) surfaces. Supports any model provider.

**Golden rule:** all business logic lives in pure Node/TS workspace packages (`packages/core` .. `packages/harness`). `packages/cli` and `packages/desktop` are thin shells; dependencies point one way only (`cli` / `desktop` → `harness` → lower packages), enforced by `.dependency-cruiser.cjs`.

## Monorepo layout (`packages/`)

| Package | Role |
|---|---|
| `core` | Leaf contracts: domain settings (`settings.toml` Zod schemas incl. `[tools.shell]`), platform paths, logger, action risk, utils |
| `theme` | Base46 theme presets & schema |
| `store` | Local JSON/TOML persistence (`~/.iki/models.toml`, `~/.iki/settings.toml`, `~/.iki/state/`) |
| `session` | Append-only `SessionEvent` JSONL log (`~/.iki/sessions/<threadId>.jsonl`) |
| `system-prompt` | Static system prompt slots (`persona` → `planPrompt` → `extraPrompt` → `transcriptSystem`) & dynamic `<system_reminder>` snapshots |
| `llm` | Model-neutral transcript types, chronological UI ↔ `ModelMessage` projection (`ui_to_model.ts`), tool payload contracts |
| `llm-pi-ai` | `@earendil-works/pi-ai` provider adapter, model capability resolution, `sessionId` affinity & prompt-cache retention |
| `agent` | Tool & step contracts (`BaseTool`, `ToolRegistry`, `AgentStep`, `AgentHooks`) |
| `agent-loop` | Pure multi-step tool-calling loop (`runAgentLoop`) |
| `tools` | Pluggable built-in tools (`@iki/tools/shell`: OS-split `bash`/`pwsh` + durable background `job` tool, configured via `[tools.shell]`) |
| `harness` | Composition root: `thread_session`, `turn_prep`, `agent/turn`, `workspaces`, `mcp`, `runtimes`, `config`, host tool wiring |
| `cli` | Fullscreen `pi-tui` (`TuiAltScreen`) interactive REPL & `--print` / `--json` CLI |
| `desktop` | Thin Electron + Vue shell (main/preload/renderer) |

Every package has its own `README.md` documenting boundaries and entry points.

## Workflow & Quality Gates

1. Read before writing; keep changes minimal, reversible, and free of speculative abstraction.
2. Completion gate: `pnpm run ci:quality` (`eslint`, `tsc`, `vue-tsc`, `depcruise`, `knip --production`) + unit tests (`pnpm exec vitest run packages/*/tests`).
3. Cross-layer E2E verification:
   - Faux (keyless, deterministic): `pnpm run test:e2e:cli:faux` (CLI multi-turn, KV-cache prefix stability, `/jobs`, `/compact`, REPL) and `pnpm run test:e2e:desktop:faux` (Electron Settings UI, `models.toml`, streaming chat, multi-turn history, restart recovery). `pnpm run test:e2e` runs both.
   - Live (real LLM API, self-skips if local gateway unreachable): `pnpm run test:e2e:cli:live` and `pnpm run test:e2e:desktop:live` (`pnpm run test:e2e:live` runs both). Desktop UI debugging: `pnpm run app:debug` + `pnpm run cdp`.
4. Non-negotiables: no `pnpm-lock.yaml` or `.github` edits without explicit request; no native/OTel/Langfuse deps in the Vite main chunk; never import `@iki/tools` or `packages/harness/src/tools` from desktop renderer code.
5. Release tags trigger the macOS build (`release-build.yml`) and must match root `package.json` version. Before pushing a tag, package locally (`pnpm run package`) and launch `packages/desktop/out/iki-darwin-<arch>/iki.app/Contents/MacOS/iki` from a terminal to watch stderr.
6. Reviews & GitHub templates: before creating or updating an Issue or PR, read and follow `.github/ISSUE_TEMPLATE/` (`bug_report.md`, `feature_request.md`) or `.github/pull_request_template.md`, and keep PR titles Conventional Commits compliant (`.github/workflows/semantic-pr-title.yml`). Run the PR review protocol (`packages/harness/HARNESS_REVIEW.md`, `node scripts/pr_review_brief.mjs`) and resolve every blocking finding before merging.

## Harness Invariants

Read [packages/harness/README.md](packages/harness/README.md) and [packages/harness/HARNESS_REVIEW.md](packages/harness/HARNESS_REVIEW.md) before editing core turn/session/recovery paths.

- **KV-cache prefix stability**: keep `systemPrompt` strictly static (`persona` + rules + `<project_context>` + `<skills>`); dynamic per-turn facts (`<system_reminder name="runtime">`) and `<compacted-summary>` live in `role: 'user'` messages. Multi-step tool turns must replay as chronological `[assistant, tool, assistant, ...]` steps without double-wrapping tool outputs, and every provider call must forward `sessionId: threadId`.
- **No hardcoded tool tunables**: expose runtime knobs under `AppSettingsSchema` (`packages/core/src/domain/settings.ts`, e.g. `[tools.shell]`) and inject via DI at registration time (`packages/harness/src/tools/index.ts`).
- **Single owner**: extend the existing owner rather than adding duplicate history slicers, approval evaluators, retry loops, or session writers in callers. Preserve unrelated uncommitted edits.

## Task Starting Points

| You want to… | Start here |
|---|---|
| Add / modify a built-in tool plugin | `packages/tools/src/` + `[tools.*]` in `packages/core/src/domain/settings.ts` + wire in `packages/harness/src/tools/index.ts` |
| Change system prompt order / `<system_reminder>` | `packages/system-prompt/src/` (`README.md` documents exact slot order) + `packages/harness/src/turn_prep/context.ts`, `context_blocks.ts` |
| Change context budget / compaction | `packages/harness/src/agent/context_budget.ts`, `agent/turn/turn_budget.ts`, `thread_session/compaction.ts` |
| Change LLM adapter / caching / providers | `packages/llm-pi-ai/src/factory.ts`, `pi_adapter.ts` |
| Change UI ↔ ModelMessage replay | `packages/llm/src/message/ui_to_model.ts`, `ui_messages.ts`, `model_history.ts` |
| Change CLI TUI / slash commands / tool cards | `packages/cli/src/interactive.ts`, `turn_view.ts`, `tool_render.ts`, `commands.ts` |
| Change tool approval policy / desktop UX | `packages/core/src/utils/action_risk.ts`, `packages/harness/src/agent/harness/tool_resolver.ts`, `packages/desktop/src/renderer/modules/chat/tool_approval_controller.ts` |
| Add / modify Desktop IPC channel | `packages/desktop/src/preload/index.ts` + `packages/desktop/src/main/ipc/` + `packages/harness/src/types/electron_api.ts` |
| Inspect module contract surface | `pnpm run arch:context <module-id>` (`scripts/module_registry.json`) |
| Package Desktop / cut a release | `packages/desktop/forge.config.ts`, `packages/desktop/src/build/runtime_packaging.ts` |
| Open a GitHub Issue or PR | `.github/ISSUE_TEMPLATE/` (`bug_report.md`, `feature_request.md`) & `.github/pull_request_template.md` |

## Details Live Here (Read on Demand)

- `packages/*/README.md` — per-package contracts, entry points, and boundaries (tracked; authority over `docs/`)
- `packages/harness/HARNESS_REVIEW.md` — concurrency, recovery, tool lifecycle, and PR review checklist
- `docs/harness.md`, `docs/conventions.md`, `docs/design/` — untracked local notes; verify file paths against current code before relying on them (`docs/archive/` is historical only)
- `README.md` — user-facing overview & quick start; `.impeccable.md` — UI design philosophy
