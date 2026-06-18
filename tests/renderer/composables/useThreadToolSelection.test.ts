import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { useThreadToolSelection } from '../../../packages/desktop/src/renderer/composables/useThreadToolSelection';

const createHarness = (threadsById: Record<string, unknown>) => {
  const getThread = vi.fn(async (id: string) => threadsById[id] ?? null);
  const listTools = vi.fn(async () => [
    {
      name: 'mcp_lookup',
      source: {
        kind: 'mcp',
        id: 'docs_server',
      },
    },
  ]);

  const state = useThreadToolSelection({
    electronAPI: {
      chat: {
        threads: {
          get: getThread,
        },
      },
      tools: {
        list: listTools,
      },
    } as never,
    isLoading: ref(false),
  });

  return {
    state,
    getThread,
    listTools,
  };
};

describe('useThreadToolSelection', () => {
  it('loads persisted tool selection from the active thread', async () => {
    const { state, getThread } = createHarness({
      thread_1: {
        id: 'thread_1',
        tools: '["web","mcp_lookup"]',
        metadata: JSON.stringify({
          toolSelection: {
            mode: 'manual',
            mcpServerIds: ['docs_server'],
          },
        }),
      },
    });

    await state.syncToolSelectionFromThread('thread_1');

    expect(getThread).toHaveBeenCalledWith('thread_1');
    expect(state.selectedTools.value).toEqual(['web', 'mcp_lookup']);
    expect(state.selectedMcpServerIds.value).toEqual(['docs_server']);
    expect(state.toolMode.value).toBe('manual');
  });

  it('resets the local selection when the next thread has no persisted tool hints', async () => {
    const { state } = createHarness({
      thread_1: {
        id: 'thread_1',
        tools: '["web","mcp_lookup"]',
        metadata: JSON.stringify({
          toolSelection: {
            mode: 'manual',
            mcpServerIds: ['docs_server'],
          },
        }),
      },
      thread_2: {
        id: 'thread_2',
        tools: null,
        metadata: '{}',
      },
    });

    await state.syncToolSelectionFromThread('thread_1');
    expect(state.selectedTools.value).toEqual(['web', 'mcp_lookup']);
    expect(state.toolMode.value).toBe('manual');

    await state.syncToolSelectionFromThread('thread_2');

    expect(state.selectedTools.value).toEqual([]);
    expect(state.selectedMcpServerIds.value).toEqual([]);
    expect(state.toolMode.value).toBe('auto');
  });

  it('resets the local selection when no thread is active', async () => {
    const { state } = createHarness({
      thread_1: {
        id: 'thread_1',
        tools: '["web"]',
        metadata: JSON.stringify({
          toolSelection: {
            mode: 'manual',
          },
        }),
      },
    });

    await state.syncToolSelectionFromThread('thread_1');
    expect(state.selectedTools.value).toEqual(['web']);

    await state.syncToolSelectionFromThread('');

    expect(state.selectedTools.value).toEqual([]);
    expect(state.selectedMcpServerIds.value).toEqual([]);
    expect(state.toolMode.value).toBe('auto');
  });
});
