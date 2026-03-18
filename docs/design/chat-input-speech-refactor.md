# Chat Input Speech Refactor

## Context
The chat input component mixed UI concerns (input, toolbar), transport logic, and
speech capture/transcription details in a single file. This increased cognitive
load, made the component hard to reason about, and increased the risk of subtle
regressions when touching unrelated features.

## Decision
Extract speech capture, waveform rendering, and transcription into a dedicated
composable (`useSpeechInput`). The chat input now consumes a small, stable API
surface from the composable.

## Rationale
- Isolates audio lifecycle and cleanup into one place.
- Keeps UI component focused on rendering and event wiring.
- Makes future speech improvements testable in isolation.

## Alternatives Considered
- Leave the logic inline: rejected due to ongoing complexity growth.
- Create a standalone speech service module: rejected for now because it would
  require a broader refactor of IPC boundaries.

## Consequences
Positive:
- Reduced component size and responsibility.
- Clearer cleanup semantics for audio resources.

Negative:
- Slightly more indirection when tracing speech behavior.

## Follow-ups
- Add unit tests for `useSpeechInput` with mocked `MediaRecorder`.
- Extract provider selection into its own composable to further slim the component.
