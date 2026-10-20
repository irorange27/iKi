# Conversation persistence click-through regressions

## Scope and impact

PR #66 (`f53323b`) moved turn persistence into the backend. Its outstanding
click-through was exercised on the descendant execution-plan branch and then
`dev` (`7c776b5`), using an isolated Electron profile and a local scripted
OpenAI-compatible provider. Two failures were reproduced; no production
incident frequency was measured.

1. A first long-running shell tool rendered in the live app, but its assistant
   row did not exist before completion. Killing Electron lost the tool card;
   startup could mark the run failed but could not repair a missing part.
2. Approval resume synthesized `tool` with `{}` before a result-only event,
   overwriting the stored call's name and arguments. The live SDK reconnect
   also began with an empty message, discarding earlier parts when only the
   continuation was sent. Seeding persistence alone did not fix live replay.

## Cause and repair

The progress hook ran only on execution end. It now observes execution start
as well, retaining the entry's existing debounce and final-write ordering.

The emitter knew only call IDs from the new segment; persistence separately
loaded pre-pause parts for every reduction. Approval resume now captures one
durable prefix and replays it through the same emitter before new events. The
client and persistence reduce identical chunks with the SDK; replay preserves
the original tool input and prevents anonymous reseeding. Repeated progress
reductions start from an empty message and the complete log, avoiding repeated
appends from an evolving database seed.

## Prevention and evidence

Before repair, the real-SDK streaming test failed with zero progress writes
while a barrier held tool execution open. Approval integration assertions
failed with `tool` in place of the actual name. A wire-consumer test failed
because its empty SDK consumer lost the prefix. All now pass. Repeated approval
was clicked in Electron, and SQLite retained one assistant ID, original inputs,
both file results, and final text. The backend ownership map and operative
design note were updated. Exact checklist evidence and remaining limits are
in `docs/reports/pr66-persistence-clickthrough-2026-10-02.md`.

Generated changelogs were not edited; no commit or push was requested.
