import { ref } from 'vue';

import type { ChatUiMessageChunk } from '@iki/backend/chat/message_parts';

export type ToolUiState = {
  collapsed?: boolean;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
};

export type ToolUiStatePatch = Partial<ToolUiState>;

const toolUiStateMap = ref<Record<string, ToolUiState>>({});

export const getToolUiStateMap = (): Readonly<Record<string, ToolUiState>> =>
  toolUiStateMap.value;

export const getToolUiState = (toolCallId: string | null | undefined): ToolUiState | undefined => {
  if (!toolCallId) return undefined;
  return toolUiStateMap.value[toolCallId];
};

export const updateToolUiState = (
  toolCallId: string,
  patch: ToolUiStatePatch
): ToolUiState | undefined => {
  if (!toolCallId) return undefined;

  const current = toolUiStateMap.value[toolCallId] ?? {};
  const next: ToolUiState = { ...current, ...patch };

  for (const key of Object.keys(patch) as Array<keyof ToolUiState>) {
    const value = patch[key];
    if (value === undefined) {
      delete (next as Record<string, unknown>)[key as string];
    }
  }

  toolUiStateMap.value = {
    ...toolUiStateMap.value,
    [toolCallId]: next,
  };

  return next;
};

export const resetToolUiStateMap = () => {
  toolUiStateMap.value = {};
};

const getChunkToolCallId = (chunk: ChatUiMessageChunk): string =>
  'toolCallId' in chunk && typeof chunk.toolCallId === 'string' ? chunk.toolCallId : '';

const isTerminalToolChunk = (type: ChatUiMessageChunk['type']): boolean =>
  type === 'tool-output-available' ||
  type === 'tool-output-error' ||
  type === 'tool-output-denied' ||
  type === 'tool-input-error';

/**
 * Timing side-tap for chunk-fed streams: durations and collapse state live
 * outside the message parts, keyed by toolCallId (read by the tool card).
 */
export const recordToolChunkTiming = (chunk: ChatUiMessageChunk): void => {
  const toolCallId = getChunkToolCallId(chunk);
  if (!toolCallId) return;

  const now = Date.now();
  if (chunk.type === 'tool-input-start' || chunk.type === 'tool-input-delta') {
    const uiState = getToolUiState(toolCallId);
    if (
      !uiState ||
      typeof uiState.startedAt !== 'number' ||
      !Number.isFinite(uiState.startedAt)
    ) {
      updateToolUiState(toolCallId, { startedAt: now });
    }
    return;
  }
  if (isTerminalToolChunk(chunk.type)) {
    const uiState = getToolUiState(toolCallId);
    const startedAt =
      typeof uiState?.startedAt === 'number' && Number.isFinite(uiState.startedAt)
        ? uiState.startedAt
        : now;
    updateToolUiState(toolCallId, {
      startedAt,
      endedAt: now,
      durationMs: Math.max(0, now - startedAt),
    });
  }
};
