# iKi

A local-first Electron desktop chat client for AI models — assemble prompts, run tool calls, and manage conversations from your Mac. iKi routes messages to third-party LLM providers, executes file operations and shell commands locally, and stores everything in SQLite. It is **not itself an AI** — the intelligence comes from the external APIs you connect.

## Download

[**Latest Release →**](https://github.com/irorange27/iKi/releases/latest)

Download the `.dmg` from the latest release, open it, and drag iKi to Applications.

**Requirements:** macOS 14+ (arm64).

## Quick Start

```bash
git clone https://github.com/irorange27/iKi.git
cd iKi
corepack enable
pnpm install --frozen-lockfile
pnpm run app:dev
```

Requires **Node.js 24.x** with Corepack enabled.

On first launch, add a provider (OpenAI, Anthropic, DeepSeek, Kimi, MiniMax, Ollama, or ACP) with your API key, then start chatting.

## Tech Stack

| Layer | Technology |
|---|---|
| Shell | Electron 39, Node.js 24 |
| UI | Vue 3 + Pinia + Tailwind CSS 4 |
| Build | Vite, electron-forge |
| Data | `node:sqlite` (Node.js built-in) |
| AI SDK | Vercel AI SDK (`ai`), `@ai-sdk/*` |
| Testing | Vitest, happy-dom, vue-tsc |
| CI | GitHub Actions |

## Features

- **Multi-provider chat** — one chat surface for OpenAI, Anthropic, DeepSeek, Kimi, MiniMax, Ollama, and ACP-backed agents. Conversations persist in local SQLite.
- **Tool calling** — read, write, edit, and delete files; run shell commands; search the web; manage todo lists; write personal skill instructions; delegate work to sub-agents. Destructive operations require approval. File and shell tools are scoped to a selected workspace directory.
- **Daemon mode** — a headless HTTP + WebSocket server exposes the same chat and tool surface to external clients, including a QQ bot via the built-in NapCat reverse bridge.
- **Proactive tasks** — cron-scheduled prompts that trigger the model on a timer.
- **Awaiters** — one-shot deferred reminders that continue a thread later.
- **Continuity** — user-declared facts injected into future prompts.
- **Long-term memory** — embedding-based semantic search over stored text entries.
- **Companion overlay** — a small desktop window showing the agent's current phase.
- **Affect analysis** — model-inferred emotional state from user messages, optionally gating tool approval.

## Privacy

Messages are sent to whichever third-party API provider you configure. Conversations are stored locally, but content leaves your machine on every API call unless you use a local Ollama model.

## Repository

- [AGENTS.md](AGENTS.md) — architecture map, workflow, commands, conventions
- [packages/backend/README.md](packages/backend/README.md) — chat-turn pipeline and runtime contracts
- [changelogs/](changelogs/) — release notes per version
- [postmortem/](postmortem/) — incident write-ups

## License

[AGPLv3](LICENSE)
