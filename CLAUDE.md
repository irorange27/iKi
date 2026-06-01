# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm run app:dev              # Start desktop app in dev mode (Electron Forge + Vite)
pnpm run app:build            # Create distributable artifacts
pnpm run app:preview          # Launch packaged app from out/ for manual check

pnpm run lint                 # ESLint across .ts/.tsx/.vue
pnpm run ts                   # TypeScript type-check (tsc)
pnpm run ts:vue               # Vue type-check (vue-tsc --noEmit)
pnpm run ci:quality           # Full quality gate: lint + tsc + vue-tsc + tests with coverage

pnpm test                     # Run all tests (vitest run)
pnpm run test:watch           # Vitest in watch mode
pnpm run test:renderer        # Renderer-only tests (vitest run tests/renderer)
pnpm run test:coverage        # Tests with coverage report

pnpm run daemon:start         # Start headless daemon process
pnpm run commit               # Interactive semantic commit (commitizen/cz-git)
pnpm run commit:check         # Lint recent commit messages

pnpm run changelog:preview    # Preview generated release notes
pnpm run changelog:sync       # Write changelogs/v<version>.md
pnpm run changelog:check      # Verify checked-in changelog matches generator
```

To run a single test file: `pnpm vitest run tests/path/to/file.test.ts`

## Architecture

iKi is an Electron desktop app (macOS-only shipping target) that functions as a local AI agent pet. It has two runtime modes launched from the same `src/main.ts` entry point:

**Desktop mode** (default): full Electron GUI with a main chat window, optional companion overlay window, and a managed background daemon process.

**Daemon mode** (`--daemon` flag): headless HTTP+WebSocket server that exposes the chat/agent/tool surface to external clients (e.g., NapCat for QQ bot bridging).

### Process model

- **Main process** (`src/main/`, entry `src/main.ts`): Electron main process. Registers IPC handlers, manages windows, owns the daemon lifecycle, background runtime, and auto-updater.
- **Preload** (`src/preload/index.ts`): Bridges main↔renderer via `contextBridge.exposeInMainWorld('electronAPI', ...)`. The typed `ElectronApi` interface in `src/shared/types/electron_api.ts` is the contract.
- **Renderer** (`src/renderer/`, entry `src/renderer/index.ts`): Vue 3 + Pinia + Tailwind CSS v4 SPA. All DOM interaction goes through Vue composables (`src/renderer/composables/`), Pinia stores (`src/renderer/store/`), and view components (`src/renderer/views/`).
- **Daemon** (`src/daemon/`): HTTP server (`server_http.ts`) + WebSocket server (`server_ws.ts`) that expose a REST/WS API. The NapCat reverse bridge (`napcat_adapter.ts`) lets external QQ bots connect via WebSocket and participate in chat threads. The daemon reuses the same chat service and tool registry as the desktop path.

### Agent / conversation loop

The agent system lives in `src/core/agent/`:

- **`ConversationRunner`** (`runners/conversation_runner.ts`): interface for generating LLM responses. The primary implementation is `SimpleConversationRunner` (`runners/simple_conversation_runner.ts`), which wraps the Vercel AI SDK (`ai` package).
- **`ConversationHarness`** (`harnesses/conversation_harness.ts`): wraps a runner with tool registration and a tool runtime context. This is what chat streaming instantiates per-turn.
- **Tool loop** (`src/main/services/chat/chat_tool_loop.ts`): drives multi-step agent turns — generate → execute tool calls → feed results back → loop, up to a configurable max iterations. Pending tool approvals pause the stream.
- **`AgentRunTracker`** (`run_tracker.ts`): records structured agent run traces (runs, steps, tool calls), persisted and exposed via `chat:runs:list`, `chat:runs:trace:get`, `chat:runs:tree:get`.

### Chat service composition

`src/main/services/chat/chat_service.ts` composes the chat subsystem from factory functions, each receiving only its declared dependencies:

| Module | Responsibility |
|---|---|
| `chat_persistence` | CRUD for threads, messages (SQLite via `src/core/db/`) |
| `chat_memory` | Short-term message recall, long-term search, affect state |
| `chat_streaming` | Per-turn generation: harness setup, tool loop, UI chunk emission |
| `chat_approval` | Tool approval gating with timeout/recovery |
| `chat_runs` | Agent run trace queries |
| `chat_usage` | Token usage recording and aggregation |

The daemon's WebSocket layer (`server_ws.ts`) drives the same chat service, so external clients get identical agent behavior.

### Tools

Tools live in `src/core/tools/`. The `registerStandardTools()` function in `src/core/tools/index.ts` registers all built-in tools into a global `defaultToolRegistry`. Categories:

- **File tools**: read, write, edit (exact-match string replacement), list directory, delete
- **Shell tool**: shell command execution
- **Agent tool**: delegated sub-agent for bounded investigation work
- **Web tools**: web search, fetch
- **Skill tools**: CRUD for user-managed `SKILL.md` files
- **Todo tools**: thread-scoped structured checklist CRUD
- **Task tools**: proactive/recurring reminder CRUD
- **Awaiter tools**: await condition tools

MCP tools from connected MCP servers are merged in at harness creation time (`resolveToolsForClient` in `src/daemon/tool_access.ts`).

### Provider system

`src/core/provider/llm/factory.ts` creates AI SDK language models per provider type:
- `openai`, `deepseek`, `minimax` — via `@ai-sdk/*` packages
- `anthropic`, `anthropic-compatible` — via `@ai-sdk/anthropic`
- `acp` — Agent Client Protocol for Codex-style agents (`acp.ts`)
- Generic OpenAI-compatible fallback (`@ai-sdk/openai-compatible`) for other providers (e.g., Kimi)

Per-provider files (`openai.ts`, `deepseek.ts`, `kimi.ts`, `minimax.ts`) re-export factory functions under provider-specific names for convenience.

Providers are stored in SQLite (`src/core/db/providers.ts`) and managed via the `providers:*` IPC channels.

### Database

`src/core/db/database.ts` manages a better-sqlite3 connection (single file at `{userData}/iKi_v0.db`). The migration system (`src/core/db/migration/`) applies versioned migrations. Config, providers, threads, messages, and memory entries all live in SQLite. The database is initialized once at startup in both desktop and daemon modes.

### Key shared types

`src/shared/types/` holds cross-cutting type definitions: `electron_api.ts` (IPC contract), `chat.ts` (thread/message/workspace), `config.ts`, `provider.ts`, `memory.ts`, `agent_run.ts`, `mcp.ts`, `tasks.ts`, `speech.ts`, `companion.ts`, `continuity.ts`.

### Windows

- **Main** (`main_window.ts`): frameless, `hiddenInset` title bar, loads the Vue renderer
- **Companion** (`companion_window.ts`): small desktop overlay (236×170), positioned near the screen corner, driven by `companion_service.ts` phase state (dormant/listening/executing/nudging)
- **Settings** (`settings_window.ts`): separate window for provider/model/settings management

### Design philosophy

See `.impeccable.md` for the visual design context. The UI should feel restrained, experimental, and trustworthy — a focused desktop tool, not a flashy AI landing page. Optimize equally for rapid message dispatch and deliberate context management. Controls should be visually quiet until interaction.

### Testing

Tests mirror the `src/` structure under `tests/`. Vitest with `environment: 'node'` is the default; renderer component tests use `happy-dom` via `@vue/test-utils`. The setup file `tests/setup/strict_error_logs.ts` installs a guard that fails tests on unexpected error/warning log output. Coverage thresholds are enforced in `vitest.config.mts` (lines 60, functions 59, branches 46, statements 59).

### Commit governance

Conventional Commits required. PR titles must follow semantic format (CI enforced). Commitizen (`pnpm run commit`) provides interactive prompts. Husky manages pre-commit hooks. The changelog is generated from commit history via `scripts/scaffold-changelog.cjs`.
