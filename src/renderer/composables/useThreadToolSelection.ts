import { computed, ref, type Ref } from 'vue';

import {
  normalizeStringArray,
  parseThreadToolNames,
  parseThreadToolSelectionState,
} from '../../shared/chat/thread_runtime_hints';
import type { ElectronApi } from '../../shared/types/electron_api';

export const useThreadToolSelection = (deps: {
  electronAPI: Pick<ElectronApi, 'chat' | 'tools'>;
  isLoading: Ref<boolean>;
}) => {
  const selectedTools = ref<string[]>([]);
  const selectedMcpServerIds = ref<string[]>([]);
  const toolMode = ref<'manual' | 'auto'>('auto');
  const isAutoToolMode = computed(() => toolMode.value === 'auto');

  const resetToolSelection = () => {
    selectedTools.value = [];
    selectedMcpServerIds.value = [];
    toolMode.value = 'auto';
  };

  const deriveMcpServerIdsFromToolNames = async (toolNames: string[]): Promise<string[]> => {
    const normalizedToolNames = new Set(normalizeStringArray(toolNames));
    if (normalizedToolNames.size === 0) return [];

    try {
      const tools = await deps.electronAPI.tools.list();
      if (!Array.isArray(tools)) return [];

      const resolvedServerIds = new Set<string>();
      for (const tool of tools) {
        if (!tool || typeof tool !== 'object') continue;
        const name = typeof tool.name === 'string' ? tool.name.trim() : '';
        const source =
          tool.source && typeof tool.source === 'object'
            ? (tool.source as { kind?: unknown; id?: unknown })
            : null;
        if (!name || !normalizedToolNames.has(name)) continue;
        if (source?.kind !== 'mcp' || typeof source.id !== 'string' || !source.id.trim()) {
          continue;
        }
        resolvedServerIds.add(source.id.trim());
      }

      return Array.from(resolvedServerIds);
    } catch (error) {
      console.error('Failed to derive MCP server ids from tools:', error);
      return [];
    }
  };

  const resolveSelectedMcpServerIds = async (): Promise<string[]> => {
    if (selectedMcpServerIds.value.length > 0) {
      return normalizeStringArray(selectedMcpServerIds.value);
    }
    return await deriveMcpServerIdsFromToolNames(selectedTools.value);
  };

  const syncToolSelectionFromThread = async (threadId?: string) => {
    const normalizedThreadId = typeof threadId === 'string' ? threadId.trim() : '';
    if (!normalizedThreadId) {
      resetToolSelection();
      return;
    }
    if (deps.isLoading.value) return;

    try {
      const thread = await deps.electronAPI.chat.threads.get(normalizedThreadId);
      if (!thread) {
        resetToolSelection();
        return;
      }

      const persistedTools = parseThreadToolNames(thread.tools);
      const selectionState = parseThreadToolSelectionState(thread.metadata);
      const resolvedMcpServerIds =
        selectionState.mcpServerIds.length > 0
          ? selectionState.mcpServerIds
          : await deriveMcpServerIdsFromToolNames(persistedTools);
      const hasPersistedSelection =
        persistedTools.length > 0 ||
        resolvedMcpServerIds.length > 0 ||
        selectionState.mode === 'auto' ||
        selectionState.mode === 'manual';

      if (!hasPersistedSelection) {
        resetToolSelection();
        return;
      }

      selectedTools.value = persistedTools;
      selectedMcpServerIds.value = resolvedMcpServerIds;
      toolMode.value = selectionState.mode ?? 'auto';
    } catch (error) {
      console.error('Failed to sync tool selection from thread:', error);
    }
  };

  return {
    selectedTools,
    selectedMcpServerIds,
    toolMode,
    isAutoToolMode,
    resetToolSelection,
    syncToolSelectionFromThread,
    resolveSelectedMcpServerIds,
  };
};
