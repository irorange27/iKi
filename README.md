# iKi

A local-first Electron desktop chat client for AI models — assemble prompts, run tool calls, and manage conversations, all from your Mac. iKi is a desktop companion that routes messages to third-party LLM providers, executes file operations and shell commands locally, and stores everything in SQLite. It is **not itself an AI** — the intelligence comes entirely from the external APIs you connect.

<p align="center">
  <sub>📸 Add a screenshot at assets/screenshot.png</sub>
</p>

## Download

[**Latest Release →**](https://github.com/irorange27/iKi/releases/latest)

Download the `.dmg` from the latest release, open it, and drag iKi to Applications.

**Requirements:** macOS 14+ (arm64).

## Quick Start (development)

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
| Data | better-sqlite3 |
| AI SDK | Vercel AI SDK (`ai`), `@ai-sdk/*` |
| Testing | Vitest, happy-dom, vue-tsc |
| CI | GitHub Actions |

## Features

### Multi-provider chat
A unified chat interface that routes messages to OpenAI, Anthropic, DeepSeek, Kimi, MiniMax, Ollama, and ACP-backed agents. All conversations are saved locally in SQLite.

### Tool calling
The model can read, write, edit, and delete files; run shell commands; search the web; manage todo lists; create personal skill instructions; and delegate work to sub-agents. Destructive operations require user approval. File and shell tools are scoped to a selected workspace directory.

### Daemon mode
A headless HTTP + WebSocket server exposes the same chat and tool surface to external clients — for example, a QQ bot via the built-in NapCat reverse bridge.

### Extras
- **Proactive tasks**: cron-scheduled prompts that trigger the model on a timer.
- **Awaiters**: one-shot deferred reminders to continue a thread later.
- **Continuity**: user-declared facts injected into future prompts.
- **Long-term memory**: embedding-based semantic search over stored text entries.
- **Companion overlay**: a small desktop window showing the agent's current phase.
- **Affect analysis**: model-inferred emotional state from user messages, optionally gating tool approval.

### Privacy
Messages are sent to whichever third-party API provider you configure. The app stores conversations locally, but content leaves your machine on every API call — unless you use a local Ollama model.

## Development

```bash
pnpm run app:dev          # Start desktop app in dev mode
pnpm run app:preview      # Launch latest packaged app from out/
pnpm run app:build        # Create distributable artifacts
pnpm run -s ci:quality    # Full quality gate: lint + tsc + vue-tsc + tests

pnpm test                 # Run all tests
pnpm run test:renderer    # Renderer-only tests
pnpm run commit           # Interactive semantic commit

python3 scripts/generate-icon.py  # Regenerate app icon (requires Pillow)
```

- DevTools auto-open: set `IKI_AUTO_OPEN_DEVTOOLS=true`
- Daemon binds to `127.0.0.1` by default

## Commit Governance

Conventional Commits required. Release notes are generated automatically from commit history between tags. CI enforces lint, type-check, and test coverage gates on every PR and tag push.

## License

[AGPLv3](LICENSE)
