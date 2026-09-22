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
