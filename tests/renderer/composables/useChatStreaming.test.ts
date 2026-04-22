import type { UIMessage } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { createChatMessageStore } from '../../../src/renderer/modules/chat/chat_message_store';
import { useChatStreaming } from '../../../src/renderer/composables/useChatStreaming';
import type { ChatThread } from '../../../src/shared/types/chat';

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const createStoredThread = (overrides: Partial<ChatThread> = {}): ChatThread => ({
  id: overrides.id ?? 'thread_1',
  title: overrides.title ?? 'Thread',
  model: overrides.model ?? 'gpt-4.1',
  is_generating: overrides.is_generating ?? false,
  reasoning_effort: overrides.reasoning_effort ?? 'medium',
  metadata: overrides.metadata ?? '{}',
  created_at: overrides.created_at ?? '2026-03-22T00:00:00.000Z',
  updated_at: overrides.updated_at ?? '2026-03-22T00:00:00.000Z',
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

const getTextPart = (message: UIMessage): string =>
  message.parts.find(part => part.type === 'text')?.text ?? '';

const createHarness = (options?: {
  currentThread?: ChatThread | null;
  currentModel?: string;
  initialMessages?: UIMessage[];
}) => {
  const messages = [...(options?.initialMessages ?? [])];
  const messageStore = createChatMessageStore({ messages });
  const currentThread = ref<ChatThread | null>(options?.currentThread ?? null);
  const currentModel = ref(options?.currentModel ?? options?.currentThread?.model ?? 'gpt-4.1');
  const selectedTools = ref<string[]>([]);
  const showWelcome = ref(true);

  const upsertUiMessage = vi.fn(async () => undefined);
  const truncateConversationAfterIndex = vi.fn(
    async (params: { messageStore: typeof messageStore; messageIndex: number }) => {
      params.messageStore.truncateAfterIndex(params.messageIndex);
    }
  );
  const stopStream = vi.fn(async () => ({ success: true }));
  const updateThread = vi.fn(async () => ({ success: true }));
  const createNewThread = vi.fn(async (model?: string) => {
    const thread = createStoredThread({
      id: 'thread_new',
      title: 'New Chat',
      model: model ?? currentModel.value,
    });
    currentThread.value = thread;
    currentModel.value = thread.model ?? '';
    return thread;
  });
  const selectThread = vi.fn(async (threadId: string) => {
    currentThread.value = createStoredThread({
      id: threadId,
      title: `Thread ${threadId}`,
      model: currentModel.value,
    });
  });
  const handleThreadDeleted = vi.fn(async () => {
    currentThread.value = null;
  });
  const handleNewChat = vi.fn(async () => {
    currentThread.value = null;
  });
  const onAssistantMessagePersisted = vi.fn(async () => undefined);
  const scrollToBottom = vi.fn();
  const ensureWorkspaceForCurrentThread = vi.fn(async () => currentThread.value);

  const state = useChatStreaming({
    electronAPI: {
      chat: {
        stopStream,
        threads: {
          update: updateThread,
        },
      },
    } as never,
    messageStore,
    persistence: {
      upsertUiMessage,
      truncateConversationAfterIndex,
    } as never,
    createMessageId: () => `msg_${messageStore.messages.length + 1}`,
    scrollToBottom,
    getCurrentThreadId: () => currentThread.value?.id ?? null,
    onAssistantMessagePersisted,
    currentThread,
    currentModel,
    selectedTools,
    showWelcome,
    createNewThread,
    ensureWorkspaceForCurrentThread,
    selectThread,
    handleThreadDeleted,
    handleNewChat,
  });

  return {
    state,
    messageStore,
    currentThread,
    currentModel,
    selectedTools,
    showWelcome,
    upsertUiMessage,
    truncateConversationAfterIndex,
    stopStream,
    updateThread,
    createNewThread,
    ensureWorkspaceForCurrentThread,
    selectThread,
    handleThreadDeleted,
    handleNewChat,
    scrollToBottom,
  };
};

describe('useChatStreaming', () => {
  it('stops the active stream before switching threads and clears transient edit state', async () => {
    const userMessage: UIMessage = {
      id: 'user_1',
      role: 'user',
      parts: [{ type: 'text', text: 'Original draft' }],
    };
    const { state, stopStream, selectThread } = createHarness({
      currentThread: createStoredThread({ id: 'thread_1' }),
      initialMessages: [userMessage],
    });

    await state.beginEditMessage(
      userMessage,
      vi.fn(async () => undefined)
    );
    state.streamController.beginTurn({
      threadId: 'thread_1',
      parentId: 'user_1',
    });
    await flushMicrotasks();

    await state.selectThread('thread_2');
    await flushMicrotasks();

    expect(stopStream).toHaveBeenCalledTimes(1);
    expect(selectThread).toHaveBeenCalledWith('thread_2');
    expect(state.editingUserMessageId.value).toBeNull();
    expect(state.streamController.activeStreamThreadId.value).toBeNull();
    expect(state.streamController.activeAssistantParentId.value).toBeNull();
  });

  it('replaces the edited user message and truncates later conversation before resend', async () => {
    const userMessage: UIMessage = {
      id: 'user_1',
      role: 'user',
      parts: [{ type: 'text', text: 'Old question' }],
    };
    const assistantMessage: UIMessage = {
      id: 'assistant_1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Old answer' }],
    };
    const trailingUserMessage: UIMessage = {
      id: 'user_2',
      role: 'user',
      parts: [{ type: 'text', text: 'Follow-up' }],
    };

    const { state, messageStore, truncateConversationAfterIndex, upsertUiMessage } = createHarness({
      currentThread: createStoredThread({ id: 'thread_1', model: 'gpt-4.1' }),
      initialMessages: [userMessage, assistantMessage, trailingUserMessage],
    });

    await state.beginEditMessage(
      userMessage,
      vi.fn(async () => undefined)
    );

    const result = await state.prepareMessageSend({
      content: 'Updated question',
      model: 'gpt-4.1',
    });
    await flushMicrotasks();

    expect(truncateConversationAfterIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        messageIndex: 0,
      })
    );
    expect(upsertUiMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread_1',
        source: 'user-message-edit',
      })
    );
    expect(state.editingUserMessageId.value).toBeNull();
    expect(messageStore.messages).toHaveLength(1);
    expect(getTextPart(messageStore.messages[0] as UIMessage)).toBe('Updated question');
    expect(result).toEqual({
      threadId: 'thread_1',
      messagesSnapshot: [messageStore.messages[0]],
    });
  });

  it('creates the first thread on send and persists the appended user message', async () => {
    const { state, messageStore, createNewThread, selectedTools, showWelcome, upsertUiMessage } =
      createHarness({
        currentThread: null,
        currentModel: 'gpt-4.1',
      });

    const result = await state.prepareMessageSend({
      content: 'Hello from a fresh composer',
      model: 'gpt-4.1',
      tools: ['web'],
    });
    await flushMicrotasks();

    expect(createNewThread).toHaveBeenCalledWith('gpt-4.1');
    expect(selectedTools.value).toEqual(['web']);
    expect(showWelcome.value).toBe(false);
    expect(upsertUiMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread_new',
        source: 'user-message',
      })
    );
    expect(messageStore.messages).toHaveLength(1);
    expect(getTextPart(messageStore.messages[0] as UIMessage)).toBe('Hello from a fresh composer');
    expect(result?.threadId).toBe('thread_new');
    expect(result?.messagesSnapshot).toHaveLength(1);
  });

  it('persists composer invocation tokens alongside the user text when a message is sent', async () => {
    const { state, messageStore, upsertUiMessage } = createHarness({
      currentThread: createStoredThread({ id: 'thread_1', model: 'gpt-4.1' }),
      currentModel: 'gpt-4.1',
    });

    await state.prepareMessageSend({
      content: 'Build a landing page',
      model: 'gpt-4.1',
      composerInvocations: {
        tokens: [
          {
            id: 'skill:codex:frontend-dev',
            kind: 'skill',
            prefix: '$',
            label: 'frontend-dev',
          },
          {
            id: 'prompt_music',
            kind: 'prompt-app',
            prefix: '',
            label: 'music',
          },
        ],
      },
    });
    await flushMicrotasks();

    expect(messageStore.messages).toHaveLength(1);
    expect(messageStore.messages[0]?.parts).toEqual([
      {
        type: 'data-composer-invocation',
        data: {
          tokens: [
            {
              id: 'skill:codex:frontend-dev',
              kind: 'skill',
              prefix: '$',
              label: 'frontend-dev',
            },
            {
              id: 'prompt_music',
              kind: 'prompt-app',
              prefix: '',
              label: 'music',
            },
          ],
        },
      },
      { type: 'text', text: 'Build a landing page', state: 'done' },
    ]);
    expect(upsertUiMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          parts: expect.arrayContaining([
            expect.objectContaining({
              type: 'data-composer-invocation',
            }),
          ]),
        }),
      })
    );
  });

  it('stores the starting prompt app on an empty thread before the first turn is persisted', async () => {
    const { state, updateThread, currentThread } = createHarness({
      currentThread: createStoredThread({
        id: 'thread_1',
        prompt_app_id: undefined,
      }),
      currentModel: 'gpt-4.1',
    });

    const result = await state.prepareMessageSend({
      content: 'Summarize carefully:\nRelease notes draft',
      model: 'gpt-4.1',
      promptAppId: 'prompt_summarize',
    });
    await flushMicrotasks();

    expect(updateThread).toHaveBeenCalledWith('thread_1', {
      prompt_app_id: 'prompt_summarize',
    });
    expect(currentThread.value?.prompt_app_id).toBe('prompt_summarize');
    expect(result?.threadId).toBe('thread_1');
  });

  it('refreshes workspace binding before sending on an existing unscoped thread', async () => {
    const { state, ensureWorkspaceForCurrentThread } = createHarness({
      currentThread: createStoredThread({
        id: 'thread_blank',
        workspace_id: undefined,
      }),
      currentModel: 'gpt-4.1',
    });

    await state.prepareMessageSend({
      content: 'Bind workspace before first turn',
      model: 'gpt-4.1',
    });
    await flushMicrotasks();

    expect(ensureWorkspaceForCurrentThread).toHaveBeenCalledTimes(1);
  });
});
