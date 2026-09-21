# @iki/backend

Pure Node/TypeScript business logic shared by Electron and the daemon. No Electron or Vue imports.
Dependencies point from shells to backend; the architecture gate checks backend layer direction too.

## Entry points

`thread_session/session_loop.ts` prepares and streams a turn; `message_send.ts` handles non-streaming sends.
Both create `AgentHarness` through `agent/harness/assembly.ts`. The harness resolves tools and invokes
`SimpleAgentRunner`, which uses the installed AI SDK's `streamText` loop. `outer_loop.ts` handles bounded
continuations, steering and handoff. `turn_prep/approval.ts` persists approval decisions and rebuilds a
harness to replay an answered batch. `thread_stream_coordinator.ts` owns active streams and steering queues.

## Runtime contracts

This table records implemented ownership, not equivalence to another framework. Update it with the
relevant regression when changing behavior. Tests use the real SDK with scripted providers where possible;
that does not establish live-provider compatibility or crash-safe exactly-once tools.

| Responsibility | One owner | Contract | Regression |
|---|---|---|---|
| Turn configuration | `agent/harness/assembly.ts` → `agent_harness.ts` → runner request | Runner construction accepts dependencies only. Instructions and budgets belong in the run request; invalid numeric budgets are omitted. | `tests/backend/agent/harness/agent_harness.test.ts` |
| Context projection | `agent/runners/simple_agent_runner.ts: prepareStep`, pure planner in `agent/context_budget.ts` | Check every SDK inference. Preserve system instructions, latest user input and complete tool exchanges. Summarize the exact omitted content before replacement. If summary/budget fails, fail explicitly and retain original history. Never add count-based or per-message truncation upstream. | `tests/backend/agent/harness/context_compaction.test.ts`, `tests/backend/thread_session/auto_compact.test.ts` |
| Context assembly | `turn_prep/context.ts`, `context_blocks.ts` | Assemble identity, workspace, skills and optional memory; do not discard conversation history. Workspace-root AGENTS.md takes precedence over legacy IKI.md. Project instructions are never clipped to the persona budget. | `tests/main/services/chat/chat_context.test.ts`, `tests/backend/agent/ai_sdk_runtime.test.ts` |
| Summary generation | `runtimes/thread_summary.ts` | Feed the complete omitted transcript and previous summary to the configured tool model. Never claim coverage for text excluded by a character cap. Forward cancellation. | `tests/backend/context/thread_summary.test.ts` |
| Concurrent turns | `thread_session/thread_stream_coordinator.ts` | One active turn per thread per chat-service instance, acquired before asynchronous preparation. Stream, send and approval recovery share the same lease; duplicates return busy without consuming approvals. Different threads can run concurrently. Sender supersession cancels old preparation; stale cleanup cannot remove a newer registration. | `tests/backend/thread_session/thread_stream_coordinator.test.ts`, `chat_streaming.integration.test.ts`, `tests/main/services/chat/chat_approval.test.ts` |
| Runtime/tool state | `agent/harness/agent_harness.ts`, `utils/runtime_context.ts`, `tools/file_tools.ts` | Bind actual tools, thread and run context across asynchronous generator execution. Undo belongs to thread + path, checks last written content, and never uses another thread's undo history. File reads have no process-global content cache. | streaming integration + `tests/backend/tools/file_tools.test.ts` |
| Stop / handoff / steer | SDK stop conditions + `thread_session/outer_loop.ts` | Natural model stop ends a turn. Only exhausted tool steps may continue within the requested batch bound. Handoff stops the inner loop before chaining. Steering appends feedback once and preserves completed observations. | `tests/backend/thread_session/chat_streaming.integration.test.ts` |
| Approval policy | `agent/harness/tool_resolver.ts`, `utils/action_risk.ts` | Explicit per-turn policy wins over legacy global flags. askRisky permits known reads; trustWorkspace additionally permits scoped writes. Arbitrary shell/unknown tools require a decision unless explicitly allowed. Stored nonempty allow rules match complete JSON arguments, never substrings; legacy substring rules require reapproval. Do not infer shell safety from command text. | `tests/backend/agent/harness/approval_policy.test.ts`, `tests/backend/workspaces/thread_mode.test.ts` |
| Approval recovery | `turn_prep/approval.ts` | User and timeout decisions use the same entry. Persist every batch with final history and policy; a second approval must resume correctly. Missing legacy policy requires new approvals. Planning/handoff exemptions live in tool_resolver. | `tests/backend/thread_session/chat_approval_resume.integration.test.ts`, `tests/main/services/chat/chat_approval.test.ts` |
| Tool execution / cancellation | `provider/ai_sdk_runtime.ts` → `utils/runtime_context.ts` → tool handler | Forward SDK abort signal through runtime context. Shell terminates its process group on supported POSIX hosts; no automatic replay after timeout. Other tool implementations must cooperate with the signal. | `tests/backend/tools/shell_tools.test.ts`, harness integration tests |
| Filesystem boundary | `tools/workspace_paths.ts` | File tools allow the selected workspace plus app brain. Resolve existing symlinks; reject dangling symlinks at every ancestor. Missing nested directories inside a root remain writable. Mutating file tools check cancellation before filesystem writes; undo requires write approval. | `tests/backend/tools/file_tools.test.ts` |
| Delegation boundary | `tools/agent_tools.ts` | Child tools are a subset of the parent's approval-free capabilities. Missing/empty parent tools never fall back to the registry. Forward parent cancellation to the child harness. | `tests/backend/tools/agent_tools.test.ts` |
| MCP execution | `mcp/manager.ts` | Retain explicit always-approval through legacy resolution. No automatic retry of arbitrary remote calls. Forward cancellation to SDK requests and remove cancelled queued requests. | `tests/backend/mcp/manager.test.ts` |
| Daemon authorization | `packages/daemon/src/tool_access.ts` | A single MCP tool grant never permits sibling tools. Server activation filters do not confer tool authorization; only explicit server/wildcard grants do. | `tests/daemon/tool_access.test.ts` |
| Failure / retry | `agent/runners/simple_agent_runner.ts` | A stream error is not a successful partial answer. Never restart an attempt after visible text or a tool call; side effects may already have occurred. Dispose model resources on generator exit. | `tests/backend/agent/simple_agent_runner.test.ts` |
| Raw inference record | `turn_prep/run_tracker.ts: recordModelStep`, invoked by harness | Record each completed SDK inference with input projection, content and usage. Keep raw working history separate from the smaller provider projection. UI tool events remain execution audit events. | harness/session integration tests |
| ATIF projection | `thread_session/atif_export.ts` | Prefer inference records over duplicated tool audit entries. Pair calls/results/errors, emit textual observations and agent version. Legacy audit records have a fallback projection. | `tests/backend/thread_session/atif_export.test.ts` |

