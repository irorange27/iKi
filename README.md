# iKi

An Electron desktop chat client for AI models. It assembles prompts, calls third-party APIs, executes tool calls locally, and stores conversations in SQLite. It is not itself an AI — the intelligence comes entirely from the external API providers you connect.

## Quick Start

```bash
git clone https://github.com/irorange27/iKi.git
cd iKi
corepack enable
pnpm install --frozen-lockfile
pnpm run app:dev
```

Requires **Node.js 20.x** with Corepack enabled.

On first launch, add a provider (OpenAI, Anthropic, DeepSeek, Kimi, MiniMax, Ollama, or ACP) with your API key, then start chatting.

## What It Actually Does

### Multi-provider chat
A unified chat UI that routes messages to whatever model you pick. Supports OpenAI, Anthropic, DeepSeek, Kimi, MiniMax, Ollama, and ACP-backed agents. Saves conversations to local SQLite.

### Tool calling
The model can request to: read/write/edit/delete files, run shell commands, search the web, manage todo lists, create personal skill instructions, and delegate to a sub-agent. Destructive operations require user approval. File and shell tools are scoped to a selected workspace directory.

### Experimental extras
- **Affect analysis**: runs a model call on user messages to infer emotional state, injects the result into the system prompt, and optionally gates tool approval behind valence/arousal thresholds. It's prompt engineering, not a theory of mind.
- **Proactive tasks**: cron-scheduled messages that trigger the model on a timer and report back.
- **Awaiters**: one-shot deferred reminders to continue a thread later.
- **Continuity**: stores user-declared facts to include in future prompts.
- **Long-term memory**: text entries with embedding-based semantic search.
- **Companion overlay**: a small window showing the agent's current phase (idle, thinking, executing, etc.).

### Daemon mode
A headless HTTP + WebSocket server that exposes the same chat/tool surface for external clients (e.g., QQ bot via NapCat bridge).

### Privacy note
Messages are sent to whichever third-party API provider you've configured. The app itself stores conversations locally, but the content leaves your machine on every API call unless you use a local Ollama model.

## Development

```bash
pnpm run app:dev          # Start desktop app in dev mode
pnpm run app:preview      # Launch latest packaged app from out/
pnpm run app:build        # Create distributable artifacts
pnpm run -s ci:quality    # Full quality gate (lint + tsc + vue-tsc + tests)

pnpm test                 # Run all tests
pnpm run test:renderer    # Renderer-only tests
pnpm run commit           # Interactive semantic commit
```

- DevTools auto-open: set `IKI_AUTO_OPEN_DEVTOOLS=true`
- Daemon binds to `127.0.0.1` by default
- Whisper models are stored under iKi's user-data directory, not in the app bundle

## Commit Governance

- Conventional Commits required. Interactive helper: `pnpm run commit`
- PR title must follow semantic format (CI enforced)
- CI quality gate runs ESLint + `tsc` + `vue-tsc --noEmit` + tests with coverage
- Coverage thresholds (vitest.config.mts): lines 60 / functions 59 / branches 46 / statements 59

## Release Flow

- Release notes generated from Conventional Commit history
- Tag-driven CI/CD: push `vX.Y.Z` triggers `release-build` on GitHub Actions
- macOS outputs: `.dmg` + `.zip` (signed for auto-update via `update.electronjs.org`)
