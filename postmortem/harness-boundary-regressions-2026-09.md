# Harness boundary regressions — 2026-09-21

## Impact

Coding-agent instructions passed to Harness were silently replaced by the runner default.
Autonomous sessions could continue after a final answer, fail to chain handoffs, or lose
completed observations during steering. A second approval after resumption lacked durable
registration and full history; resumed tool policy could differ from the original turn.
No production incident frequency or user data loss was measured.

## Root causes

- Runner constructor accepted config but only retained modelFactory; Harness supplied its
  system prompt there rather than in the actual run request.
- A generic finished flag preceded the handoff branch; the inner SDK loop lacked a handoff
  stopping condition. Model finishReason was discarded between runner and session.
- History synchronization happened only after successful generator completion. SDK abort
  may close the stream rather than throw; replay retained the old user prompt.
- Approval continuation duplicated orchestration and only emitted the next approval to UI,
  omitting durable batch registration. Recovery configuration omitted approval policy.
- Tests checked emitted text and single approval success, not actual provider inputs,
  negative inference counts, interrupted observations, or two approval cycles.

## Repair and prevention

Pass instructions at the request boundary; carry finishReason; stop handoff within SDK;
respect outer batch limits; snapshot completed SDK steps and synchronize history in finally;
normalize aborts; append steering input exactly once. Persist approval policy/guard requirement
in run metadata and register each subsequent approval with its final model history. Unknown
legacy approval guard state requires approval for new ordinary calls.

Added real-SDK scripted-provider regressions for prompt content, stop/handoff, batch cap,
steering, Anthropic per-step breakpoints, approve/reject and a second approval/resume. The
prompt assertion failed before repair. Full quality gate passed: 194 files, 1139 tests.

## Remaining scope

This does not establish crash-safe exactly-once tools, shell process cancellation, approval
timeout completion, native PTC, lossless trajectories, live-provider interoperability or
long-context preservation. Detailed code evidence and follow-up priorities are in
`docs/reports/coding-harness-audit-2026-09-21.md`. Changelogs remain generated from commits;
no commit or manual changelog update was made.

## Follow-up: preventing repeated cross-agent regressions

Repeated repairs were treating constructor arguments, emitted UI text and architecture prose as proof
of runtime behavior. The ownership map now lives in tracked `packages/backend/README.md`, linked from
AGENTS.md, with a fast `test:harness` command and boundary-level regression locations. Runner dependency
construction no longer accepts runtime config, making the original silent-drop pattern a type error.

Removed the independent count/history clippers and DB-count summary path; one SDK-step budget owner
preserves instructions and tool exchanges, summarizes complete omitted content and retains raw history.
Removed heuristic shell safety inference and timeout replay. Reused the approval decision entry for
expiry; fixed policy parsing/precedence and propagated abort through tools. Completed inferences are
recorded once as source data; ATIF no longer duplicates their tool audit projections.

These are behavioral changes, not additional parallel abstractions. Obsolete tests that asserted lossy
clipping or heuristic shell approval were replaced with preservation, cancellation, policy, timeout and
inference/export regressions. The tracked contract states unresolved capabilities explicitly.

Follow-up verification: `pnpm run test:harness` passed 154 tests across 26 files;
`pnpm run ci:quality` exited 0 with 195 files / 1081 tests, type checks and dependency rules passing.
Coverage: statements 65.67%, branches 52.62%, functions 61.42%, lines 68.10%.
The updated Electron app booted, renderer connected, and embedded daemon listened on port 6127.
Remote model-catalog discovery timed out during boot; no paid-provider or live cache-hit verification
was performed. Unrelated frontend edits and the lockfile were preserved. No commit was created.


## Follow-up: tool execution and authority boundaries

Code inspection found four authority leaks: dangling file symlinks could create outside targets;
subagents fell back to the global registry when parent tools were empty; daemon single-tool MCP
grants expanded to siblings; and learned substring rules could be satisfied by unrelated description
text. MCP always-approval metadata was also dropped on registration, undo was marked approval-free,
and remote tools retried potentially completed side effects after transient failures.

Path resolution now rejects dangling symlinks at any ancestor, including missing intermediate paths.
The ancestor walk also now actually traverses more than one level, restoring ordinary nested writes.
Subagents use only parent capabilities and propagate cancellation. Daemon tool filtering distinguishes
individual from server grants. Nonempty learned rules compare complete JSON arguments; legacy
substring rules fail closed. Explicit blanket grants remain explicit blanket grants.

MCP registrations retain always-approval and have no implicit execution retries. MCP requests forward
the runtime abort signal; cancelled semaphore waiters leave the queue without dispatch or capacity
leaks. Builtin entry points and file mutation checkpoints check cancellation; undo bookkeeping changes
only after successful writes. Regression locations and remaining sandbox limitations are in the
tracked backend README; the fast harness gate includes file/delegation/MCP/daemon boundary tests.

No OS sandbox or remote rollback guarantee was added. Concurrent path replacement and hard links
still require stronger filesystem isolation; arbitrary approved shell and remote MCP execution have
host/server authority. Native PTC remains unimplemented. This audit did not exercise live MCP servers.

Verification: `pnpm run ci:quality` passed (195 files / 1095 tests, type checks, lint and architecture gate);
`pnpm run test:harness` passed (41 files / 255 tests). No live provider or remote MCP execution was used.


## Follow-up: concurrent turns and session isolation

Old stream finalizers could erase a newer sender's steering queue and thread membership, and
sender-wide approval cleanup could discard another thread's pending batch. Stream preparation could
resume after supersession and begin work. Non-streaming send had no shared exclusion with streams;
concurrent cold approval recovery could build independent sessions from the same durable decision.

The coordinator now owns an admission lease used by stream, send and approval recovery before any
asynchronous preparation. Duplicates return busy; independent threads remain parallel. Approval busy
responses do not consume decisions; expiry retries admission if another turn currently owns the thread.
Cleanup checks stream identity and approval session ID. Supersession detaches old thread membership;
cancelled preparation cannot start model/tool execution. Interleaved real-SDK tests verify runtime
thread/run separation; harness now explicitly binds the current capability set for delegated tools.

Global path-only undo history and a 30-second read cache also crossed session boundaries. Undo is
thread/path scoped, refuses changed content and updates its stack only after successful writes;
file tools now read current filesystem content. Tests exercise two working directories concurrently,
shared-file undo rejection, duplicate send/stream admission and duplicate cold approval recovery.

These are in-process guarantees for one chat-service instance. Cross-process durable leases, atomic
shared-file editing, frozen workspace selection across an entire run and companion display isolation
remain separate work; do not advertise them as solved by AsyncLocalStorage or admission locks.

Verification: `pnpm run ci:quality` exited 0 (195 files / 1104 tests; lint, both type checks,
architecture and coverage gates passed). The focused harness run passed 264 tests across 41 files.
No frontend behavior was changed or live-provider parallel-load test performed in this follow-up.
