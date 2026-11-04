import { defineStore } from 'pinia';
import { ref, watch, type Ref } from 'vue';

import { toUiMessages } from '../modules/chat/ui_message_convert';
import { parseStoredUiMessage } from '../modules/chat/ui_message_storage';
import { resetToolUiStateMap } from '../modules/chat/tool_ui_state';
import { isObjectRecord } from '@iki/backend/utils/guards';
import type { ChatThread as StoredChatThread } from '@iki/backend/types/chat';
import type { ChatUiMessage } from '@iki/backend/message/message_parts';
import type { ElectronApi } from '@iki/backend/types/electron_api';
import { createLogger } from '../logger';
import { getCurrentLocale, translateWithLocale } from '../i18n';
import type { ChatMessageStore } from '../modules/chat/chat_message_store';
import {
  parseJsonRecord,
  parseThreadLlmSelectionState,
} from '@iki/backend/message/thread_runtime_hints';
import { normalizePersonality } from '@iki/backend/message/personality';
import {
  parseApprovalPolicy,
  THREAD_APPROVAL_POLICY_KEY,
  type ApprovalPolicy,
  type ThreadWorkMode,
} from '@iki/backend/workspaces/thread_mode';
import {
  isThreadPrivateWorkspaceId,
  normalizeModelId,
  normalizeProviderId,
  normalizeWorkspaceId,
} from './thread_session/normalize';
import { createThreadTitleActions } from './thread_session/thread_title';

export type ChatThread = StoredChatThread;

type DraftComposerSelection = {
  model: string;
  providerId: string | null;
};

type ThreadSessionRuntime = {
  electronAPI: Pick<ElectronApi, 'chat' | 'toolModel'>;
  messageStore: ChatMessageStore;
  scrollToBottom: () => void;
  preferredDraftModel?: Pick<Ref<string | null | undefined>, 'value'>;
  preferredDraftProviderId?: Pick<Ref<string | null | undefined>, 'value'>;
  persistDraftModelSelection?: (selection: DraftComposerSelection) => Promise<void> | void;
};

const threadSessionLogger = createLogger({ module: 'thread_session_store' });

