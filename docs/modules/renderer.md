# Renderer

## Purpose
Provide the desktop UI built in Vue, managing chat interactions, tool approvals,
settings, and real-time streaming display.

## Responsibilities
- Render chat, tool usage, memory retrievals, and approvals.
- Manage streaming state and message persistence.
- Provide settings UI and config syncing.
- Integrate speech input, tool and skill selection, and model selection.

## Key Files
- `src/renderer/views/ChatView.vue`: primary chat UI.
- `src/renderer/components/ChatInput.vue`: message composer and controls.
- `src/renderer/components/ToolSelector.vue`: tool selection UI.
- `src/renderer/components/SkillSelector.vue`: skill selection UI.
- `src/renderer/composables/useChatStreaming.ts`: streaming orchestration.
- `src/renderer/modules/chat/ui_stream_controller.ts`: stream state reducer and effects.
- `src/renderer/modules/chat/ui_message_persistence.ts`: DB persistence bridge.
- `src/renderer/store/config.ts`: config store.
- `src/renderer/services/config_service.ts`: IPC config bridge.

## Data Flow
1. User input builds UI messages and persists them via IPC.
2. Streaming chunks update UI message parts and tool state.
3. Tool approvals flow back through IPC to main services.
4. Config changes propagate to CSS variables and UI state.

## Invariants
- UI messages are normalized to `ai` UI message schema.
- Tool approvals are tracked and deduplicated.
- Config updates are debounced and persisted.

## Extension Points
- Add new UI chunk handlers in `ui_stream_controller`.
- Add new message part renderers in ChatView.
- Add new settings sections in SettingsView.

## Failure Modes
- Missing `window.electronAPI` disables corresponding features with warnings.
- Streaming errors are surfaced in UI and persisted.
