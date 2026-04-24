import { ref, watch, type Ref } from 'vue';
import type { ChatUiMessage } from '../../shared/chat/message_parts';

import { toUiMessages } from '../modules/chat/ui_message_convert';
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
import {
  parseJsonRecord,
  parseThreadLlmSelectionState,
} from '../../shared/chat/thread_runtime_hints';

export type ChatThread = StoredChatThread;

type SidebarController = {
  refresh?: () => Promise<void> | void;
  setCurrentThread?: (id: string | null) => void;
};

type DraftComposerSelection = {
  model: string;
  providerId: string | null;
};

const TITLE_REGEN_INTERVAL = 2;
const chatThreadsLogger = createLogger({ module: 'chat_threads' });
const DEFAULT_THREAD_TITLES = new Set([
  translateWithLocale('en', 'chat.thread.newTitle'),
  translateWithLocale('zh-CN', 'chat.thread.newTitle'),
]);

const normalizeWorkspaceId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeModelId = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizeProviderId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const useChatThreads = (deps: {
  electronAPI: Pick<ElectronApi, 'chat' | 'toolModel' | 'tasks'>;
  messageStore: ChatMessageStore;
  persistence: UiMessagePersistence;
  sidebarRef: Ref<SidebarController | null>;
  scrollToBottom: () => void;
  preferredDraftModel?: Pick<Ref<string | null | undefined>, 'value'>;
  preferredDraftProviderId?: Pick<Ref<string | null | undefined>, 'value'>;
  persistDraftModelSelection?: (selection: DraftComposerSelection) => Promise<void> | void;
}) => {
  const readPreferredDraftSelection = (): DraftComposerSelection => ({
    model: normalizeModelId(deps.preferredDraftModel?.value),
    providerId: normalizeProviderId(deps.preferredDraftProviderId?.value),
  });

  const currentThread = ref<ChatThread | null>(null);
  const currentModel = ref<string>(readPreferredDraftSelection().model);
  const currentProviderId = ref<string | null>(readPreferredDraftSelection().providerId);
  const isIncognito = ref(false);
  const selectedWorkspaceId = ref<string | null>(null);
  const selectedTools = ref<string[]>([]);
  const showWelcome = ref(true);

  const getCurrentThreadId = () => currentThread.value?.id || null;

  const syncIncognitoState = (thread: ChatThread | null) => {
    isIncognito.value = Boolean(thread?.is_incognito);
  };

  const syncProviderState = (thread: ChatThread | null) => {
    const providerId = thread ? parseThreadLlmSelectionState(thread.metadata).providerId : undefined;
    currentProviderId.value = providerId ?? null;
  };

  const syncWorkspaceState = (thread: ChatThread | null) => {
    selectedWorkspaceId.value = normalizeWorkspaceId(thread?.workspace_id);
  };

  const restoreDraftComposerSelection = () => {
    if (currentThread.value) return;
    const preferred = readPreferredDraftSelection();
    currentModel.value = preferred.model;
    currentProviderId.value = preferred.providerId;
  };

  const persistDraftComposerSelection = async (selection: DraftComposerSelection) => {
    if (!deps.persistDraftModelSelection) return;

    try {
      await deps.persistDraftModelSelection({
        model: normalizeModelId(selection.model),
        providerId: normalizeProviderId(selection.providerId),
      });
    } catch (error) {
      chatThreadsLogger.event({
        level: 'warn',
        event: 'chat.composer_selection.persist',
        outcome: 'failed',
        error,
      });
    }
  };

  watch(
    () =>
      [
        deps.preferredDraftModel?.value,
        deps.preferredDraftProviderId?.value,
        currentThread.value?.id ?? null,
      ] as const,
    ([, , activeThreadId]) => {
      if (activeThreadId) return;
      restoreDraftComposerSelection();
    },
    { immediate: true }
  );

  const refreshThreads = async () => {
    if (deps.sidebarRef.value?.refresh) {
      await deps.sidebarRef.value.refresh();
    }
  };

  const buildClearedThreadInput = (thread: ChatThread): Partial<ChatThread> => ({
    id: thread.id,
    title: translateWithLocale(getCurrentLocale(), 'chat.thread.newTitle'),
    model: typeof thread.model === 'string' && thread.model.trim() ? thread.model : undefined,
    reasoning_effort:
      typeof thread.reasoning_effort === 'string' && thread.reasoning_effort.trim()
        ? thread.reasoning_effort
        : undefined,
    metadata: typeof thread.metadata === 'string' && thread.metadata.trim() ? thread.metadata : '{}',
    client_id:
      typeof thread.client_id === 'string' && thread.client_id.trim() ? thread.client_id : undefined,
    tools: typeof thread.tools === 'string' && thread.tools.trim() ? thread.tools : undefined,
    is_favorited: thread.is_favorited ? 1 : 0,
    is_incognito: thread.is_incognito ? 1 : 0,
    workspace_id: normalizeWorkspaceId(thread.workspace_id) ?? undefined,
    enable_artifacts: thread.enable_artifacts ? 1 : 0,
    artifact_workspace_id:
      typeof thread.artifact_workspace_id === 'string' && thread.artifact_workspace_id.trim()
        ? thread.artifact_workspace_id
        : undefined,
  });

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

  const getConversationContentForTitle = (messages: ChatUiMessage[]): string => {
    const userLines: string[] = [];
    const fallbackLines: string[] = [];

    for (const message of messages) {
      const text = extractTextFromMessage(message).trim();
      if (!text) continue;

      if (message.role === 'user') {
        userLines.push(`User: ${text}`);
        continue;
      }

      const role = message.role === 'system' ? 'System' : 'Assistant';
      fallbackLines.push(`${role}: ${text}`);
    }

    return (userLines.length > 0 ? userLines : fallbackLines).join('\n');
  };

  const getFallbackThreadTitle = (messages: ChatUiMessage[]): string | null => {
    const latestUserText = [...messages]
      .reverse()
      .filter(message => message.role === 'user')
      .map(message => extractTextFromMessage(message).trim())
      .find(text => text.length > 0);
    const fallbackText = latestUserText || extractTextFromMessage(messages[0]).trim();
    if (!fallbackText) return null;
    return fallbackText.slice(0, 50) + (fallbackText.length > 50 ? '...' : '');
  };

  const shouldRegenerateThreadTitle = (
    messages: ChatUiMessage[],
    currentTitle: string
  ): boolean => {
    const assistantMessageCount = messages.filter(message => message.role === 'assistant').length;
    if (assistantMessageCount === 0) return false;
    if (DEFAULT_THREAD_TITLES.has(currentTitle)) return true;
    return assistantMessageCount % TITLE_REGEN_INTERVAL === 0;
  };

  const generateThreadTitle = async (messages: ChatUiMessage[]): Promise<string | null> => {
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
    messagesSnapshot: ChatUiMessage[];
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
      const draftProviderId = currentProviderId.value;
      const thread = await deps.electronAPI.chat.threads.create({
        title: translateWithLocale(getCurrentLocale(), 'chat.thread.newTitle'),
        model: model || null,
        metadata: JSON.stringify({}),
        is_incognito: isIncognito.value ? 1 : 0,
        workspace_id: selectedWorkspaceId.value,
      });
      currentThread.value = thread;
      currentModel.value = typeof thread.model === 'string' ? thread.model : model || '';
      syncProviderState(thread);
      if (!currentProviderId.value && draftProviderId) {
        currentProviderId.value = draftProviderId;
      }
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
      deps.messageStore.setAll(chatMessages);
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
      syncProviderState(thread);
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
    isIncognito.value = false;
    selectedWorkspaceId.value = null;
    deps.messageStore.clear();
    deps.persistence.resetPersistedMessageIds();
    resetToolUiStateMap();
    showWelcome.value = true;
    restoreDraftComposerSelection();

    if (deps.sidebarRef.value?.setCurrentThread) {
      deps.sidebarRef.value.setCurrentThread(null);
    }
  };

  const handleNewChat = async () => {
    await createNewThread(currentModel.value);
  };

  const clearCurrentThread = async () => {
    const activeThread = currentThread.value;
    if (!activeThread) return null;

    try {
      const recreatedThread = await deps.electronAPI.chat.threads.clear(
        activeThread.id,
        buildClearedThreadInput(activeThread)
      );
      if (!recreatedThread) {
        throw new Error('Thread reset returned no recreated thread');
      }

      currentThread.value = recreatedThread;
      currentModel.value =
        typeof recreatedThread.model === 'string' ? recreatedThread.model : currentModel.value;
      syncProviderState(recreatedThread);
      syncIncognitoState(recreatedThread);
      syncWorkspaceState(recreatedThread);
      deps.messageStore.clear();
      deps.persistence.resetPersistedMessageIds();
      resetToolUiStateMap();
      showWelcome.value = false;

      await refreshThreads();
      if (deps.sidebarRef.value?.setCurrentThread) {
        deps.sidebarRef.value.setCurrentThread(recreatedThread.id);
      }

      return recreatedThread;
    } catch (error) {
      chatThreadsLogger.event({
        level: 'error',
        event: 'chat.thread.clear',
        outcome: 'failed',
        error,
        entity: {
          thread_id: activeThread.id,
        },
      });
      return null;
    }
  };

  const handleModelSelected = (data: { model: string; provider: { id: string; type: string } }) => {
    currentModel.value = data.model;
    currentProviderId.value = data.provider.id;
    void persistDraftComposerSelection({
      model: data.model,
      providerId: data.provider.id,
    });

    if (currentThread.value) {
      const metadata = parseJsonRecord(currentThread.value.metadata);
      const llm = isObjectRecord(metadata.llm) ? metadata.llm : {};
      const updatedMetadata = {
        ...metadata,
        llm: {
          ...llm,
          providerType: data.provider.type,
          providerId: data.provider.id,
          model: data.model,
          updatedAt: new Date().toISOString(),
        },
      };
      const nextMetadata = JSON.stringify(updatedMetadata);
      const threadId = currentThread.value.id;
      currentThread.value.metadata = nextMetadata;
      currentThread.value.model = data.model;
      void deps.electronAPI.chat.threads
        .update(threadId, {
          model: data.model,
          metadata: nextMetadata,
        })
        .catch(error => {
          chatThreadsLogger.event({
            level: 'warn',
            event: 'chat.thread.model_selection_update',
            outcome: 'failed',
            error,
            entity: {
              thread_id: threadId,
            },
          });
        });
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
    const normalizedValue = normalizeWorkspaceId(nextValue);
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

  const ensureWorkspaceForCurrentThread = async () => {
    const activeThread = currentThread.value;
    if (!activeThread) return null;
    if (normalizeWorkspaceId(activeThread.workspace_id)) return activeThread;

    try {
      const refreshedThread = await deps.electronAPI.chat.threads.get(activeThread.id);
      if (!refreshedThread) return activeThread;

      currentThread.value = refreshedThread;
      currentModel.value = typeof refreshedThread.model === 'string' ? refreshedThread.model : '';
      syncProviderState(refreshedThread);
      syncIncognitoState(refreshedThread);
      syncWorkspaceState(refreshedThread);
      return refreshedThread;
    } catch (error) {
      chatThreadsLogger.event({
        level: 'warn',
        event: 'chat.thread.workspace_refresh',
        outcome: 'failed',
        error,
        entity: {
          thread_id: activeThread.id,
        },
      });
      return activeThread;
    }
  };

  const handleTaskPush = async (payload: unknown) => {
    await handleThreadResultPush(payload, 'task-result');
  };

  const handleAwaiterPush = async (payload: unknown) => {
    await handleThreadResultPush(payload, 'awaiter-result');
  };

  const handleThreadResultPush = async (payload: unknown, expectedType: string) => {
    if (!isObjectRecord(payload)) return;
    if (payload.type !== expectedType) return;
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

    const [normalizedMessage] = toUiMessages([message]);
    if (!normalizedMessage) {
      await loadThreadMessages(threadId);
      return;
    }

    deps.messageStore.append(normalizedMessage);
    deps.scrollToBottom();
  };

  return {
    currentThread,
    currentModel,
    currentProviderId,
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
    clearCurrentThread,
    handleModelSelected,
    setIncognito,
    setWorkspace,
    ensureWorkspaceForCurrentThread,
    handleAssistantMessagePersisted,
    handleTaskPush,
    handleAwaiterPush,
  };
};
