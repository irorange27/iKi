import { defineStore } from 'pinia';
import { ref, watch, type Ref } from 'vue';

import type { ChatUiMessage } from '@iki/backend/chat/message_parts';

import { toUiMessages } from '../modules/chat/ui_message_convert';
import { parseStoredUiMessage } from '../modules/chat/ui_message_storage';
import { resetToolUiStateMap } from '../modules/chat/tool_ui_state';
import { extractTextFromMessage } from '../modules/chat/ui_message_text';
import { isObjectRecord } from '@iki/backend/utils/guards';
import type { ChatMessage, ChatThread as StoredChatThread } from '@iki/backend/types/chat';
import type { ElectronApi } from '@iki/backend/types/electron_api';
import { createLogger } from '../logger';
import { getCurrentLocale, translateWithLocale } from '../i18n';
import type { ChatMessageStore } from '../modules/chat/chat_message_store';
import type { UiMessagePersistence } from '../modules/chat/ui_message_persistence';
import {
  parseJsonRecord,
  parseThreadLlmSelectionState,
} from '@iki/backend/chat/thread_runtime_hints';
import { normalizePersonality } from '@iki/backend/chat/personality';
import {
  parseApprovalPolicy,
  THREAD_APPROVAL_POLICY_KEY,
  type ThreadApprovalPolicy,
} from '@iki/backend/workspaces/thread_mode';
import type { ThreadWorkMode } from '@iki/backend/workspaces/thread_mode';

export type ChatThread = StoredChatThread;

type SidebarController = {
  refresh?: () => Promise<void> | void;
  setCurrentThread?: (id: string | null) => void;
};

type DraftComposerSelection = {
  model: string;
  providerId: string | null;
};

/**
 * Non-serializable runtime collaborators, injected once by the chat view.
 * Everything else lives in pinia state so composer components can read/write
 * thread-scoped preferences directly instead of prop-drilling through
 * ChatView -> ChatInput -> selectors.
 */
type ThreadSessionRuntime = {
  electronAPI: Pick<ElectronApi, 'chat' | 'toolModel' | 'tasks'>;
  messageStore: ChatMessageStore;
  persistence: UiMessagePersistence;
  sidebarRef: Ref<SidebarController | null>;
  scrollToBottom: () => void;
  preferredDraftModel?: Pick<Ref<string | null | undefined>, 'value'>;
  preferredDraftProviderId?: Pick<Ref<string | null | undefined>, 'value'>;
  persistDraftModelSelection?: (selection: DraftComposerSelection) => Promise<void> | void;
};

const TITLE_REGEN_INTERVAL = 2;
const TITLE_FORCE_REGEN_LIMIT = 5;
const threadSessionLogger = createLogger({ module: 'thread_session_store' });
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

