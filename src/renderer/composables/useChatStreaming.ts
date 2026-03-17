import { ref } from 'vue';
import type { Ref } from 'vue';
import type { UIMessage } from 'ai';

import { createChatUiStreamController } from '../modules/chat/ui_stream_controller';
import type { ChatMessageStore } from '../modules/chat/chat_message_store';
import type { UiMessagePersistence } from '../modules/chat/ui_message_persistence';
import {
  upsertTextIntoMessageParts,
  extractTextFromMessage,
  isTextPart,
} from '../modules/chat/ui_message_text';
import { isObjectRecord } from '../../shared/utils/guards';
import type { ChatThread } from './useChatThreads';

export const useChatStreaming = (deps: {
  electronAPI: any;
  messageStore: ChatMessageStore;
  persistence: UiMessagePersistence;
  createMessageId: () => string;
  scrollToBottom: () => void;
  getCurrentThreadId: () => string | null;
  onAssistantMessagePersisted: (params: { threadId: string; messagesSnapshot: UIMessage[] }) => Promise<void>;
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
    message: UIMessage,
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
    await streamController.stopActiveStreamIfNeeded('switch-thread', threadId);
    await deps.selectThread(threadId);
    resetEditing();
    resetStreamState();
  };

  const handleThreadDeleted = async (threadId: string) => {
    await streamController.stopActiveStreamIfNeeded('delete-thread');
    await deps.handleThreadDeleted(threadId);
    resetEditing();
    resetStreamState();
  };

  const handleNewChat = async () => {
    await streamController.stopActiveStreamIfNeeded('new-chat');
    await deps.handleNewChat();
    resetEditing();
    resetStreamState();
  };

  const beginEditMessage = async (message: UIMessage, setDraftMessage: (text: string) => Promise<void>) => {
    if (!message || message.role !== 'user' || typeof message.id !== 'string') return;
    await streamController.stopActiveStreamIfNeeded('edit-message');
    editingUserMessageId.value = message.id;
    const text = extractTextFromMessage(message);
    await setDraftMessage(text);
    deps.scrollToBottom();
  };

  const cancelEditing = async (clearDraftMessage: () => Promise<void>) => {
    editingUserMessageId.value = null;
    await clearDraftMessage();
  };

  const handleMessageSent = async (
    content: string,
    model?: string,
    tools?: string[],
    onReady?: () => void
  ) => {
    try {
      const pendingEditMessageId = editingUserMessageId.value;

      if (!deps.currentThread.value) {
        const thread = await deps.createNewThread(model || deps.currentModel.value);
        if (!thread) {
          console.error('Failed to create thread');
          return;
        }
        resetStreamState();
        resetEditing();
      }

      if (!deps.currentThread.value) {
        console.error('No thread available');
        return;
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
        await streamController.stopActiveStreamIfNeeded('edit-resend');

        const messageIndex = deps.messageStore.findIndexById(pendingEditMessageId);

        if (messageIndex >= 0) {
          const currentUserMessage = deps.messageStore.getAt(messageIndex) as UIMessage;
          const updatedUserMessage: UIMessage = {
            ...currentUserMessage,
            parts: upsertTextIntoMessageParts(currentUserMessage.parts, content),
          };

          deps.messageStore.replaceAt(messageIndex, updatedUserMessage);
          await upsertUiMessage(updatedUserMessage, undefined, 'user-message-edit', deps.currentThread.value.id);
          await truncateConversationAfterIndex(messageIndex);

          streamController.beginTurn({
            threadId: deps.currentThread.value.id,
            parentId: updatedUserMessage.id,
            tracePrefix: 'view',
          });

          editingUserMessageId.value = null;
          deps.scrollToBottom();
          return;
        }

        editingUserMessageId.value = null;
      }

      const userMessage: UIMessage = {
        id: deps.createMessageId(),
        role: 'user',
        parts: [{ type: 'text', text: content, state: 'done' }],
      };

      deps.messageStore.append(userMessage);
      const threadId = deps.currentThread.value.id;
      streamController.beginTurn({
        threadId,
        parentId: userMessage.id,
        tracePrefix: 'view',
      });
      await upsertUiMessage(userMessage, undefined, 'user-message', threadId);

      deps.scrollToBottom();
    } finally {
      onReady?.();
    }
  };

  const isStreamingTextPart = (message: UIMessage, part: unknown): boolean => {
    if (!isTextPart(part)) return false;
    if (!streamController.activeAssistantMessageId.value) return false;
    if (message.id !== streamController.activeAssistantMessageId.value) return false;
    return isObjectRecord(part) && part.state === 'streaming';
  };

  return {
    streamController,
    editingUserMessageId,
    isApprovalProcessing: streamController.isApprovalProcessing,
    handleToolApproval: streamController.handleToolApproval,
    handleMessageSent,
    beginEditMessage,
    cancelEditing,
    isStreamingTextPart,
    selectThread,
    handleThreadDeleted,
    handleNewChat,
    resetEditing,
  };
};
