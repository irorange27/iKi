# Harness changes: implementation and review guide

Use this with the [ownership map](README.md#runtime-contracts), not as another architecture specification.
Current behavior and limitations stay in the ownership map; incident evidence belongs in the postmortem.

## Work from an invariant to evidence

1. Write one observable invariant and its scope before editing. Example: “a second tool call in this turn still writes to workspace A after the selected workspace changes to B.” Specify turn/run/process boundaries; do not use “safe” or “isolated” without a scope.
2. Trace the real entry point to the consumer. Include SDK adapters, context copies, durable recovery and cleanup. Identify who creates the state, who owns it, and when ownership ends. Read installed SDK source when its semantics matter.
3. Reproduce the failure through that path. Mock the external provider, not the internal wiring being tested. Assert provider requests, actual file content, tool execution count or persisted decisions. Demonstrate that the regression fails for the intended reason before fixing it.
4. Extend the existing owner. Prefer deleting competing behavior to adding a parallel manager. Check fresh turn, continuation, approval resume, delegation, non-streaming send and cancellation callers when a shared contract changes.
5. Verify the new behavior and the behavior it could break. Run the focused regression, then the repository completion gates. Cross-layer changes require the existing app smoke test. Do not treat a passing helper test as proof of integration.
6. Hand off: invariant, changed owner, failing/passing evidence, remaining limits, and exact uncommitted files. Preserve other agents' work. Do not report a feature complete merely because its files or tests exist.

## Acceptance cases

| Area | Required evidence | Common false proof |
|---|---|---|
| Workspace snapshot | Use the actual SDK tool adapter for two calls, switch the thread workspace between them, inspect both roots. Check a later turn sees the new root and delegation inherits the intended snapshot. Define what happens across approval recovery/restart. | Two direct handlers share one mutable context, while the adapter creates a fresh copy for each call. |
| Thread admission | Separate OS processes contend on the same temporary SQLite database. Exactly one enters execution; another thread can proceed. Test crash/reclaim, stale release, renewal failure and paused holder resumption. | Two calls on one connection, or a mock lease returning null. |
| Lease loss | Propagate loss to stream, send, approval resume and tools. Assert an old owner cannot initiate another protected effect after losing authority. | Logging heartbeat failure, aborting only the UI, or claiming a heartbeat interval is a hard bound despite event-loop stalls. |
| File mutation | Concurrent writes to the same target under a fixed clock use distinct exclusively created temp files. Test edits and undo under contention, cleanup on write/rename failure, cancellation before commit, permissions and symlink behavior. | One successful write leaves no temp file. Rename is atomic, but does not prevent lost updates or preserve existing file metadata automatically. |
| Approval recovery | Remove the run-history snapshot and recover from persisted UI history with real SDK execution. Approve/reject exactly once; preserve the requested approval ID. Include unrelated older interrupted calls in the history. | A mocked harness returns success, or only the preferred run-history branch is tested. |
| Cleanup ownership | Suspend A, start B, then finish A. B remains steerable/stoppable and keeps its approvals. Check the same sender switching threads too. | The active-stream map is intact, but a shared queue or sender-wide cleanup erases B's state. |

## Design rules behind those cases

- **Data lifetime is part of its type contract.** Create a shared snapshot before copying contexts; assigning a new property to one copied object does not update its siblings. A turn snapshot, a thread setting and a persisted recovery snapshot have different lifetimes.
- **Ownership must survive delayed completion.** Release and cleanup compare the acquisition's identity/token, not only thread ID, sender ID or path. Keep one owner for admission and one owner for policy.
- **Cancellation is cooperative; authority is separate.** TTL expiry does not stop the previous holder. Abort on loss, and use fencing/ownership checks at protected effects where strict exclusion is required. Checks plus an external effect are not automatically atomic. For shell/remote effects without fencing, explicitly retain the weaker guarantee rather than promise exactly-once execution.
- **File replacement, serialization and conflict detection solve different problems.** Atomic replacement prevents torn content. A local queue coordinates only participating callers and its key must account for aliases. Preventing lost updates across processes needs a shared coordination/version contract. Include delete in the mutation policy; do not silently change symlink or executable-bit semantics.
- **Recovery must distinguish unknown outcomes from pending authorization.** Never infer that an unrecorded effect did not occur. Preserve live approval requests; repair unrelated abandoned calls without discarding their evidence. Never blindly retry arbitrary side effects.
- **Tests control interleavings, not luck.** Use barriers/IPC acknowledgements, fixed clocks and injected failures; avoid sleeps as synchronization. Each test should fail if the boundary it claims to protect is bypassed.

Compare the current code against this checklist before editing. The prior review's findings are
regression scenarios to reproduce, not a verdict on code written after them.