export const useThreadSessionStore = defineStore('threadSession', () => {
  // ── State ────────────────────────────────────────────────────────────
  const currentThread = ref<ChatThread | null>(null);
  const currentModel = ref('');
  const currentProviderId = ref<string | null>(null);
  const currentReasoningEffort = ref('');
  const currentPersonality = ref('');
  const currentApprovalPolicy = ref<ThreadApprovalPolicy | ''>('');
  const isIncognito = ref(false);
  const selectedWorkspaceId = ref<string | null>(null);
  const selectedTools = ref<string[]>([]);
  const showWelcome = ref(!localStorage.getItem('iki-welcome-seen'));

  // ── Runtime (injected once) ─────────────────────────────────────────
  let runtime: ThreadSessionRuntime | null = null;
  const initRuntime = (deps: ThreadSessionRuntime) => {
    runtime = deps;
    // Registered here (not in setup) because the watched sources live on the
    // injected refs; a plain closure variable is not reactive on its own.
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
  };

  const requireRuntime = (): ThreadSessionRuntime => {
    if (!runtime) {
      throw new Error('Thread session runtime not initialized; call initRuntime first.');
    }
    return runtime;
  };

  // ── Draft selection helpers ─────────────────────────────────────────
  const readPreferredDraftSelection = (): DraftComposerSelection => ({
    model: normalizeModelId(runtime?.preferredDraftModel?.value),
    providerId: normalizeProviderId(runtime?.preferredDraftProviderId?.value),
  });

  const dismissWelcome = () => {
    showWelcome.value = false;
    localStorage.setItem('iki-welcome-seen', '1');
  };

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

  const syncReasoningEffortState = (thread: ChatThread | null) => {
    currentReasoningEffort.value =
      typeof thread?.reasoning_effort === 'string' ? thread.reasoning_effort.trim().toLowerCase() : '';
  };

  const syncPersonalityState = (thread: ChatThread | null) => {
    const metadata = thread ? parseJsonRecord(thread.metadata) : {};
    currentPersonality.value = normalizePersonality(metadata.personality) ?? '';
  };

  const syncApprovalPolicyState = (thread: ChatThread | null) => {
    const metadata = thread ? parseJsonRecord(thread.metadata) : {};
    currentApprovalPolicy.value = parseApprovalPolicy(metadata[THREAD_APPROVAL_POLICY_KEY]) ?? '';
  };

  const restoreDraftComposerSelection = () => {
    if (currentThread.value) return;
    const preferred = readPreferredDraftSelection();
    currentModel.value = preferred.model;
    currentProviderId.value = preferred.providerId;
  };

  const persistDraftComposerSelection = async (selection: DraftComposerSelection) => {
    if (!runtime?.persistDraftModelSelection) return;

    try {
      await runtime.persistDraftModelSelection({
        model: normalizeModelId(selection.model),
        providerId: normalizeProviderId(selection.providerId),
      });
    } catch (error) {
      threadSessionLogger.event({
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
        runtime?.preferredDraftModel?.value,
        runtime?.preferredDraftProviderId?.value,
        currentThread.value?.id ?? null,
      ] as const,
    ([, , activeThreadId]) => {
      if (activeThreadId) return;
      restoreDraftComposerSelection();
    },
    { immediate: true }
  );

  const refreshThreads = async () => {
    if (runtime?.sidebarRef.value?.refresh) {
      await runtime.sidebarRef.value.refresh();
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
    const { electronAPI } = requireRuntime();
    if (!currentThread.value) return;
    if (currentThread.value.title === title) return;

    try {
      await electronAPI.chat.threads.update(currentThread.value.id, { title });
      if (currentThread.value) {
        currentThread.value.title = title;
      }
      await refreshThreads();
    } catch (error) {
      threadSessionLogger.event({
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
    const { electronAPI } = requireRuntime();
    if (!threadId || !title.trim()) return;

    if (currentThread.value?.id === threadId) {
      await updateThreadTitle(title);
      return;
    }

    try {
      await electronAPI.chat.threads.update(threadId, { title });
      await refreshThreads();
    } catch (error) {
      threadSessionLogger.event({
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
    const lines: string[] = [];

    for (const message of messages) {
      const text = extractTextFromMessage(message).trim();
      if (!text) continue;

      if (message.role === 'user') {
        lines.push(`User: ${text}`);
      } else if (message.role === 'assistant') {
        const truncated = text.length > 300 ? text.slice(0, 297) + '...' : text;
        lines.push(`Assistant: ${truncated}`);
      }
    }

    return lines.join('\n');
  };

  const getFallbackThreadTitle = (messages: ChatUiMessage[]): string | null => {
    const userTexts = [...messages]
      .reverse()
      .filter(message => message.role === 'user')
      .map(message => extractTextFromMessage(message).trim())
      .filter(text => text.length > 0);
    // Prefer a substantive message (over 10 chars) for better fallback titles.
    const bestText = userTexts.find(text => text.length > 10) ?? userTexts[0];
    if (!bestText) return null;
    return bestText.slice(0, 50) + (bestText.length > 50 ? '...' : '');
  };

  const shouldRegenerateThreadTitle = (
    messages: ChatUiMessage[],
    currentTitle: string
  ): boolean => {
    const assistantMessageCount = messages.filter(message => message.role === 'assistant').length;
    if (assistantMessageCount === 0) return false;
    if (DEFAULT_THREAD_TITLES.has(currentTitle)) return true;
    // Regenerate on every turn for the first N assistant messages so the title
    // converges quickly; afterward fall back to periodic updates.
    if (assistantMessageCount <= TITLE_FORCE_REGEN_LIMIT) return true;
    return assistantMessageCount % Math.max(TITLE_REGEN_INTERVAL, 2) === 0;
  };

  const generateThreadTitle = async (messages: ChatUiMessage[]): Promise<string | null> => {
    const { electronAPI } = requireRuntime();
    try {
      const conversationContent = getConversationContentForTitle(messages);
      if (!conversationContent.trim()) {
        return getFallbackThreadTitle(messages);
      }

      const title = await electronAPI.toolModel.generateTitle(conversationContent);
      return title || getFallbackThreadTitle(messages);
    } catch (error) {
      threadSessionLogger.event({
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

  const createNewThread = async (options?: {
    model?: string;
    mode?: ThreadWorkMode;
    workspaceId?: string | null;
  }) => {
    const { electronAPI, messageStore, persistence, sidebarRef } = requireRuntime();
    const mode: ThreadWorkMode = options?.mode === 'work' ? 'work' : 'chat';
    const model = options?.model;
    try {
      const draftProviderId = currentProviderId.value;
      const draftEffort = currentReasoningEffort.value;
      const draftPersonality = currentPersonality.value;
      const metadata: Record<string, unknown> = { mode };
      if (draftPersonality) metadata.personality = draftPersonality;
      const thread = await electronAPI.chat.threads.create({
        title: translateWithLocale(getCurrentLocale(), 'chat.thread.newTitle'),
        model: model || null,
        reasoning_effort: draftEffort || null,
        metadata: JSON.stringify(metadata),
        is_incognito: isIncognito.value ? 1 : 0,
        workspace_id: mode === 'work' ? options?.workspaceId ?? null : null,
      });
      currentThread.value = thread;
      currentModel.value = typeof thread.model === 'string' ? thread.model : model || '';
      syncProviderState(thread);
      if (!currentProviderId.value && draftProviderId) {
        currentProviderId.value = draftProviderId;
      }
      syncIncognitoState(thread);
      syncWorkspaceState(thread);
      syncReasoningEffortState(thread);
      syncPersonalityState(thread);
      messageStore.clear();
      persistence.resetPersistedMessageIds();
      resetToolUiStateMap();
      showWelcome.value = false;

      if (sidebarRef.value?.refresh) {
        await sidebarRef.value.refresh();
      }
      if (sidebarRef.value?.setCurrentThread) {
        sidebarRef.value.setCurrentThread(thread.id);
      }

      return thread;
    } catch (error) {
      threadSessionLogger.event({
        level: 'error',
        event: 'chat.thread.create',
        outcome: 'failed',
        error,
      });
      return null;
    }
  };

  const loadThreadMessages = async (threadId: string) => {
    const { electronAPI, messageStore, persistence, scrollToBottom } = requireRuntime();
    try {
      const dbMessages = await electronAPI.chat.messages.list(threadId);

      // Discard if the active thread changed while loading
      if (currentThread.value?.id !== threadId) return;

      const rows = Array.isArray(dbMessages)
        ? dbMessages.filter(
            (message): message is ChatMessage =>
              isObjectRecord(message) &&
              typeof message.id === 'string' &&
              typeof message.thread_id === 'string' &&
              typeof message.message === 'string'
          )
        : [];
      persistence.resetPersistedMessageIds(rows.map(row => row.id));

      const chatMessages = rows.map(row => parseStoredUiMessage(row));
      messageStore.setAll(chatMessages);
      resetToolUiStateMap();
      scrollToBottom();
    } catch (error) {
      threadSessionLogger.event({
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
    const { electronAPI, sidebarRef } = requireRuntime();
    try {
      if (currentThread.value?.id === threadId) {
        return;
      }

      const thread = await electronAPI.chat.threads.get(threadId);
      if (!thread) {
        threadSessionLogger.event({
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
      syncReasoningEffortState(thread);
      syncPersonalityState(thread);
      syncApprovalPolicyState(thread);
      showWelcome.value = false;
      await loadThreadMessages(threadId);

      if (sidebarRef.value?.setCurrentThread) {
        sidebarRef.value.setCurrentThread(threadId);
      }
    } catch (error) {
      threadSessionLogger.event({
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
    const { messageStore, persistence, sidebarRef } = requireRuntime();
    if (currentThread.value?.id !== threadId) return;

    currentThread.value = null;
    isIncognito.value = false;
    currentReasoningEffort.value = '';
    currentPersonality.value = '';
    currentApprovalPolicy.value = '';
    selectedWorkspaceId.value = null;
    messageStore.clear();
    persistence.resetPersistedMessageIds();
    resetToolUiStateMap();
    showWelcome.value = true;
    restoreDraftComposerSelection();

    if (sidebarRef.value?.setCurrentThread) {
      sidebarRef.value.setCurrentThread(null);
    }
  };

  const handleNewChat = async () => {
    await createNewThread({ model: currentModel.value, mode: 'chat' });
  };

  const clearCurrentThread = async () => {
    const { electronAPI, messageStore, persistence, sidebarRef } = requireRuntime();
    const activeThread = currentThread.value;
    if (!activeThread) return null;

    try {
      const recreatedThread = await electronAPI.chat.threads.clear(
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
      syncReasoningEffortState(recreatedThread);
      syncPersonalityState(recreatedThread);
      messageStore.clear();
      persistence.resetPersistedMessageIds();
      resetToolUiStateMap();
      showWelcome.value = false;

      await refreshThreads();
      if (sidebarRef.value?.setCurrentThread) {
        sidebarRef.value.setCurrentThread(recreatedThread.id);
      }

      return recreatedThread;
    } catch (error) {
      threadSessionLogger.event({
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
    const previousModel = currentModel.value;
    const previousProviderId = currentProviderId.value;

    currentModel.value = data.model;
    currentProviderId.value = data.provider.id;
    void persistDraftComposerSelection({
      model: data.model,
      providerId: data.provider.id,
    });

    if (currentThread.value) {
      const metadata = parseJsonRecord(currentThread.value.metadata);
      const llm = isObjectRecord(metadata.llm) ? metadata.llm : {};
      const previousMetadata = currentThread.value.metadata;
      const previousThreadModel = currentThread.value.model;
      const threadId = currentThread.value.id;
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
      currentThread.value = { ...currentThread.value, metadata: nextMetadata, model: data.model };
      void requireRuntime()
        .electronAPI.chat.threads.update(threadId, {
          model: data.model,
          metadata: nextMetadata,
        })
        .catch(error => {
          threadSessionLogger.event({
            level: 'warn',
            event: 'chat.thread.model_selection_update',
            outcome: 'failed',
            error,
            entity: {
              thread_id: threadId,
            },
          });
          // Rollback optimistic mutations on IPC failure, only if no newer selection has been made
          if (currentModel.value === data.model) {
            currentModel.value = previousModel;
            currentProviderId.value = previousProviderId;
            void persistDraftComposerSelection({
              model: previousModel,
              providerId: previousProviderId,
            });
          }
          if (currentThread.value?.id === threadId) {
            if (currentThread.value.model === data.model) {
              currentThread.value = {
                ...currentThread.value,
                metadata: previousMetadata,
                model: previousThreadModel,
              };
            }
          }
        });
    }
  };

  const setIncognito = async (nextValue: boolean) => {
    const normalizedValue = Boolean(nextValue);
    const previousValue = isIncognito.value;
    const activeThread = currentThread.value;

    isIncognito.value = normalizedValue;
    if (activeThread) {
      currentThread.value = { ...activeThread, is_incognito: normalizedValue ? 1 : 0 };
    }

    if (!activeThread) return;
    const { electronAPI } = requireRuntime();

    try {
      await electronAPI.chat.threads.update(activeThread.id, {
        is_incognito: normalizedValue ? 1 : 0,
      });
    } catch (error) {
      threadSessionLogger.event({
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
        currentThread.value = { ...currentThread.value, is_incognito: previousValue ? 1 : 0 };
      }
    }
  };

  const setWorkspace = async (nextValue: string | null) => {
    const normalizedValue = normalizeWorkspaceId(nextValue);
    const previousValue = selectedWorkspaceId.value;
    const activeThread = currentThread.value;

    selectedWorkspaceId.value = normalizedValue;
    if (activeThread) {
      currentThread.value = { ...activeThread, workspace_id: normalizedValue ?? undefined };
    }

    if (!activeThread) return;
    const { electronAPI } = requireRuntime();

    try {
      await electronAPI.chat.threads.update(activeThread.id, {
        workspace_id: normalizedValue,
      });
    } catch (error) {
      threadSessionLogger.event({
        level: 'warn',
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
        currentThread.value = { ...currentThread.value, workspace_id: previousValue ?? undefined };
      }
    }
  };

  const setReasoningEffort = async (nextValue: string | null) => {
    const normalizedValue =
      typeof nextValue === 'string' ? nextValue.trim().toLowerCase() : '';
    const previousValue = currentReasoningEffort.value;
    const activeThread = currentThread.value;

    currentReasoningEffort.value = normalizedValue;
    if (activeThread) {
      currentThread.value = {
        ...activeThread,
        reasoning_effort: normalizedValue || undefined,
      };
    }

    if (!activeThread) return;
    const { electronAPI } = requireRuntime();

    try {
      await electronAPI.chat.threads.update(activeThread.id, {
        reasoning_effort: normalizedValue || null,
      });
    } catch (error) {
      threadSessionLogger.event({
        level: 'warn',
        event: 'chat.thread.reasoning_effort_update',
        outcome: 'failed',
        error,
        entity: {
          thread_id: activeThread.id,
        },
      });
      currentReasoningEffort.value = previousValue;
      if (currentThread.value?.id === activeThread.id) {
        currentThread.value = {
          ...currentThread.value,
          reasoning_effort: previousValue || undefined,
        };
      }
    }
  };

  const setPersonality = async (nextValue: string) => {
    const normalizedValue = normalizePersonality(nextValue) ?? '';
    const activeThread = currentThread.value;
    if (!activeThread || currentPersonality.value === normalizedValue) return;
    const { electronAPI } = requireRuntime();

    const metadata = parseJsonRecord(activeThread.metadata);
    const previousMetadata = activeThread.metadata;
    const nextMetadata = JSON.stringify({ ...metadata, personality: normalizedValue });

    currentPersonality.value = normalizedValue;
    currentThread.value = { ...activeThread, metadata: nextMetadata };

    try {
      await electronAPI.chat.threads.update(activeThread.id, { metadata: nextMetadata });
    } catch (error) {
      threadSessionLogger.event({
        level: 'warn',
        event: 'chat.thread.personality_update',
        outcome: 'failed',
        error,
        entity: {
          thread_id: activeThread.id,
        },
      });
      if (currentThread.value?.id === activeThread.id) {
        currentThread.value = { ...currentThread.value, metadata: previousMetadata };
        syncPersonalityState(currentThread.value);
      }
    }
  };

  const setApprovalPolicy = async (nextValue: string) => {
    const normalizedValue = parseApprovalPolicy(nextValue);
    const activeThread = currentThread.value;
    if (!activeThread) return;
    const previousValue = parseApprovalPolicy(
      parseJsonRecord(activeThread.metadata)[THREAD_APPROVAL_POLICY_KEY]
    );
    if (previousValue === normalizedValue) return;

    const metadata = parseJsonRecord(activeThread.metadata);
    const previousMetadata = activeThread.metadata;
    const nextMetadata = JSON.stringify({
      ...metadata,
      [THREAD_APPROVAL_POLICY_KEY]: normalizedValue ?? '',
    });

    currentApprovalPolicy.value = normalizedValue ?? '';
    currentThread.value = { ...activeThread, metadata: nextMetadata };

    try {
      await requireRuntime().electronAPI.chat.threads.update(activeThread.id, {
        metadata: nextMetadata,
      });
    } catch (error) {
      threadSessionLogger.event({
        level: 'warn',
        event: 'chat.thread.approval_policy_update',
        outcome: 'failed',
        error,
        entity: {
          thread_id: activeThread.id,
        },
      });
      if (currentThread.value?.id === activeThread.id) {
        currentThread.value = { ...currentThread.value, metadata: previousMetadata };
        syncApprovalPolicyState(currentThread.value);
      }
    }
  };

  const ensureWorkspaceForCurrentThread = async () => {
    const { electronAPI } = requireRuntime();
    const activeThread = currentThread.value;
    if (!activeThread) return null;
    if (normalizeWorkspaceId(activeThread.workspace_id)) return activeThread;

    try {
      const refreshedThread = await electronAPI.chat.threads.get(activeThread.id);
      if (!refreshedThread) return activeThread;

      currentThread.value = refreshedThread;
      currentModel.value = typeof refreshedThread.model === 'string' ? refreshedThread.model : '';
      syncProviderState(refreshedThread);
      syncIncognitoState(refreshedThread);
      syncWorkspaceState(refreshedThread);
      syncReasoningEffortState(refreshedThread);
      syncPersonalityState(refreshedThread);
      return refreshedThread;
    } catch (error) {
      threadSessionLogger.event({
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

  const handleThreadResultPush = async (payload: unknown, expectedType: string) => {
    const { messageStore, scrollToBottom } = requireRuntime();
    if (!isObjectRecord(payload)) return;
    if (payload.type !== expectedType) return;
    const threadId = typeof payload.threadId === 'string' ? payload.threadId : '';
    if (!threadId) return;

    if (currentThread.value?.id !== threadId) return;

    const message = (payload as { message?: unknown }).message;
    if (!isObjectRecord(message) || !Array.isArray((message as { parts?: unknown }).parts)) {
      await loadThreadMessages(threadId);
      void refreshThreads();
      return;
    }

    const messageId =
      typeof (message as { id?: unknown }).id === 'string' ? (message as { id: string }).id : '';
    if (messageId && messageStore.hasId(messageId)) return;

    const [normalizedMessage] = toUiMessages([message]);
    if (!normalizedMessage) {
      await loadThreadMessages(threadId);
      void refreshThreads();
      return;
    }

    messageStore.append(normalizedMessage);
    scrollToBottom();
    void refreshThreads();
  };

  const handleTaskPush = async (payload: unknown) => {
    await handleThreadResultPush(payload, 'task-result');
  };

  const handleAwaiterPush = async (payload: unknown) => {
    await handleThreadResultPush(payload, 'awaiter-result');
  };

  return {
    // state
    currentThread,
    currentModel,
    currentProviderId,
    currentReasoningEffort,
    currentPersonality,
    currentApprovalPolicy,
    isIncognito,
    selectedWorkspaceId,
    selectedTools,
    showWelcome,
    // runtime
    initRuntime,
    // actions
    dismissWelcome,
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
    setReasoningEffort,
    setPersonality,
    setApprovalPolicy,
    ensureWorkspaceForCurrentThread,
    handleAssistantMessagePersisted,
    handleTaskPush,
    handleAwaiterPush,
  };
});
