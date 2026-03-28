import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

import { useChatThreads } from '../../../src/renderer/composables/useChatThreads';
import { setLocale } from '../../../src/renderer/i18n';
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

const createHarness = (
  initialThreads: ChatThread[] = [],
  options?: {
    preferredModel?: string;
    preferredProviderId?: string | null;
    persistDraftModelSelection?: ReturnType<typeof vi.fn>;
  }
) => {
  const threadsById = new Map(initialThreads.map(thread => [thread.id, thread]));
  const generateTitle = vi.fn(async () => 'Generated title');
  const preferredDraftModel = ref(options?.preferredModel ?? '');
  const preferredDraftProviderId = ref(options?.preferredProviderId ?? null);
  const persistDraftModelSelection =
    options?.persistDraftModelSelection ?? vi.fn(async () => undefined);

  const createThread = vi.fn(async (input: Partial<ChatThread>) => {
    const thread = createStoredThread({
      id: `thread_${threadsById.size + 1}`,
      title: typeof input.title === 'string' ? input.title : 'New Chat',
      model: typeof input.model === 'string' ? input.model : undefined,
      metadata: typeof input.metadata === 'string' ? input.metadata : '{}',
      is_incognito:
        typeof input.is_incognito === 'number' ? input.is_incognito : input.is_incognito ? 1 : 0,
      workspace_id:
        typeof input.workspace_id === 'string' && input.workspace_id.trim().length > 0
          ? input.workspace_id
          : undefined,
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
        generateTitle,
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
    preferredDraftModel,
    preferredDraftProviderId,
    persistDraftModelSelection,
  });

  return {
    state,
    createThread,
    updateThread,
    getThread,
    listMessages,
    refreshSidebar,
    setCurrentThread,
    generateTitle,
    preferredDraftModel,
    preferredDraftProviderId,
    persistDraftModelSelection,
  };
};

describe('useChatThreads', () => {
  afterEach(() => {
    setLocale('en');
  });

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

  it('keeps draft workspace state before thread creation and persists it into the new thread', async () => {
    const { state, createThread, updateThread } = createHarness();

    await state.setWorkspace('workspace_alpha');

    expect(state.selectedWorkspaceId.value).toBe('workspace_alpha');
    expect(updateThread).not.toHaveBeenCalled();

    const createdThread = await state.createNewThread('gpt-4.1');

    expect(createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4.1',
        workspace_id: 'workspace_alpha',
      })
    );
    expect(createdThread?.workspace_id).toBe('workspace_alpha');
    expect(state.currentThread.value?.workspace_id).toBe('workspace_alpha');
    expect(state.selectedWorkspaceId.value).toBe('workspace_alpha');

    await state.setWorkspace(null);

    expect(updateThread).toHaveBeenCalledWith(createdThread?.id, {
      workspace_id: null,
    });
    expect(state.currentThread.value?.workspace_id).toBeUndefined();
    expect(state.selectedWorkspaceId.value).toBeNull();
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

  it('syncs the active composer model from the selected thread', async () => {
    const deepseekThread = createStoredThread({
      id: 'thread_deepseek',
      title: 'DeepSeek thread',
      model: 'deepseek-chat',
    });
    const openaiThread = createStoredThread({
      id: 'thread_openai',
      title: 'OpenAI thread',
      model: 'gpt-4o',
    });
    const { state } = createHarness([deepseekThread, openaiThread]);

    await state.selectThread(deepseekThread.id);
    expect(state.currentModel.value).toBe('deepseek-chat');

    await state.selectThread(openaiThread.id);
    expect(state.currentModel.value).toBe('gpt-4o');
  });

  it('hydrates and restores the draft composer selection from persisted preferences', async () => {
    const thread = createStoredThread({
      id: 'thread_deepseek',
      title: 'DeepSeek thread',
      model: 'deepseek-chat',
      metadata: JSON.stringify({
        llm: {
          providerId: 'deepseek',
        },
      }),
    });
    const { state, preferredDraftModel, preferredDraftProviderId } = createHarness([thread]);

    expect(state.currentModel.value).toBe('');
    expect(state.currentProviderId.value).toBeNull();

    preferredDraftModel.value = 'gpt-4o';
    preferredDraftProviderId.value = 'openai';
    await nextTick();

    expect(state.currentModel.value).toBe('gpt-4o');
    expect(state.currentProviderId.value).toBe('openai');

    await state.selectThread(thread.id);
    expect(state.currentModel.value).toBe('deepseek-chat');
    expect(state.currentProviderId.value).toBe('deepseek');

    preferredDraftModel.value = 'gpt-5.4';
    preferredDraftProviderId.value = 'gateway-a';
    await nextTick();

    expect(state.currentModel.value).toBe('deepseek-chat');
    expect(state.currentProviderId.value).toBe('deepseek');

    await state.handleThreadDeleted(thread.id);

    expect(state.currentModel.value).toBe('gpt-5.4');
    expect(state.currentProviderId.value).toBe('gateway-a');
  });

  it('persists explicit draft model selections for later chats', async () => {
    const persistDraftModelSelection = vi.fn(async () => undefined);
    const { state } = createHarness([], { persistDraftModelSelection });

    state.handleModelSelected({
      model: 'gpt-4o',
      provider: {
        id: 'openai',
        type: 'openai',
      },
    });
    await Promise.resolve();

    expect(state.currentModel.value).toBe('gpt-4o');
    expect(state.currentProviderId.value).toBe('openai');
    expect(persistDraftModelSelection).toHaveBeenCalledWith({
      model: 'gpt-4o',
      providerId: 'openai',
    });
  });

  it('syncs the composer workspace state from the selected thread', async () => {
    const docsThread = createStoredThread({
      id: 'thread_docs',
      title: 'Docs thread',
      workspace_id: 'workspace_docs',
    });
    const unscopedThread = createStoredThread({
      id: 'thread_general',
      title: 'General thread',
      workspace_id: undefined,
    });
    const { state } = createHarness([docsThread, unscopedThread]);

    await state.selectThread(docsThread.id);
    expect(state.selectedWorkspaceId.value).toBe('workspace_docs');

    await state.selectThread(unscopedThread.id);
    expect(state.selectedWorkspaceId.value).toBeNull();
  });

  it('refreshes the active thread when a temporary workspace binding is materialized on demand', async () => {
    const blankThread = createStoredThread({
      id: 'thread_blank',
      title: 'Blank thread',
      workspace_id: undefined,
    });
    const reboundThread = createStoredThread({
      ...blankThread,
      workspace_id: 'workspace_thread_thread_blank',
    });
    const { state, getThread } = createHarness([blankThread]);

    await state.selectThread(blankThread.id);
    expect(state.selectedWorkspaceId.value).toBeNull();

    getThread.mockResolvedValueOnce(reboundThread);
    const refreshed = await state.ensureWorkspaceForCurrentThread();

    expect(getThread).toHaveBeenLastCalledWith(blankThread.id);
    expect(refreshed?.workspace_id).toBe('workspace_thread_thread_blank');
    expect(state.currentThread.value?.workspace_id).toBe('workspace_thread_thread_blank');
    expect(state.selectedWorkspaceId.value).toBe('workspace_thread_thread_blank');
  });

  it('creates a localized default thread title when the app locale is Chinese', async () => {
    setLocale('zh-CN');
    const { state, createThread } = createHarness();

    await state.createNewThread('gpt-4.1');

    expect(createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '新对话',
      })
    );
  });

  it('builds thread titles from user text instead of assistant/tool narration', async () => {
    const thread = createStoredThread({
      id: 'thread_1',
      title: 'New Chat',
    });
    const { state, generateTitle, updateThread } = createHarness([thread]);

    await state.selectThread(thread.id);
    await state.handleAssistantMessagePersisted({
      threadId: thread.id,
      messagesSnapshot: [
        {
          id: 'user_1',
          role: 'user',
          parts: [{ type: 'text', text: '请告诉我现在几点' }],
        },
        {
          id: 'assistant_1',
          role: 'assistant',
          parts: [
            { type: 'text', text: '我先调用系统时间工具。' },
            {
              type: 'dynamic-tool',
              toolCallId: 'call_1',
              toolName: 'shell',
              state: 'output-available',
              input: { cmd: 'date' },
              output: { stdout: '17:53' },
            },
          ],
        },
      ],
    });

    expect(generateTitle).toHaveBeenCalledWith('User: 请告诉我现在几点');
    expect(updateThread).toHaveBeenCalledWith(thread.id, { title: 'Generated title' });
  });
});
