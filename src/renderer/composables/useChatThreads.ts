import { ref, type Ref } from 'vue';
import type { UIMessage } from 'ai';

import { parseStoredUiMessage } from '../modules/chat/ui_message_storage';
import { resetToolUiStateMap } from '../modules/chat/tool_ui_state';
import { extractTextFromMessage } from '../modules/chat/ui_message_text';
import { isObjectRecord } from '../../shared/utils/guards';
import type { ChatMessage, ChatThread as StoredChatThread } from '../../shared/types/chat';
import type { ElectronApi } from '../../shared/types/electron_api';
import { createLogger } from '../logger';
import { getCurrentLocale, translateWithLocale } from '../i18n';
import type { ChatMessageStore } from '../modules/chat/chat_message_store';
import type { UiMessagePersistence } from '../modules/chat/ui_message_persistence';

export type ChatThread = StoredChatThread;

type SidebarController = {
  refresh?: () => Promise<void> | void;
  setCurrentThread?: (id: string | null) => void;
};

const TITLE_REGEN_INTERVAL = 2;
const chatThreadsLogger = createLogger({ module: 'chat_threads' });
const DEFAULT_THREAD_TITLES = new Set([
  translateWithLocale('en', 'chat.thread.newTitle'),
  translateWithLocale('zh-CN', 'chat.thread.newTitle'),
]);

