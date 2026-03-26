# iKi

## Introduction

A local agent pet for AI provider orchestration.

## Features

- Orchestrates multiple AI providers.
- Ships first-class built-in provider entries for OpenAI, Anthropic, DeepSeek, Moonshot AI
  (Kimi), and Ollama, while still allowing custom OpenAI-compatible and Anthropic-compatible
  endpoints.

- Acts as a local agent for streamlined AI interactions.

- Self-optimizing workflow (auto tool routing and auto-pinned skills).

- Structured context assembly with rolling thread summaries, bounded memory / skill context, and
  visible context reports per assistant turn.

- Model-aware context budgeting that can use `models.dev` metadata (model list + context window)
  to avoid overstuffing smaller models while keeping larger-model defaults stable.

- First-class affect signals that can shape reply strategy, skill/tool routing, and tool-autonomy
  guardrails with explicit UI transparency.

- Persistent ToDoList tools so iKi can create, read, and maintain local structured checklists
  instead of scattering todos across chat text or ad hoc files.

- A user-editable local `brain/` markdown folder under the app user-data directory
  (`iki.md`, `owner.md`, `relationship.md`) so iKi continuity and owner identity can start from
  simple files instead of requiring a heavier memory schema first.

## Getting Started

1. Install Node.js 20.x and npm 10.x.

2. Clone the repository:

   ```bash
   git clone https://github.com/irorange27/iKi.git
   ```

3. Navigate to the project directory:

   ```bash
   cd iKi
   ```

4. Install dependencies:

   ```bash
   npm ci
   ```

5. Start the desktop app in development mode:

   ```bash
   npm run app:dev
   ```

6. Open `Settings`, configure at least one provider API key and model (for example OpenAI,
   Anthropic, or DeepSeek), then send
   your first chat message.

## Useful Commands

- `npm run app:dev`: start the desktop app through Electron Forge's Vite flow.
- `npm run app:preview`: launch the latest local packaged app from `out/` for manual eyeballing.
- `npm run app:build`: create distributable artifacts via Electron Forge makers.
- `npm run -s ci:quality`: run the repository quality gate locally.

Packaging may download platform-specific Electron artifacts the first time it
runs, so `app:build` and `npm run package` expect normal network access. `app:preview` expects an
existing packaged output under `out/`.

## Development Notes

- DevTools no longer auto-open by default in development.
- To opt in to auto-open DevTools (for main/settings windows), run with
  `IKI_AUTO_OPEN_DEVTOOLS=true`.
- The desktop-managed daemon binds to `127.0.0.1` by default. Only switch to
  `0.0.0.0` when you intentionally need LAN or Docker access.
- The daemon bootstrap registration token (`daemon.token`) is rotated after each
  successful client registration; treat it as a one-time local setup credential.
- Downloaded `whisper-node` models are stored under iKi's user-data directory,
  not inside the packaged app bundle.

## Commit Governance

- Interactive semantic commit: `npm run commit`
- Commit message lint (recent history): `npm run commit:check`
- Local hooks are managed by Husky and installed through `npm install` (`prepare`)
- PR title must follow semantic format (CI enforced)
- Architecture-impacting code changes should include docs/changelog updates when the repository
  keeps those artifacts in version control
- CI quality gate runs `npm run -s ci:quality` (`eslint --ext .ts,.tsx,.vue .` + `tsc` +
  `vue-tsc --noEmit` + tests with coverage)
- Coverage thresholds are enforced in `vitest.config.mts` as a baseline regression floor; the
  current repository-wide floor is `lines 62 / functions 59 / branches 46 / statements 59`, and it
  should continue to ratchet upward over time
- TypeScript discipline is tightened incrementally rather than via a one-shot `strict` flip:
  the repository now enforces `allowJs: false`, `useUnknownInCatchVariables`,
  `noImplicitOverride`, `noFallthroughCasesInSwitch`, and
  `forceConsistentCasingInFileNames`
- Coverage now counts Vue single-file components (`src/**/*.vue`) in addition to `ts/tsx`, so
  renderer interaction logic is part of the same regression floor as the rest of the codebase
- Renderer component tests now run in Vitest with Vue SFC transform and `happy-dom`
- Quick renderer-only regression pass: `npm run -s test:renderer`

## Release Flow

- Conventional Commits remain required for history hygiene, but release intent is manual
- Curated product notes live in `changelogs/`; there is no `release-please` or machine-generated
  root `CHANGELOG.md` flow
- Local release verification path: run `npm run app:build` before a version cut; `app:preview`
  remains available for a manual visual pass
- CI/CD release builds are tag-driven: push `vX.Y.Z` after `package.json` and
  `changelogs/vX.Y.Z.md` are in sync
- `release-build` first runs the full repository gate (`npm run -s ci:quality`) on Ubuntu before
  any matrix packaging starts
- `release-build` then runs `npm run -s app:build` on macOS, Windows, and Linux, uploading maker
  outputs as workflow artifacts per OS
- Tag builds automatically create or update a draft GitHub Release whose body comes from the
  curated `changelogs/vX.Y.Z.md` file and whose assets include a `SHA256SUMS.txt` manifest
- Packaged macOS and Windows builds now use Electron's native `autoUpdater` via
  `update.electronjs.org`, so the desktop client only sees releases after the GitHub draft release
  has been explicitly published; draft assets remain invisible to auto-update checks
- macOS production auto-update still depends on shipping signed builds; unsigned local previews can
  exercise the UI wiring but are not a substitute for a signed release verification pass
- `workflow_dispatch` remains available for CI build-only verification of any branch, tag, or SHA
  without publishing a release
