import { ref, type Ref } from 'vue';
import type { UIMessage } from 'ai';

import { parseStoredUiMessage } from '../modules/chat/ui_message_storage';
import { resetToolUiStateMap } from '../modules/chat/tool_ui_state';
import { extractTextFromMessage } from '../modules/chat/ui_message_text';
import { isObjectRecord } from '../../shared/utils/guards';
import type { ChatMessageStore } from '../modules/chat/chat_message_store';
import type { UiMessagePersistence } from '../modules/chat/ui_message_persistence';

export type ChatThread = {
  id: string;
  title: string;
  model?: string;
};

type ElectronApi = {
  chat: {
    threads: {
      create: (thread: { title: string; model?: string | null; metadata: string }) => Promise<ChatThread>;
      get: (id: string) => Promise<ChatThread | null>;
      update: (id: string, thread: Partial<ChatThread>) => Promise<unknown>;
    };
    messages: {
      list: (threadId: string) => Promise<Array<{ id: string; message: string }>>;
    };
  };
  toolModel: {
    generateTitle: (conversationContent: string) => Promise<string>;
  };
  tasks?: {
    onPush?: (callback: (payload: unknown) => void) => void;
  };
};

type SidebarController = {
  refresh?: () => Promise<void> | void;
  setCurrentThread?: (id: string | null) => void;
};

const TITLE_REGEN_INTERVAL = 2;

export const useChatThreads = (deps: {
  electronAPI: ElectronApi;
  messageStore: ChatMessageStore;
  persistence: UiMessagePersistence;
  sidebarRef: Ref<SidebarController | null>;
  scrollToBottom: () => void;
}) => {
  const currentThread = ref<ChatThread | null>(null);
  const currentModel = ref<string>('');
  const selectedTools = ref<string[]>([]);
  const showWelcome = ref(true);

  const getCurrentThreadId = () => currentThread.value?.id || null;

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
      console.error('Failed to update thread title:', error);
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
      console.error('Failed to update thread title by id:', error);
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
    if (currentTitle === 'New Chat') return true;
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
      console.error('Failed to generate thread title with agent:', error);
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
        title: 'New Chat',
        model: model || null,
        metadata: JSON.stringify({}),
      });
      currentThread.value = thread;
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
      console.error('Failed to create thread:', error);
      return null;
    }
  };

  const loadThreadMessages = async (threadId: string) => {
    try {
      const dbMessages = await deps.electronAPI.chat.messages.list(threadId);
      const rows = Array.isArray(dbMessages)
        ? dbMessages.filter(
            (message): message is { id: string; message: string } =>
              isObjectRecord(message) &&
              typeof message.id === 'string' &&
              typeof message.message === 'string'
          )
        : [];
      deps.persistence.resetPersistedMessageIds(rows.map(row => row.id));

      const chatMessages = rows.map(row => parseStoredUiMessage(row));
      deps.messageStore.setAll(chatMessages as UIMessage[]);
      resetToolUiStateMap();
      deps.scrollToBottom();
    } catch (error) {
      console.error('Failed to load thread messages:', error);
    }
  };

  const selectThread = async (threadId: string) => {
    try {
      if (currentThread.value?.id === threadId) {
        return;
      }

      const thread = await deps.electronAPI.chat.threads.get(threadId);
      if (!thread) {
        console.error('Thread not found:', threadId);
        return;
      }

      currentThread.value = thread;
      showWelcome.value = false;
      await loadThreadMessages(threadId);

      if (deps.sidebarRef.value?.setCurrentThread) {
        deps.sidebarRef.value.setCurrentThread(threadId);
      }
    } catch (error) {
      console.error('Failed to select thread:', error);
    }
  };

  const handleThreadDeleted = async (threadId: string) => {
    if (currentThread.value?.id !== threadId) return;

    currentThread.value = null;
    currentModel.value = '';
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

    deps.messageStore.append(message as UIMessage);
    deps.scrollToBottom();
  };

  return {
    currentThread,
    currentModel,
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
    handleAssistantMessagePersisted,
    handleTaskPush,
  };
};