export const useChatThreads = (deps: {
  electronAPI: Pick<ElectronApi, 'chat' | 'toolModel' | 'tasks'>;
  messageStore: ChatMessageStore;
  persistence: UiMessagePersistence;
  sidebarRef: Ref<SidebarController | null>;
  scrollToBottom: () => void;
}) => {
  const currentThread = ref<ChatThread | null>(null);
  const currentModel = ref<string>('');
  const isIncognito = ref(false);
  const selectedWorkspaceId = ref<string | null>(null);
  const selectedTools = ref<string[]>([]);
  const showWelcome = ref(true);

  const getCurrentThreadId = () => currentThread.value?.id || null;

  const syncIncognitoState = (thread: ChatThread | null) => {
    isIncognito.value = Boolean(thread?.is_incognito);
  };

  const syncWorkspaceState = (thread: ChatThread | null) => {
    const workspaceId =
      typeof thread?.workspace_id === 'string' && thread.workspace_id.trim().length > 0
        ? thread.workspace_id.trim()
        : null;
    selectedWorkspaceId.value = workspaceId;
  };

  const refreshThreads = async () => {
    if (deps.sidebarRef.value?.refresh) {
      await deps.sidebarRef.value.refresh();
    }
  };

  const updateThreadTitle = async (title: string) => {
    if (!currentThread.value) return;
    if (currentThread.value.title === title) return;

    try {
      await deps.electronAPI.chat.threads.update(currentThread.value.id, { title });
      if (currentThread.value) {
        currentThread.value.title = title;
      }
      await refreshThreads();
    } catch (error) {
      chatThreadsLogger.event({
        level: 'error',
        event: 'chat.thread.title_update',
        outcome: 'failed',
        error,
        entity: {
          thread_id: currentThread.value.id,
        },
      });
    }
  };

  const updateThreadTitleById = async (threadId: string, title: string) => {
    if (!threadId || !title.trim()) return;

    if (currentThread.value?.id === threadId) {
      await updateThreadTitle(title);
      return;
    }

    try {
      await deps.electronAPI.chat.threads.update(threadId, { title });
      await refreshThreads();
    } catch (error) {
      chatThreadsLogger.event({
        level: 'error',
        event: 'chat.thread.title_update',
        outcome: 'failed',
        error,
        entity: {
          thread_id: threadId,
        },
      });
    }
  };

  const getConversationContentForTitle = (messages: UIMessage[]): string => {
    const lines: string[] = [];

    for (const message of messages) {
      const text = extractTextFromMessage(message).trim();
      if (!text) continue;

      const role =
        message.role === 'assistant' ? 'Assistant' : message.role === 'system' ? 'System' : 'User';
      lines.push(`${role}: ${text}`);
    }

    return lines.join('\n');
  };

  const getFallbackThreadTitle = (messages: UIMessage[]): string | null => {
    const latestUserText = [...messages]
      .reverse()
      .filter(message => message.role === 'user')
      .map(message => extractTextFromMessage(message).trim())
      .find(text => text.length > 0);
    const fallbackText = latestUserText || extractTextFromMessage(messages[0]).trim();
    if (!fallbackText) return null;
    return fallbackText.slice(0, 50) + (fallbackText.length > 50 ? '...' : '');
  };

  const shouldRegenerateThreadTitle = (messages: UIMessage[], currentTitle: string): boolean => {
    const assistantMessageCount = messages.filter(message => message.role === 'assistant').length;
    if (assistantMessageCount === 0) return false;
    if (DEFAULT_THREAD_TITLES.has(currentTitle)) return true;
    return assistantMessageCount % TITLE_REGEN_INTERVAL === 0;
  };

  const generateThreadTitle = async (messages: UIMessage[]): Promise<string | null> => {
    try {
      const conversationContent = getConversationContentForTitle(messages);
      if (!conversationContent.trim()) {
        return getFallbackThreadTitle(messages);
      }

      const title = await deps.electronAPI.toolModel.generateTitle(conversationContent);
      return title || getFallbackThreadTitle(messages);
    } catch (error) {
      chatThreadsLogger.event({
        level: 'error',
        event: 'chat.thread.title_generate',
        outcome: 'failed',
        error,
      });
      return getFallbackThreadTitle(messages);
    }
  };

  const handleAssistantMessagePersisted = async (params: {
    threadId: string;
    messagesSnapshot: UIMessage[];
  }) => {
    if (!currentThread.value || currentThread.value.id !== params.threadId) return;

    if (
      params.messagesSnapshot.length > 0 &&
      shouldRegenerateThreadTitle(params.messagesSnapshot, currentThread.value.title)
    ) {
      const generatedTitle = await generateThreadTitle(params.messagesSnapshot);
      if (generatedTitle) {
        await updateThreadTitleById(params.threadId, generatedTitle);
      }
    }
  };

  const createNewThread = async (model?: string) => {
    try {
      const thread = await deps.electronAPI.chat.threads.create({
        title: translateWithLocale(getCurrentLocale(), 'chat.thread.newTitle'),
        model: model || null,
        metadata: JSON.stringify({}),
        is_incognito: isIncognito.value ? 1 : 0,
        workspace_id: selectedWorkspaceId.value,
      });
      currentThread.value = thread;
      currentModel.value = typeof thread.model === 'string' ? thread.model : model || '';
      syncIncognitoState(thread);
      syncWorkspaceState(thread);
      deps.messageStore.clear();
      deps.persistence.resetPersistedMessageIds();
      resetToolUiStateMap();
      showWelcome.value = false;

      if (deps.sidebarRef.value?.refresh) {
        await deps.sidebarRef.value.refresh();
      }
      if (deps.sidebarRef.value?.setCurrentThread) {
        deps.sidebarRef.value.setCurrentThread(thread.id);
      }

      return thread;
    } catch (error) {
      chatThreadsLogger.event({
        level: 'error',
        event: 'chat.thread.create',
        outcome: 'failed',
        error,
      });
      return null;
    }
  };

  const loadThreadMessages = async (threadId: string) => {
    try {
      const dbMessages = await deps.electronAPI.chat.messages.list(threadId);
      const rows = Array.isArray(dbMessages)
        ? dbMessages.filter(
            (message): message is ChatMessage =>
              isObjectRecord(message) &&
              typeof message.id === 'string' &&
              typeof message.thread_id === 'string' &&
              typeof message.message === 'string'
          )
        : [];
      deps.persistence.resetPersistedMessageIds(rows.map(row => row.id));

      const chatMessages = rows.map(row => parseStoredUiMessage(row));
      deps.messageStore.setAll(chatMessages as UIMessage[]);
      resetToolUiStateMap();
      deps.scrollToBottom();
    } catch (error) {
      chatThreadsLogger.event({
        level: 'error',
        event: 'chat.thread.messages_load',
        outcome: 'failed',
        error,
        entity: {
          thread_id: threadId,
        },
      });
    }
  };

  const selectThread = async (threadId: string) => {
    try {
      if (currentThread.value?.id === threadId) {
        return;
      }

      const thread = await deps.electronAPI.chat.threads.get(threadId);
      if (!thread) {
        chatThreadsLogger.event({
          level: 'warn',
          event: 'chat.thread.select',
          outcome: 'skipped',
          message: 'Thread not found.',
          entity: {
            thread_id: threadId,
          },
        });
        return;
      }

      currentThread.value = thread;
      currentModel.value = typeof thread.model === 'string' ? thread.model : '';
      syncIncognitoState(thread);
      syncWorkspaceState(thread);
      showWelcome.value = false;
      await loadThreadMessages(threadId);

      if (deps.sidebarRef.value?.setCurrentThread) {
        deps.sidebarRef.value.setCurrentThread(threadId);
      }
    } catch (error) {
      chatThreadsLogger.event({
        level: 'error',
        event: 'chat.thread.select',
        outcome: 'failed',
        error,
        entity: {
          thread_id: threadId,
        },
      });
    }
  };

  const handleThreadDeleted = async (threadId: string) => {
    if (currentThread.value?.id !== threadId) return;

    currentThread.value = null;
    currentModel.value = '';
    isIncognito.value = false;
    selectedWorkspaceId.value = null;
    deps.messageStore.clear();
    deps.persistence.resetPersistedMessageIds();
    resetToolUiStateMap();
    showWelcome.value = true;

    if (deps.sidebarRef.value?.setCurrentThread) {
      deps.sidebarRef.value.setCurrentThread(null);
    }
  };

  const handleNewChat = async () => {
    await createNewThread(currentModel.value);
  };

  const handleModelSelected = (data: { model: string }) => {
    currentModel.value = data.model;
    if (currentThread.value) {
      deps.electronAPI.chat.threads.update(currentThread.value.id, { model: data.model });
    }
  };

  const setIncognito = async (nextValue: boolean) => {
    const normalizedValue = Boolean(nextValue);
    const previousValue = isIncognito.value;
    const activeThread = currentThread.value;

    isIncognito.value = normalizedValue;
    if (activeThread) {
      activeThread.is_incognito = normalizedValue ? 1 : 0;
    }

    if (!activeThread) return;

    try {
      await deps.electronAPI.chat.threads.update(activeThread.id, {
        is_incognito: normalizedValue ? 1 : 0,
      });
    } catch (error) {
      chatThreadsLogger.event({
        level: 'error',
        event: 'chat.thread.incognito_update',
        outcome: 'failed',
        error,
        entity: {
          thread_id: activeThread.id,
        },
      });
      isIncognito.value = previousValue;
      if (currentThread.value?.id === activeThread.id) {
        currentThread.value.is_incognito = previousValue ? 1 : 0;
      }
    }
  };

  const setWorkspace = async (nextValue: string | null) => {
    const normalizedValue =
      typeof nextValue === 'string' && nextValue.trim().length > 0 ? nextValue.trim() : null;
    const previousValue = selectedWorkspaceId.value;
    const activeThread = currentThread.value;

    selectedWorkspaceId.value = normalizedValue;
    if (activeThread) {
      activeThread.workspace_id = normalizedValue ?? undefined;
    }

    if (!activeThread) return;

    try {
      await deps.electronAPI.chat.threads.update(activeThread.id, {
        workspace_id: normalizedValue,
      });
    } catch (error) {
      chatThreadsLogger.event({
        level: 'error',
        event: 'chat.thread.workspace_update',
        outcome: 'failed',
        error,
        entity: {
          thread_id: activeThread.id,
          workspace_id: normalizedValue,
        },
      });
      selectedWorkspaceId.value = previousValue;
      if (currentThread.value?.id === activeThread.id) {
        currentThread.value.workspace_id = previousValue ?? undefined;
      }
    }
  };

  const handleTaskPush = async (payload: unknown) => {
    if (!isObjectRecord(payload)) return;
    if (payload.type !== 'task-result') return;
    const threadId = typeof payload.threadId === 'string' ? payload.threadId : '';
    if (!threadId) return;

    void refreshThreads();

    if (currentThread.value?.id !== threadId) return;

    const message = (payload as { message?: unknown }).message;
    if (!isObjectRecord(message) || !Array.isArray((message as { parts?: unknown }).parts)) {
      await loadThreadMessages(threadId);
      return;
    }

    const messageId =
      typeof (message as { id?: unknown }).id === 'string' ? (message as { id: string }).id : '';
    if (messageId && deps.messageStore.hasId(messageId)) return;

    deps.messageStore.append(message as unknown as UIMessage);
    deps.scrollToBottom();
  };

  return {
    currentThread,
    currentModel,
    isIncognito,
    selectedWorkspaceId,
    selectedTools,
    showWelcome,
    getCurrentThreadId,
    refreshThreads,
    createNewThread,
    selectThread,
    handleThreadDeleted,
    updateThreadTitle,
    updateThreadTitleById,
    handleNewChat,
    handleModelSelected,
    setIncognito,
    setWorkspace,
    handleAssistantMessagePersisted,
    handleTaskPush,
  };
};