## Fast verification

From repository root:

```sh
pnpm run test:harness
pnpm run ci:quality
```

For a single behavior, run the test path in the table with `pnpm vitest run <path>`.
A lower test count after deleting obsolete behavior tests is not evidence of less coverage or more quality;
retain the observable invariants and pass the actual coverage gate.

## Limits that must not be advertised as solved

- Budgeting estimates tokens; provider-specific image accounting differs. Unknown input budgets disable automatic projection. A single oversized protected instruction or tool exchange stops explicitly.
- Summarization needs a configured tool model, is lossy, and may fail. No silent deletion fallback. Compaction costs are separate from main-model usage.
- Per-call records cover completed inferences; interrupted provider output and subagent trajectories are not yet a complete externally replayable rollout. Working history alone is not an exactly-once execution log.
- Approval continuation has its own resumed stream lifecycle; it is not currently a steerable outer autonomous session. Consumed decisions plus external side effects are not one atomic transaction.
- Admission locks are in memory and scoped to one chat-service instance, not distributed across desktop/daemon processes. Threads sharing a workspace still share files; edits are not atomic cross-process transactions. Workspace selection is resolved from thread state at tool invocation, so changing it during a run is not frozen by these isolation guarantees. Companion previews remain a shared presentation surface.
- Workspace path validation is not an OS sandbox: it does not close concurrent symlink-replacement races or hard-link aliases. Approved shell commands and remote MCP servers can access beyond the workspace. Cancellation cannot roll back filesystem operations already submitted or guarantee remote servers stop; detached shell descendants may outlive their process group.
- Native programmatic tool calling (code orchestrating the registry with filtered intermediate results) is not implemented. Shell, MCP and external ACP capabilities do not establish native PTC.

## Other modules

`provider/llm/factory.ts` wires providers; `tools/index.ts` registers builtin tools; `mcp/manager.ts` registers
MCP tools; `db/` owns SQLite; `runtimes/` owns auxiliary generation; `observability/` owns tracing;
`memory/`, `affect/`, `awaiters/`, `tasks/`, and `workspaces/` own their named subsystems.
Semantic memory retrieval remains disabled on the ordinary chat path (`includeMemory: false`).
Subagents use a separate scratchpad and child run; they do not inherit the full parent transcript.

See [AGENTS.md](../../AGENTS.md) for repository workflow. Historical rationale may live under ignored
`docs/`; executable behavior and this tracked ownership map take precedence over architectural analogies.