export const useThreadSessionStore = defineStore('threadSession', () => {
  const currentThread = ref<ChatThread | null>(null);
  const currentModel = ref('');
  const currentProviderId = ref<string | null>(null);
  const currentReasoningEffort = ref('');
  const currentPersonality = ref('');
  const currentApprovalPolicy = ref<ApprovalPolicy | ''>('');
  const isIncognito = ref(false);
  const selectedWorkspaceId = ref<string | null>(null);
  const showWelcome = ref(!localStorage.getItem('iki-welcome-seen'));

  let runtime: ThreadSessionRuntime | null = null;
  const initRuntime = (deps: ThreadSessionRuntime) => {
    runtime = deps;
    // Registered here (not at store creation) so the getter can track the
    // draft-preference refs once they exist; the store body cannot.
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
    const providerId = thread
      ? parseThreadLlmSelectionState(thread.metadata).providerId
      : undefined;
    currentProviderId.value = providerId ?? null;
  };

  const syncWorkspaceState = (thread: ChatThread | null) => {
    selectedWorkspaceId.value = normalizeWorkspaceId(thread?.workspace_id);
  };

  const syncReasoningEffortState = (thread: ChatThread | null) => {
    currentReasoningEffort.value =
      typeof thread?.reasoning_effort === 'string'
        ? thread.reasoning_effort.trim().toLowerCase()
        : '';
  };

  const syncPersonalityState = (thread: ChatThread | null) => {
    const metadata = thread ? parseJsonRecord(thread.metadata) : {};
    currentPersonality.value = normalizePersonality(metadata.personality) ?? '';
  };

  const syncApprovalPolicyState = (thread: ChatThread | null) => {
    const metadata = thread ? parseJsonRecord(thread.metadata) : {};
    currentApprovalPolicy.value =
      parseApprovalPolicy(metadata[THREAD_APPROVAL_POLICY_KEY]) ?? 'askRisky';
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

  const threadListRevision = ref(0);
  const refreshThreads = async () => {
    threadListRevision.value += 1;
  };

  const {
    buildClearedThreadInput,
    updateThreadTitle,
    updateThreadTitleById,
    handleAssistantMessagePersisted,
  } = createThreadTitleActions({ requireRuntime, currentThread, refreshThreads });

  const createNewThread = async (options?: {
    model?: string;
    mode?: ThreadWorkMode;
    workspaceId?: string | null;
  }) => {
    const { electronAPI, messageStore } = requireRuntime();
    const mode: ThreadWorkMode = options?.mode === 'work' ? 'work' : 'chat';
    const model = options?.model;
    try {
      const draftProviderId = currentProviderId.value;
      const draftEffort = currentReasoningEffort.value;
      const draftPersonality = currentPersonality.value;
      const metadata: Record<string, unknown> = { mode };
      if (draftPersonality) metadata.personality = draftPersonality;
      metadata[THREAD_APPROVAL_POLICY_KEY] = currentApprovalPolicy.value || 'askRisky';
      const thread = await electronAPI.chat.threads.create({
        title: translateWithLocale(getCurrentLocale(), 'chat.thread.newTitle'),
        model: model || null,
        reasoning_effort: draftEffort || null,
        metadata: JSON.stringify(metadata),
        is_incognito: isIncognito.value ? 1 : 0,
        workspace_id:
          options?.workspaceId ??
          (() => {
            const draftWorkspaceId = normalizeWorkspaceId(selectedWorkspaceId.value);
            return draftWorkspaceId && !isThreadPrivateWorkspaceId(draftWorkspaceId)
              ? draftWorkspaceId
              : null;
          })(),
      });
      currentThread.value = thread;
      currentModel.value = typeof thread.model === 'string' ? thread.model : model || '';
      syncProviderState(thread);
      if (!currentProviderId.value && draftProviderId) {
        currentProviderId.value = draftProviderId;
      }
      syncIncognitoState(thread);
      syncWorkspaceState(thread);
      syncApprovalPolicyState(thread);
      syncReasoningEffortState(thread);
      syncPersonalityState(thread);
      messageStore.clear();
      resetToolUiStateMap();
      showWelcome.value = false;

      await refreshThreads();

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
    const { electronAPI, messageStore, scrollToBottom } = requireRuntime();
    try {
      const dbMessages = await electronAPI.chat.messages.list(threadId);

      if (currentThread.value?.id !== threadId) return;

      // The session-log rebuild crosses the IPC as structured messages; the
      // codec's normalizer is the defensive boundary, not a row parser.
      const chatMessages = (Array.isArray(dbMessages) ? dbMessages : [])
        .map(message => parseStoredUiMessage(message))
        .filter((message): message is ChatUiMessage => message !== null && message.id !== '');
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
    const { electronAPI } = requireRuntime();
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
      syncApprovalPolicyState(thread);
      syncReasoningEffortState(thread);
      syncPersonalityState(thread);
      showWelcome.value = false;
      await loadThreadMessages(threadId);
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
    const { messageStore } = requireRuntime();
    if (currentThread.value?.id !== threadId) return;

    currentThread.value = null;
    isIncognito.value = false;
    currentReasoningEffort.value = '';
    currentPersonality.value = '';
    currentApprovalPolicy.value = '';
    selectedWorkspaceId.value = null;
    messageStore.clear();
    resetToolUiStateMap();
    showWelcome.value = true;
    restoreDraftComposerSelection();
  };

  const handleNewChat = async () => {
    const workspaceId = normalizeWorkspaceId(selectedWorkspaceId.value);
    const inheritProject = workspaceId !== null && !isThreadPrivateWorkspaceId(workspaceId);
    return createNewThread({
      model: currentModel.value,
      mode: inheritProject ? 'work' : 'chat',
      workspaceId: inheritProject ? workspaceId : null,
    });
  };

  const clearCurrentThread = async () => {
    const { electronAPI, messageStore } = requireRuntime();
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
      resetToolUiStateMap();
      showWelcome.value = false;

      await refreshThreads();

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
    const normalizedValue = typeof nextValue === 'string' ? nextValue.trim().toLowerCase() : '';
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
    if (!activeThread) {
      currentApprovalPolicy.value = normalizedValue ?? '';
      return;
    }
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

  const handleAwaiterPush = async (payload: unknown) => {
    await handleThreadResultPush(payload, 'awaiter-result');
  };

  return {
    threadListRevision,
    currentThread,
    currentModel,
    currentProviderId,
    currentReasoningEffort,
    currentPersonality,
    currentApprovalPolicy,
    isIncognito,
    selectedWorkspaceId,
    showWelcome,
    initRuntime,
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
    handleAwaiterPush,
  };
});
