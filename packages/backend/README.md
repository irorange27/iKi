# @iki/backend

All non-UI business logic. Pure Node/TS. **No Electron, no Vue, no DOM.**

Both `packages/desktop` and `packages/daemon` import this package — keep it shell-agnostic.

## Major directories

| Path | What it owns |
|---|---|
| `agent/` | `AgentHarness` + `SimpleAgentRunner` (the chat-turn engine) |
| `agent_session/` | turn preparation (`turn_preparer.ts` → context assembly: skills, budget, affect/identity, thread summary; semantic memory is excluded on the chat path), persistence, approval + approval recovery, run tracking (`agent_runs`/`agent_run_steps`/`agent_run_checkpoints`), tool guard |
| `chat_service/` | the public service surface used by IPC and daemon: `streaming.ts` (supersede/rate-limit, outer autonomous loop, ui-chunk emission), `chat_send.ts`, plus per-concern submodules (memory, usage, runs, models, skills, ui_stream) |
| `tools/` | built-in tool implementations + Zod schemas; `index.ts` registers `defaultToolRegistry` |
| `provider/llm/` | provider-specific model factories (`factory.ts` is the entry) |
| `db/` | better-sqlite3 connection + migrations + per-table modules |
| `mcp/` | MCP server client; server tools register into `defaultToolRegistry` (`manager.ts`), and the harness resolves the per-turn toolset (`agent/harness/tool_resolver.ts`) |
| `runtimes/` | auxiliary prompt-text generators (titles, summaries) |
| `observability/` | Langfuse tracing init + helpers |
| `affect/`, `awaiters/`, `tasks/`, `workspaces/`, `memory/` | feature modules |

## Chat-turn flow

```
renderer composables (useChatComposerSend → electronAPI.chat.stream)
  → IPC 'chat:stream'    (daemon: WS /v1/chat/stream, message type `start`)
  → desktop main/ipc/chat.ts
  → chat_service/streaming.ts
       1. supersede prior stream from the same sender (abort 'superseded-by-new-request')
       2. rate-limit (5 req / 10s per thread) + cancelThreadStreams
       3. prepare the turn — agent_session/turn_preparer.ts → context.ts assembler
          (skills + context budget + affect/identity + thread summary;
           semantic memory is NOT injected here: includeMemory: false)
       4. open AgentRunTracker row (SQLite agent_runs)
       5. new AgentHarness(...)
       6. traceChatTurn() wraps each harness.turn() iteration (Langfuse; threadId → trace sessionId)
  → AgentHarness.turn      (agent/harness/)   tool resolution / approval gating / handoff capture / history sync
  → SimpleAgentRunner.run  (agent/runners/)   wraps AI SDK streamText
       └─ inner loop = AI SDK stopWhen: stepCountIs(remaining), budget DEFAULT_CHAT_TOOL_MAX_ITERATIONS = 200
  → provider/llm/factory.ts   branches: acp / openai / anthropic(+compatible) / deepseek / minimax / isResponseApi / openai-compatible fallback
  → forwardAgentStep → uiChunkEmitter (chat_service/ui_stream.ts) → target.send('chat:ui-chunk')
  → renderer ui_stream_controller → pure ui_stream_reducer → @ai-sdk/vue Chat store (ChatMessageStore)
```

Loops: **inner** = AI SDK `stopWhen` above (1 step if tools disabled). **Outer** = streaming.ts runs one `harness.turn` per batch and continues **only in autonomous mode**, capped at `MAX_OUTER_AUTONOMOUS_BATCHES = 50`, checkpointing every 5 batches; handoff chains are separately capped at `MAX_HANDOFF_CHAIN = 5`. Both caps are live code.

## Invariants

- **Memory:** retrieval is off on the chat path (`includeMemory: false`); full retrieval only on approval recovery. Writes split: short-memory sync after persistence, long/emotion async fire-and-forget.
- **Two observability stacks, don't unify:** `AgentRunTracker` → SQLite `agent_runs` / `agent_run_steps` / `agent_run_checkpoints` (can-I-resume-this-turn); Langfuse → why-did-the-model-do-that (`traceChatTurn` maps `threadId` to the trace `sessionId`).
- **`AgentHarness` has five construction sites** (streaming ×2, chat_send, approval recovery, subagent) — changes to "always pass X to the harness" must touch all five.
- **Subagent** (`tools/agent_tools.ts`) skips context assembly/compaction but records a child run via `agent_session/run_tracker`.
- **MCP tools** register into `defaultToolRegistry` (`mcp/manager.ts`); the harness picks the per-turn toolset (`agent/harness/tool_resolver.ts`). `resolveToolsForClient` in the daemon is per-client filtering, not the merge point.

## Don't

- Don't import `electron` here. If you need a host capability (window, dialog, clipboard), accept it via a platform interface defined in `chat_platform.ts` / `platform.ts`.
- Don't reach into `packages/desktop` or `packages/daemon`. Dependency direction is one-way.

See repo root [AGENTS.md](../../AGENTS.md) for orientation and the doc map.
