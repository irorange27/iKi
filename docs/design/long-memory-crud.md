# Long-Term Memory CRUD (UI)

## Context
Long-term memory entries exist in SQLite (`memory_long`) and can be listed or searched in the
Settings Memory Viewer, but the UI does not allow creating, editing, or deleting entries. Manual
correction of inaccurate memories requires direct database access.

## Goals
- Provide UI-level create, read, update, and delete for long-term memory entries.
- Keep edits local-only and scoped to the selected thread.
- Preserve existing retrieval behavior and embedding regeneration when summaries change.

## Non-Goals
- Changing the retrieval algorithm, embeddings, or auto-summarization behavior.
- Building a full audit log or version history for memory edits.
- Bulk actions (mass delete/export) in this iteration.

## Execution Plan
1. Data layer:
   - Add delete support for `memory_long`.
   - Ensure summary edits recompute embeddings (already supported).
2. IPC & preload:
   - Expose `memory:long:update` and `memory:long:delete` in IPC.
   - Add `update/delete` APIs in preload for renderer access.
3. UI:
   - Add a "New Long Memory" form tied to the selected thread.
   - Add inline edit and delete actions in the long-memory list.
   - Refresh lists and search results after mutations.
4. Documentation:
   - Update changelog.
   - Add postmortem after implementation.

## UX Decisions
- Creation requires explicit thread selection; when viewing "All threads" the form forces a thread pick.
- Edits are scoped to the summary text only for now; tags/emotion remain read-only.
- Delete prompts require explicit confirmation.

## Risks & Mitigations
- Risk: Memory edits might silently fail when memory is disabled.
  - Mitigation: UI writes are forced server-side for manual actions.
- Risk: UI could show stale results after edits.
  - Mitigation: refresh long-memory list and rerun search after mutations.

## Validation
- Manual smoke check in Settings → Memory:
  - Create a long memory entry for a thread.
  - Edit the summary and confirm it updates and re-renders.
  - Delete the entry and confirm it disappears from list and search.
