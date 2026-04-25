# iKi

A local desktop AI companion — a persistent agent that lives on your desktop, orchestrates multiple AI providers, understands context and affect, and adapts its interaction style based on your readiness.

## Quick Start

```bash
git clone https://github.com/irorange27/iKi.git
cd iKi
corepack enable
pnpm install --frozen-lockfile
pnpm run app:dev
```

Requires **Node.js 20.x** with Corepack enabled.

On first launch, follow the welcome flow: connect a provider (OpenAI, Anthropic, DeepSeek, Kimi, MiniMax, Ollama, or ACP), make sure it exposes at least one model, then send your first message.

To use an ACP-backed agent such as Codex CLI, add the `Codex CLI` provider in Settings → Providers, configure the command and authentication, fetch its models, and select it in chat like any other provider.

## Capabilities

### Multi-Provider Agent
Orchestrates OpenAI, Anthropic, DeepSeek, Kimi, MiniMax, Ollama, and ACP-backed agents (including Codex CLI) through a unified chat/tool loop — all running locally on your desktop.

### Affect-Aware Interaction
First-class affect signals shape reply strategy, tool routing, and autonomy guardrails with explicit UI transparency. The system knows when to clarify, when to co-plan, and when to execute — not just tone adjustment.

### Structured Context
Rolling thread summaries keep long conversations coherent. A typed continuity layer captures confirmed facts, preferences, and boundaries with evidence tracking. Model-aware context budgeting prevents overstuffing smaller models.

### Built-in Tool System
27 tools across file read/write/edit, shell commands, web search, personal skills, todo/planning checklists, proactive reminders, and sub-agent delegation — all with configurable approval gates and workspace boundaries.

### Desktop & Daemon Modes
Full desktop GUI with a chat window and a compact companion overlay that provides phase-aware visual feedback. A headless daemon mode exposes the same agent surface via HTTP/WebSocket for external clients (e.g., QQ bot bridging).

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
- `pnpm` installs are guarded by a reviewed build-script allowlist in `pnpm-workspace.yaml`
- Whisper models are stored under iKi's user-data directory, not in the app bundle

## Commit Governance

- Conventional Commits required. Interactive helper: `pnpm run commit`
- PR title must follow semantic format (CI enforced)
- CI quality gate runs ESLint + `tsc` + `vue-tsc --noEmit` + tests with coverage
- Coverage thresholds (vitest.config.mts): lines 60 / functions 59 / branches 46 / statements 59
- TypeScript strictness is tightened incrementally: `useUnknownInCatchVariables`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`

## Release Flow

- Release notes generated from Conventional Commit history via `scripts/scaffold-changelog.cjs`
- Tag-driven CI/CD: push `vX.Y.Z` triggers `release-build` on GitHub Actions
- macOS outputs: `.dmg` + `.zip` (signed for production auto-update via `update.electronjs.org`)
- Tag builds create a draft GitHub Release with auto-generated body and `SHA256SUMS.txt`
