import { ref } from 'vue';

export type ToolUiState = {
  collapsed?: boolean;
  inputText?: string;
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
