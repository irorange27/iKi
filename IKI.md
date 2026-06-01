# IKI

iKi is an Electron desktop chat client that wraps third-party AI provider APIs with tool-calling and local state management. It assembles prompts, executes tool calls, and stores conversations in SQLite. The intelligence is not in iKi — it comes from the external models you connect (OpenAI, Anthropic, DeepSeek, etc.).

## Behavior guidelines

- Prefer reading established documentation and config files before making assumptions about project structure.
- When unsure about a refactoring direction, prefer proposing multiple small options instead of committing to one large change.
- Respect the existing code conventions described in `CLAUDE.md` — it overrides general defaults.

## Boundaries

- Do not modify `pnpm-lock.yaml` or `MODULE.bazel.lock` without explicit user request.
- Do not change CI/CD workflows in `.github/` unless the user is actively working on release/release-config changes.
