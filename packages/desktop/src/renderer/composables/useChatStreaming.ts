import { ref } from 'vue';
import type { Ref } from 'vue';

import type { ChatUiMessage } from '@iki/backend/chat/message_parts';
import type { ElectronApi } from '@iki/backend/types/electron_api';
import { createLogger } from '../logger';
import type { ChatInstance } from '../modules/chat/chat_instance';
import type { ChatMessageStore } from '../modules/chat/chat_message_store';
import type { UiMessagePersistence } from '../modules/chat/ui_message_persistence';
import {
  upsertComposerInvocationIntoMessageParts,
  upsertTextIntoMessageParts,
  extractTextFromMessage,
} from '../modules/chat/ui_message_text';
import type { ChatThread } from '../store/thread_session';
import type {
  PreparedMessageSend,
  PrepareMessageSendPayload,
} from '../modules/chat/chat_prepare_send';
import type { SubmitTurnParams, SubmitTurnResult } from './useChatComposerSend';
import { getErrorMessage } from '@iki/backend/utils/errors';

const chatStreamingLogger = createLogger({ module: 'chat_streaming' });

export const useChatStreaming = (deps: {
  electronAPI: Pick<ElectronApi, 'chat'>;
  chatInstance: ChatInstance;
  messageStore: ChatMessageStore;
  persistence: UiMessagePersistence;
  createMessageId: () => string;
  scrollToBottom: () => void;
  getCurrentThreadId: () => string | null;
  onAssistantMessagePersisted: (params: {
    threadId: string;
    messagesSnapshot: ChatUiMessage[];
  }) => Promise<void>;
  currentThread: Ref<ChatThread | null>;
  currentModel: Ref<string>;
  selectedTools: Ref<string[]>;
  showWelcome: Ref<boolean>;
  createNewThread: (options?: { model?: string }) => Promise<ChatThread | null>;
  clearCurrentThread: () => Promise<ChatThread | null>;
  ensureWorkspaceForCurrentThread: () => Promise<ChatThread | null>;
  selectThread: (threadId: string) => Promise<void>;
  handleThreadDeleted: (threadId: string) => Promise<void>;
  handleNewChat: () => Promise<void>;
}) => {
  const editingUserMessageId = ref<string | null>(null);

  const upsertUiMessage = async (
    message: ChatUiMessage,
    parentId?: string,
    source = 'unknown',
    threadIdOverride?: string
  ) => {
    const threadId = threadIdOverride || deps.currentThread.value?.id || '';
    if (!threadId) return;

    await deps.persistence.upsertUiMessage({
      message,
      threadId,
      parentId,
      source,
    });
  };

  const truncateConversationAfterIndex = async (messageIndex: number) => {
    await deps.persistence.truncateConversationAfterIndex({
      messageStore: deps.messageStore,
      messageIndex,
    });
  };

  const stopActiveStreamIfNeeded = async (targetThreadId?: string) => {
    const boundThreadId = deps.chatInstance.transport.getBoundThreadId();
    if (!boundThreadId) return;
    if (targetThreadId && boundThreadId === targetThreadId) return;

    try {
      deps.chatInstance.transport.detachActiveStream();
      await deps.electronAPI.chat.stopStream();
    } catch (error) {
      chatStreamingLogger.event({
        level: 'warn',
        event: 'chat.stream.stop',
        outcome: 'failed',
        error,
      });
    }
  };

  const resetEditing = () => {
    editingUserMessageId.value = null;
  };

  const selectThread = async (threadId: string) => {
    await stopActiveStreamIfNeeded(threadId);
    await deps.selectThread(threadId);
    resetEditing();
  };

  const handleThreadDeleted = async (threadId: string) => {
    await stopActiveStreamIfNeeded();
    await deps.handleThreadDeleted(threadId);
    resetEditing();
  };

  const handleNewChat = async () => {
    await stopActiveStreamIfNeeded();
    await deps.handleNewChat();
    resetEditing();
  };

  const handleClearCurrentThread = async () => {
    await stopActiveStreamIfNeeded();
    await deps.clearCurrentThread();
    resetEditing();
  };

  const beginEditMessage = async (
    message: ChatUiMessage,
    setDraftMessage: (text: string) => Promise<void>
  ) => {
    if (!message || message.role !== 'user' || typeof message.id !== 'string') return;
    await stopActiveStreamIfNeeded();
    editingUserMessageId.value = message.id;
    const text = extractTextFromMessage(message);
    await setDraftMessage(text);
    deps.scrollToBottom();
  };

  const cancelEditing = (clearDraftMessage: () => Promise<void>) => {
    editingUserMessageId.value = null;
    return clearDraftMessage();
  };

  /**
   * Prepares thread/workspace/model state and builds the user message (and
   * persists it). The message is *not* appended to the store here — the
   * Chat's `sendMessage` owns that, then hands the whole history to the
   * transport.
   */
  const prepareMessageSend = async (
    payload: PrepareMessageSendPayload
  ): Promise<PreparedMessageSend | null> => {
    const { content, model, tools, promptAppId, composerInvocations } = payload;
    const pendingEditMessageId = editingUserMessageId.value;

    if (!deps.currentThread.value) {
      const thread = await deps.createNewThread({ model: model || deps.currentModel.value });
      if (!thread) {
        chatStreamingLogger.event({
          level: 'error',
          event: 'chat.send.prepare',
          outcome: 'failed',
          message: 'Failed to create thread before send.',
        });
        return null;
      }
      resetEditing();
    }

    if (!deps.currentThread.value) {
      chatStreamingLogger.event({
        level: 'error',
        event: 'chat.send.prepare',
        outcome: 'failed',
        message: 'No thread available after send preparation.',
      });
      return null;
    }

    const activeWorkspaceId =
      typeof deps.currentThread.value.workspace_id === 'string' &&
      deps.currentThread.value.workspace_id.trim().length > 0
        ? deps.currentThread.value.workspace_id.trim()
        : '';
    if (!activeWorkspaceId) {
      await deps.ensureWorkspaceForCurrentThread();
    }

    if (model && deps.currentThread.value.model !== model) {
      await deps.electronAPI.chat.threads.update(deps.currentThread.value.id, { model });
      deps.currentThread.value.model = model;
      deps.currentModel.value = model;
    }

    if (
      promptAppId &&
      deps.messageStore.messages.length === 0 &&
      deps.currentThread.value.prompt_app_id !== promptAppId
    ) {
      await deps.electronAPI.chat.threads.update(deps.currentThread.value.id, {
        prompt_app_id: promptAppId,
      });
      deps.currentThread.value.prompt_app_id = promptAppId;
    }

    if (tools) {
      deps.selectedTools.value = tools;
    }

    deps.showWelcome.value = false;

    if (pendingEditMessageId && deps.currentThread.value) {
      await stopActiveStreamIfNeeded();

      const messageIndex = deps.messageStore.findIndexById(pendingEditMessageId);

      if (messageIndex >= 0) {
        const currentUserMessage = deps.messageStore.getAt(messageIndex);
        if (!currentUserMessage) {
          editingUserMessageId.value = null;
        } else {
          const updatedUserMessage: ChatUiMessage = {
            ...currentUserMessage,
            parts: [
              ...(payload.files ?? []),
              ...upsertComposerInvocationIntoMessageParts(
                upsertTextIntoMessageParts(currentUserMessage.parts, content),
                composerInvocations
              ),
            ],
            metadata: payload.audioEmotion
              ? Object.assign({}, currentUserMessage.metadata ?? {}, { audioEmotion: payload.audioEmotion })
              : currentUserMessage.metadata,
          };

          deps.messageStore.replaceAt(messageIndex, updatedUserMessage);
          await upsertUiMessage(
            updatedUserMessage,
            undefined,
            'user-message-edit',
            deps.currentThread.value.id
          );
          await truncateConversationAfterIndex(messageIndex);

          editingUserMessageId.value = null;
          deps.scrollToBottom();
          return {
            threadId: deps.currentThread.value.id,
            editedMessageId: updatedUserMessage.id,
            userMessage: updatedUserMessage,
          };
        }
      }

      editingUserMessageId.value = null;
    }

    const userMessage: ChatUiMessage = {
      id: deps.createMessageId(),
      role: 'user',
      parts: [
        ...(payload.files ?? []),
        ...upsertComposerInvocationIntoMessageParts(
          [{ type: 'text', text: content, state: 'done' }],
          composerInvocations
        ),
      ],
      ...(payload.audioEmotion
        ? { metadata: { audioEmotion: payload.audioEmotion } }
        : {}),
    };

    const threadId = deps.currentThread.value.id;
    await upsertUiMessage(userMessage, undefined, 'user-message', threadId);

    deps.scrollToBottom();
    return {
      threadId,
      userMessage,
    };
  };

  /**
   * Submits the prepared turn through the Chat: `sendMessage` appends the
   * user message, streams the response via the IPC transport into the SDK's
   * UIMessage accumulation, and resolves when the turn settles.
   */
  const submitTurn = async (params: SubmitTurnParams): Promise<SubmitTurnResult> => {
    const { preparedMessageSend, body } = params;
    try {
      const message = preparedMessageSend.editedMessageId
        ? { ...preparedMessageSend.userMessage, messageId: preparedMessageSend.editedMessageId }
        : preparedMessageSend.userMessage;

      await deps.chatInstance.chat.sendMessage(message, { body });

      const chat = deps.chatInstance.chat;
      if (chat.status === 'error') {
        return { ok: false, error: chat.error?.message || 'Chat stream failed' };
      }
      return { ok: true };
    } catch (error) {
      chatStreamingLogger.event({
        level: 'error',
        event: 'chat.send',
        outcome: 'failed',
        error,
      });
      return { ok: false, error: getErrorMessage(error) };
    }
  };

  return {
    chatInstance: deps.chatInstance,
    editingUserMessageId,
    isApprovalProcessing: deps.chatInstance.isApprovalProcessing,
    handleToolApproval: deps.chatInstance.handleToolApproval,
    prepareMessageSend,
    submitTurn,
    stopActiveStreamIfNeeded,
    beginEditMessage,
    cancelEditing,
    selectThread,
    handleThreadDeleted,
    handleNewChat,
    handleClearCurrentThread,
    resetEditing,
  };
};
