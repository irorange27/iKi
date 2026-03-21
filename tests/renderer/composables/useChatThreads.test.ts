import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { useChatThreads } from '../../../src/renderer/composables/useChatThreads';
import type { ChatThread } from '../../../src/shared/types/chat';

const createStoredThread = (overrides: Partial<ChatThread> = {}): ChatThread => ({
  id: overrides.id ?? 'thread_1',
  title: overrides.title ?? 'New Chat',
  model: overrides.model ?? 'gpt-4.1',
  is_generating: overrides.is_generating ?? false,
  reasoning_effort: overrides.reasoning_effort ?? 'medium',
  metadata: overrides.metadata ?? '{}',
  created_at: overrides.created_at ?? '2026-03-21T00:00:00.000Z',
  updated_at: overrides.updated_at ?? '2026-03-21T00:00:00.000Z',
  client_id: overrides.client_id,
  prompt_app_id: overrides.prompt_app_id,
  tools: overrides.tools,
  is_favorited: overrides.is_favorited ?? 0,
  is_incognito: overrides.is_incognito ?? 0,
  workspace_id: overrides.workspace_id,
  enable_artifacts: overrides.enable_artifacts ?? 0,
  artifact_workspace_id: overrides.artifact_workspace_id,
  skill_ids: overrides.skill_ids,
});

const createHarness = (initialThreads: ChatThread[] = []) => {
  const threadsById = new Map(initialThreads.map(thread => [thread.id, thread]));

  const createThread = vi.fn(async (input: Partial<ChatThread>) => {
    const thread = createStoredThread({
      id: `thread_${threadsById.size + 1}`,
      title: typeof input.title === 'string' ? input.title : 'New Chat',
      model: typeof input.model === 'string' ? input.model : undefined,
      metadata: typeof input.metadata === 'string' ? input.metadata : '{}',
      is_incognito:
        typeof input.is_incognito === 'number'
          ? input.is_incognito
          : input.is_incognito
            ? 1
            : 0,
    });
    threadsById.set(thread.id, thread);
    return thread;
  });

  const updateThread = vi.fn(async (id: string, updates: Partial<ChatThread>) => {
    const existing = threadsById.get(id) ?? createStoredThread({ id });
    const next = createStoredThread({
      ...existing,
      ...updates,
      id,
      is_incognito:
        typeof updates.is_incognito === 'number'
          ? updates.is_incognito
          : updates.is_incognito
            ? 1
            : updates.is_incognito === false
              ? 0
              : existing.is_incognito,
    });
    threadsById.set(id, next);
    return { changes: 1 };
  });

  const getThread = vi.fn(async (id: string) => threadsById.get(id) ?? null);
  const listMessages = vi.fn(async () => []);
  const refreshSidebar = vi.fn(async () => undefined);
  const setCurrentThread = vi.fn();

  const state = useChatThreads({
    electronAPI: {
      chat: {
        threads: {
          create: createThread,
          update: updateThread,
          get: getThread,
        },
        messages: {
          list: listMessages,
        },
      },
      toolModel: {
        generateTitle: vi.fn(async () => 'Generated title'),
      },
      tasks: {},
    } as never,
    messageStore: {
      clear: vi.fn(),
      setAll: vi.fn(),
    } as never,
    persistence: {
      resetPersistedMessageIds: vi.fn(),
    } as never,
    sidebarRef: ref({
      refresh: refreshSidebar,
      setCurrentThread,
    }),
    scrollToBottom: vi.fn(),
  });

  return {
    state,
    createThread,
    updateThread,
    getThread,
    listMessages,
    refreshSidebar,
    setCurrentThread,
  };
};

describe('useChatThreads', () => {
  it('keeps draft incognito state before thread creation and persists it into the new thread', async () => {
    const { state, createThread, updateThread } = createHarness();

    await state.setIncognito(true);

    expect(state.isIncognito.value).toBe(true);
    expect(updateThread).not.toHaveBeenCalled();

    const createdThread = await state.createNewThread('gpt-4.1');

    expect(createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4.1',
        is_incognito: 1,
      })
    );
    expect(createdThread?.is_incognito).toBe(1);
    expect(state.currentThread.value?.is_incognito).toBe(1);
    expect(state.isIncognito.value).toBe(true);

    await state.setIncognito(false);

    expect(updateThread).toHaveBeenCalledWith(createdThread?.id, { is_incognito: 0 });
    expect(state.currentThread.value?.is_incognito).toBe(0);
    expect(state.isIncognito.value).toBe(false);
  });

  it('syncs the composer incognito state from the selected thread', async () => {
    const privateThread = createStoredThread({
      id: 'thread_private',
      title: 'Private thread',
      is_incognito: 1,
    });
    const normalThread = createStoredThread({
      id: 'thread_normal',
      title: 'Normal thread',
      is_incognito: 0,
    });
    const { state, listMessages } = createHarness([privateThread, normalThread]);

    await state.selectThread(privateThread.id);

    expect(listMessages).toHaveBeenCalledWith(privateThread.id);
    expect(state.currentThread.value?.id).toBe(privateThread.id);
    expect(state.isIncognito.value).toBe(true);

    await state.selectThread(normalThread.id);

    expect(state.currentThread.value?.id).toBe(normalThread.id);
    expect(state.isIncognito.value).toBe(false);
  });
});
