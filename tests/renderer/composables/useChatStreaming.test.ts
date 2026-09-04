import type { UIMessage } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { createChatInstance } from '../../../packages/desktop/src/renderer/modules/chat/chat_instance';
import { createUiMessagePersistence } from '../../../packages/desktop/src/renderer/modules/chat/ui_message_persistence';
import { useChatStreaming } from '../../../packages/desktop/src/renderer/composables/useChatStreaming';
import type { ChatThread } from '@iki/backend/types/chat';

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
  const currentThread = ref<ChatThread | null>(options?.currentThread ?? null);
  const currentModel = ref(options?.currentModel ?? options?.currentThread?.model ?? 'gpt-4.1');
  const selectedTools = ref<string[]>([]);
  const showWelcome = ref(true);

  const messageCreated = vi.fn(async (input: { id: string }) => ({ id: input.id }));
  const messageUpdated = vi.fn(async () => undefined);
  const stream = vi.fn(async () => ({ success: true }));
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
  const clearCurrentThread = vi.fn(async () => currentThread.value);
  const onAssistantMessagePersisted = vi.fn(async () => undefined);
  const scrollToBottom = vi.fn();
  const ensureWorkspaceForCurrentThread = vi.fn(async () => currentThread.value);

  const electronAPI = {
    chat: {
      onUiChunk: vi.fn(() => () => undefined),
      stream,
      stopStream,
      approveTool: vi.fn(async () => ({ success: true })),
      messages: {
        create: messageCreated,
        update: messageUpdated,
        delete: vi.fn(async () => undefined),
      },
      threads: {
        update: updateThread,
      },
    },
  } as never;

  const persistence = createUiMessagePersistence({ electronAPI });

  const chatInstance = createChatInstance({
    electronAPI,
    generateId: () => `msg_${Math.random().toString(36).slice(2, 8)}`,
    getCurrentThreadId: () => currentThread.value?.id ?? null,
    onAssistantMessagePersisted,
  });
  const messageStore = chatInstance.messageStore;
  (options?.initialMessages ?? []).forEach(message => messageStore.append(message as never));

  const state = useChatStreaming({
    electronAPI,
    chatInstance,
    messageStore,
    persistence,
    createMessageId: () => `msg_${messageStore.messages.length + 1}`,
    scrollToBottom,
    getCurrentThreadId: () => currentThread.value?.id ?? null,
    onAssistantMessagePersisted,
    currentThread,
    currentModel,
    selectedTools,
    showWelcome,
    createNewThread,
    clearCurrentThread,
    ensureWorkspaceForCurrentThread,
    selectThread,
    handleThreadDeleted,
    handleNewChat,
  });

  return {
    state,
    chatInstance,
    messageStore,
    currentThread,
    currentModel,
    selectedTools,
    showWelcome,
    messageCreated,
    messageUpdated,
    stopStream,
    updateThread,
    createNewThread,
    clearCurrentThread,
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
    const { state, chatInstance, stopStream, selectThread } = createHarness({
      currentThread: createStoredThread({ id: 'thread_1' }),
      initialMessages: [userMessage],
    });

    // Bind the transport to thread_1 as an in-flight turn would.
    await chatInstance.chat.sendMessage(
      { ...userMessage },
      { body: { threadId: 'thread_1' } }
    );
    await flushMicrotasks();

    await state.beginEditMessage(userMessage, vi.fn(async () => undefined));
    await state.selectThread('thread_2');
    await flushMicrotasks();

    // One stop from beginEditMessage, one from the thread switch.
    expect(stopStream).toHaveBeenCalledTimes(2);
    expect(selectThread).toHaveBeenCalledWith('thread_2');
    expect(state.editingUserMessageId.value).toBeNull();
  });

  it('stops the active stream before clearing the current thread and resets transient edit state', async () => {
    const userMessage: UIMessage = {
      id: 'user_1',
      role: 'user',
      parts: [{ type: 'text', text: 'Original draft' }],
    };
    const { state, chatInstance, stopStream, clearCurrentThread } = createHarness({
      currentThread: createStoredThread({ id: 'thread_1' }),
      initialMessages: [userMessage],
    });

    await chatInstance.chat.sendMessage(
      { ...userMessage },
      { body: { threadId: 'thread_1' } }
    );
    await flushMicrotasks();

    await state.beginEditMessage(userMessage, vi.fn(async () => undefined));
    await state.handleClearCurrentThread();
    await flushMicrotasks();

    // One stop from beginEditMessage, one from clearing the thread.
    expect(stopStream).toHaveBeenCalledTimes(2);
    expect(clearCurrentThread).toHaveBeenCalledTimes(1);
    expect(state.editingUserMessageId.value).toBeNull();
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

    const { state, chatInstance, messageCreated } = createHarness({
      currentThread: createStoredThread({ id: 'thread_1', model: 'gpt-4.1' }),
      initialMessages: [userMessage, assistantMessage, trailingUserMessage],
    });

    await state.beginEditMessage(userMessage, vi.fn(async () => undefined));

    const result = await state.prepareMessageSend({
      content: 'Updated question',
      model: 'gpt-4.1',
    });
    await flushMicrotasks();

    // The real persistence truncate drops everything after the edited message.
    expect(chatInstance.messageStore.messages).toHaveLength(1);
    expect(getTextPart(chatInstance.messageStore.messages[0] as UIMessage)).toBe(
      'Updated question'
    );
    expect(messageCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user_1', thread_id: 'thread_1' })
    );
    expect(state.editingUserMessageId.value).toBeNull();
    expect(getTextPart(result?.userMessage as UIMessage)).toBe('Updated question');
    expect(result).toMatchObject({
      threadId: 'thread_1',
      editedMessageId: 'user_1',
    });
  });

  it('creates the first thread on send and persists the built user message', async () => {
    const { state, chatInstance, createNewThread, selectedTools, showWelcome, messageCreated } =
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
    expect(messageCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        thread_id: 'thread_new',
      })
    );
    // The user message lands in the store via chat.sendMessage, not here.
    expect(chatInstance.messageStore.messages).toHaveLength(0);
    expect(getTextPart(result?.userMessage as UIMessage)).toBe('Hello from a fresh composer');
    expect(result?.threadId).toBe('thread_new');
  });

  it('persists composer invocation tokens alongside the user text when a message is sent', async () => {
    const { state } = createHarness({
      currentThread: createStoredThread({ id: 'thread_1', model: 'gpt-4.1' }),
      currentModel: 'gpt-4.1',
    });

    const result = await state.prepareMessageSend({
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

    expect(result?.userMessage.parts).toEqual([
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
