# Main Chat Service

## Purpose
Bridge UI chat interactions to the core agent, tools, memory, and persistence
layers with streaming support and tool approval workflows.

## Responsibilities
- Orchestrate chat send and stream flows.
- Manage tool selection (manual and auto).
- Inject memory and skill prompts into model input.
- Persist chat messages and threads.
- Coordinate tool approvals and resumes.

## Key Files
- `src/main/services/chat/chat_service.ts`: service composition.
- `src/main/services/chat/chat_streaming.ts`: send and stream orchestration.
- `src/main/services/chat/chat_tool_loop.ts`: stream + tool loop handling.
- `src/main/services/chat/chat_memory.ts`: memory injection and emotion integration.
- `src/main/services/chat/chat_tools.ts`: tool resolution logic.
- `src/main/services/chat/chat_approval.ts`: approval tracking and resume.
- `src/main/services/chat/chat_persistence.ts`: message/thread persistence.
- `src/main/services/chat/chat_ui.ts`: UI message normalization and tool event mapping.

## Data Flow
1. UI sends messages to main via IPC or daemon.
2. Memory and skills are injected into system prompt.
3. Tools are resolved and registered with SimpleAgent.
4. Streaming chunks are emitted to the UI, including tool events.
5. Tool approvals pause and resume the tool loop.
6. Messages are persisted and memory is updated.

## Invariants
- Tool-enabled requests use SimpleAgent; non-tool requests use direct LLM calls.
- Tool approvals are required when tool policies demand it.
- Memory injection is disabled for incognito threads.

## Extension Points
- Customize tool allowlists or auto-tool catalog.
- Modify skill selection or persistence logic.
- Add new UI chunk types in `chat_ui.ts`.

## Failure Modes
- Missing provider or model results in explicit errors to the UI.
- Streaming cancellation gracefully aborts the loop and cleans up state.
- Tool approval recovery rebuilds sessions from persisted messages.

## Testing
- `tests/main/services/chat/chat_tool_loop.test.ts`
