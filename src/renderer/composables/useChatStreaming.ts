import { ref } from 'vue';
import type { Ref } from 'vue';

import { createChatUiStreamController } from '../modules/chat/ui_stream_controller';
import type { ChatMessageStore } from '../modules/chat/chat_message_store';
import type { UiMessagePersistence } from '../modules/chat/ui_message_persistence';
import {
  upsertTextIntoMessageParts,
  extractTextFromMessage,
} from '../modules/chat/ui_message_text';
import type { ChatUiMessage } from '../../shared/chat/message_parts';
import type { ElectronApi } from '../../shared/types/electron_api';
import { createLogger } from '../logger';
import type { ChatThread } from './useChatThreads';

const chatStreamingLogger = createLogger({ module: 'chat_streaming' });

export type PreparedMessageSend = {
  threadId: string;
  messagesSnapshot: ChatUiMessage[];
};

type PrepareMessageSendPayload = {
  content: string;
  model?: string;
  tools?: string[];
  mcpServerIds?: string[];
};

export const useChatStreaming = (deps: {
  electronAPI: Pick<ElectronApi, 'chat'>;
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
  createNewThread: (model?: string) => Promise<ChatThread | null>;
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

  const streamController = createChatUiStreamController({
    messageStore: deps.messageStore,
    electronAPI: deps.electronAPI,
    persistence: deps.persistence,
    createMessageId: deps.createMessageId,
    scrollToBottom: deps.scrollToBottom,
    getCurrentThreadId: deps.getCurrentThreadId,
    onAssistantMessagePersisted: deps.onAssistantMessagePersisted,
  });

  const resetEditing = () => {
    editingUserMessageId.value = null;
  };

  const resetStreamState = () => {
    streamController.resetTransientState();
  };

  const selectThread = async (threadId: string) => {
    await streamController.stopActiveStreamIfNeeded(threadId);
    await deps.selectThread(threadId);
    resetEditing();
    resetStreamState();
  };

  const handleThreadDeleted = async (threadId: string) => {
    await streamController.stopActiveStreamIfNeeded();
    await deps.handleThreadDeleted(threadId);
    resetEditing();
    resetStreamState();
  };

  const handleNewChat = async () => {
    await streamController.stopActiveStreamIfNeeded();
    await deps.handleNewChat();
    resetEditing();
    resetStreamState();
  };

  const beginEditMessage = async (
    message: ChatUiMessage,
    setDraftMessage: (text: string) => Promise<void>
  ) => {
    if (!message || message.role !== 'user' || typeof message.id !== 'string') return;
    await streamController.stopActiveStreamIfNeeded();
    editingUserMessageId.value = message.id;
    const text = extractTextFromMessage(message);
    await setDraftMessage(text);
    deps.scrollToBottom();
  };

  const cancelEditing = async (clearDraftMessage: () => Promise<void>) => {
    editingUserMessageId.value = null;
    await clearDraftMessage();
  };

  const prepareMessageSend = async (
    payload: PrepareMessageSendPayload
  ): Promise<PreparedMessageSend | null> => {
    const { content, model, tools } = payload;
    const pendingEditMessageId = editingUserMessageId.value;

    if (!deps.currentThread.value) {
      const thread = await deps.createNewThread(model || deps.currentModel.value);
      if (!thread) {
        chatStreamingLogger.event({
          level: 'error',
          event: 'chat.send.prepare',
          outcome: 'failed',
          message: 'Failed to create thread before send.',
        });
        return null;
      }
      resetStreamState();
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

    if (model && deps.currentThread.value.model !== model) {
      await deps.electronAPI.chat.threads.update(deps.currentThread.value.id, { model });
      deps.currentThread.value.model = model;
      deps.currentModel.value = model;
    }

    if (tools) {
      deps.selectedTools.value = tools;
    }

    deps.showWelcome.value = false;

    if (pendingEditMessageId && deps.currentThread.value) {
      await streamController.stopActiveStreamIfNeeded();

      const messageIndex = deps.messageStore.findIndexById(pendingEditMessageId);

      if (messageIndex >= 0) {
        const currentUserMessage = deps.messageStore.getAt(messageIndex);
        if (!currentUserMessage) {
          editingUserMessageId.value = null;
        } else {
          const updatedUserMessage: ChatUiMessage = {
            ...currentUserMessage,
            parts: upsertTextIntoMessageParts(currentUserMessage.parts, content),
          };

          deps.messageStore.replaceAt(messageIndex, updatedUserMessage);
          await upsertUiMessage(
            updatedUserMessage,
            undefined,
            'user-message-edit',
            deps.currentThread.value.id
          );
          await truncateConversationAfterIndex(messageIndex);

          streamController.beginTurn({
            threadId: deps.currentThread.value.id,
            parentId: updatedUserMessage.id,
          });

          editingUserMessageId.value = null;
          deps.scrollToBottom();
          return {
            threadId: deps.currentThread.value.id,
            messagesSnapshot: deps.messageStore.snapshot(),
          };
        }
      }

      editingUserMessageId.value = null;
    }

    const userMessage: ChatUiMessage = {
      id: deps.createMessageId(),
      role: 'user',
      parts: [{ type: 'text', text: content, state: 'done' }],
    };

    deps.messageStore.append(userMessage);
    const threadId = deps.currentThread.value.id;
    streamController.beginTurn({
      threadId,
      parentId: userMessage.id,
    });
    await upsertUiMessage(userMessage, undefined, 'user-message', threadId);

    deps.scrollToBottom();
    return {
      threadId,
      messagesSnapshot: deps.messageStore.snapshot(),
    };
  };

  return {
    streamController,
    editingUserMessageId,
    isApprovalProcessing: streamController.isApprovalProcessing,
    handleToolApproval: streamController.handleToolApproval,
    prepareMessageSend,
    beginEditMessage,
    cancelEditing,
    selectThread,
    handleThreadDeleted,
    handleNewChat,
    resetEditing,
  };
};
