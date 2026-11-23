# iKi

A local-first AI agent harness and desktop companion for macOS and the terminal. iKi connects to external LLM providers (or local models), runs workspace-scoped tools with human-in-the-loop approval, and persists durable conversations in local SQLite. It is **not itself an AI** — the intelligence comes from the providers you configure.

> **Status:** Early-stage (`v0.1.0`) and actively evolving. Expect rapid iteration across the desktop app, CLI, and internal harness packages.

<!-- TODO: Add screenshots / GIFs of the desktop app, companion overlay, and CLI TUI -->

## What You Can Do With iKi

- **Work inside a local project with guardrails** — Read, write, edit, and delete files, run shell commands, or search the web, scoped to a chosen workspace directory with approval gates for destructive actions.
- **Orchestrate multiple AI providers** — Use one interface for OpenAI, Anthropic, DeepSeek, Kimi, MiniMax, local Ollama models, or ACP-backed agents.
- **Run durable, long-horizon workflows** — Persist threads and compaction checkpoints in local SQLite (`node:sqlite`), delegate tasks to sub-agents, write personal skill instructions, and set one-shot deferred reminders (**awaiters**) to continue a thread later.
- **Choose your surface** — Work in the macOS Electron desktop app (complete with a **Companion overlay** showing the agent's current phase) or from the terminal via the interactive CLI / headless mode.

## Download

[**Latest Release →**](https://github.com/irorange27/iKi/releases/latest)

Download the `.dmg` from the latest release, open it, and drag iKi to Applications.

**Requirements:** macOS 14+ (arm64).

## Quick Start

Requires **Node.js 24.x** with Corepack enabled.

```bash
git clone https://github.com/irorange27/iKi.git
cd iKi
corepack enable
pnpm install --frozen-lockfile
```

### Desktop App

```bash
pnpm app:dev
```

On first launch, add a provider (OpenAI, Anthropic, DeepSeek, Kimi, MiniMax, Ollama, or ACP) with your API key, then start chatting.

### CLI

```bash
pnpm cli
```

Supports interactive TUI mode, single-prompt execution, thread continuation, and shared local storage (`~/.iki` by default).

## Workspace Structure

| Package | Role |
|---|---|
| `packages/desktop` | Electron shell (`main`, `preload`, Vue 3 renderer) and Companion overlay |
| `packages/cli` | Terminal entrypoint (`@iki/cli`) with interactive TUI and headless modes |
| `packages/harness` | Core runtime wiring, tools, and thread-session orchestration |
| `packages/agent` & `packages/agent-loop` | Agent abstractions and execution loop |
| `packages/llm` & `packages/llm-pi-ai` | Provider interfaces and `@earendil-works/pi-ai` adapter |
| `packages/session` & `packages/store` | Session state and local SQLite persistence |
| `packages/system-prompt` | System prompt assembly and dynamic tool/persona rules |
| `packages/core` | Shared platform, logging, and core utilities |
| `packages/theme` | Shared UI theme tokens |

## Tech Stack

| Layer | Technology |
|---|---|
| Shell | Electron 45, Node.js 24 |
| UI | Vue 3 + Pinia + Tailwind CSS 4 |
| Build | Vite, electron-forge |
| Data | `node:sqlite` (Node.js built-in) |
| LLM Layer | `@earendil-works/pi-ai` |
| Testing & Quality | Vitest, happy-dom, `vue-tsc`, ESLint 9, dependency-cruiser, knip |
| CI | GitHub Actions |

## Privacy

Messages are sent to whichever third-party API provider you configure.

## License

[AGPLv3](LICENSE)
