# Postmortem: Chat Input Speech Refactor

## Summary
The chat input component had grown to nearly 1,000 lines with speech capture,
audio visualization, and transcription logic embedded in the UI layer. This
change isolates that functionality into a composable to reduce complexity and
support incremental refactoring.

## Impact
- Developer velocity slowed when modifying chat input behavior due to large
  surface area and intertwined responsibilities.
- Higher risk of regressions from unrelated UI edits.

## Root Cause
Speech features were implemented directly inside the component without a clear
modular boundary, and no guardrails existed to cap component size or enforce
separation of concerns.

## Detection
Manual code review identified the component as a hotspot for complexity and
maintenance risk.

## Resolution
- Extracted speech capture, waveform, and transcription into `useSpeechInput`.
- Introduced a shared UI message conversion helper to reduce duplicated logic.

## Preventive Actions
- Enforce a component size guideline (target < 300 lines).
- Add a lint rule or review checklist item for composable extraction when
  components grow beyond a single responsibility.
- Add tests for speech composable behavior with mocked media APIs.

## Follow-ups
- Continue splitting `SettingsView.vue` into smaller components and composables.
