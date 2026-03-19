# iKi

## Introduction

A local agent pet for AI provider orchestration.

## Features

- Orchestrates multiple AI providers.

- Acts as a local agent for streamlined AI interactions.

- Self-optimizing workflow (auto tool routing and auto-pinned skills).

## Getting Started

1. Clone the repository:

   ```bash
   git clone https://github.com/your-repo/iki.git
   ```

2. Navigate to the project directory:

   ```bash
   cd iki
   ```

3. Follow the setup instructions in the documentation.

## Development Notes

- DevTools no longer auto-open by default in development.
- To opt in to auto-open DevTools (for main/settings windows), run with
  `IKI_AUTO_OPEN_DEVTOOLS=true`.

## Commit Governance

- Interactive semantic commit: `npm run commit`
- Commit message lint (recent history): `npm run commit:check`
- Local hooks are managed by Husky and installed through `npm install` (`prepare`)
- PR title must follow semantic format (CI enforced)
- Architecture-impacting code changes must include docs/changelog updates (CI enforced)
- CI quality gate runs `npm run -s ci:quality` (`lint` + `tsc` + tests with coverage)
- Coverage thresholds are enforced in `vitest.config.mts` for regression prevention

## Release Flow

- `release-please` runs on pushes to `main`
- release PR and version/tag are generated from Conventional Commits
- `release-build` runs automatically on version file updates in `main`
  (`package.json` / `.release-please-manifest.json`) and on GitHub Release publish
- release-build first runs a lockfile preflight (`npm ci --ignore-scripts`) before matrix builds
- release-build outputs are uploaded to workflow artifacts per OS, then published once to release assets
- machine-generated release notes live in `CHANGELOG.md`
- curated product notes continue in `changelogs/`
- `release-please` uses `RELEASE_PLEASE_TOKEN` when present (recommended PAT)
- if `RELEASE_PLEASE_TOKEN` is omitted, it falls back to `GITHUB_TOKEN`; ensure
  Actions is allowed to create/approve pull requests in repo settings
