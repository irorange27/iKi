# Postmortem: Long-Term Memory CRUD UI

## Summary
Long-term memory entries were visible in Settings but could not be created, edited, or deleted from
the UI. This left users unable to correct inaccurate memories or add durable facts manually.

## Impact
- Manual fixes required direct database access, which is error-prone and inaccessible for most users.
- Inaccurate memories could persist indefinitely, degrading retrieval quality over time.

## Root Cause
Memory management was implemented primarily for automated extraction and retrieval; the UI was
limited to read-only views without CRUD affordances or IPC wiring for mutations.

## Detection
A review of the Settings Memory Viewer showed that only list/search endpoints were exposed to the
renderer and no mutation actions existed in the UI.

## Resolution
- Added IPC hooks for updating and deleting long-term memory entries.
- Exposed new `update/delete` APIs to the renderer.
- Implemented a manual creation form and inline edit/delete controls in Settings.

## Preventive Actions
- Add a checklist item to new data features: provide user-facing CRUD or explicit rationale.
- Add lightweight UI smoke tests for Settings sections that list persistent data.

## Follow-ups
- Consider tags/emotion editing for advanced users.
- Evaluate whether daemon HTTP endpoints should support memory mutations for parity.
