import * as chatMessageDb from '../../../core/db/chat_message';
import * as chatThreadDb from '../../../core/db/chat_thread';
import { getErrorMessage } from '../../utils/errors';
import type { ChatMemory } from './chat_memory';
import { sanitizeUiMessageJsonForStorage } from './chat_ui';

export const createChatPersistence = (deps: { memory: ChatMemory }) => {
  const listThreads = () => chatThreadDb.getChatThreads();
  const getThread = (id: string) => chatThreadDb.getChatThread(id);
  const createThread = (thread: any) => {
    const threadId = thread.id || `thread_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const title = thread.title || 'New Chat';
    chatThreadDb.addChatThread({
      id: threadId,
      title,
      model: thread.model || null,
      metadata: thread.metadata || '{}',
      is_generating: false,
    });
    return chatThreadDb.getChatThread(threadId);
  };
  const updateThread = (id: string, thread: any) => chatThreadDb.updateChatThread(id, thread);
  const deleteThread = (id: string) => chatThreadDb.deleteChatThread(id);

  const listMessages = (threadId: string) => chatMessageDb.getChatMessages(threadId);
  const getMessage = (id: string) => chatMessageDb.getChatMessage(id);
  const createMessage = (message: any) => {
    const messageId = message.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = message.timestamp || new Date().toISOString();
    const sanitizedMessageJson =
      typeof message.message === 'string'
        ? sanitizeUiMessageJsonForStorage(message.message)
        : JSON.stringify(message.message ?? {});
    console.log(
      `[ChatPersist][Main] create-request id=${messageId} thread=${message.thread_id} parent=${message.parent_id || 'null'} depth=${message.depth || 0}`
    );

    try {
      chatMessageDb.addChatMessage({
        id: messageId,
        thread_id: message.thread_id,
        parent_id: message.parent_id || null,
        slot_id: message.slot_id || null,
        depth: message.depth || 0,
        message: sanitizedMessageJson,
        timestamp,
        metadata: message.metadata || '{}',
      });
      // Keep thread ordering consistent with recent activity.
      if (message.thread_id) {
        chatThreadDb.touchChatThread(message.thread_id);
      }
    } catch (error: unknown) {
      const errorCode =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: unknown }).code)
          : '';
      const errorMessage = getErrorMessage(error);

      if (
        errorCode === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
        errorMessage.includes('UNIQUE constraint failed: chat_messages.id')
      ) {
        console.warn(
          `[ChatPersist][Main] duplicate-create id=${messageId} thread=${message.thread_id} parent=${message.parent_id || 'null'}`
        );
        const existing = chatMessageDb.getChatMessage(messageId);
        if (existing) return existing;
      }

      console.error(
        `[ChatPersist][Main] create-failed id=${messageId} thread=${message.thread_id} code=${errorCode || 'unknown'} error=${errorMessage}`
      );
      throw error;
    }

    deps.memory.onMessagePersisted({
      threadId: message.thread_id,
      messageId,
      messageJson: sanitizedMessageJson,
    });

    const created = chatMessageDb.getChatMessage(messageId);
    console.log(
      `[ChatPersist][Main] create-success id=${messageId} thread=${message.thread_id} parent=${message.parent_id || 'null'}`
    );
    return created;
  };

    const updateMessage = (id: string, message: any) => {
    const sanitizedUpdate =
      message && typeof message === 'object' && message !== null
        ? {
            ...message,
            ...(typeof (message as { message?: unknown }).message === 'string'
              ? { message: sanitizeUiMessageJsonForStorage((message as { message: string }).message) }
              : {}),
          }
        : message;

    const result = chatMessageDb.updateChatMessage(id, sanitizedUpdate);

    try {
      const existing = chatMessageDb.getChatMessage(id);
      const threadId = sanitizedUpdate.thread_id || existing?.thread_id;
      const messageJson =
        typeof sanitizedUpdate.message === 'string' ? sanitizedUpdate.message : existing?.message;

      if (threadId && messageJson) {
        deps.memory.onMessagePersisted({
          threadId,
          messageId: id,
          messageJson,
        });
      }

      if (threadId) {
        chatThreadDb.touchChatThread(threadId);
      }
    } catch (error) {
      console.warn('[Memory][Main] short memory update failed:', getErrorMessage(error));
    }

    return result;
  };

  const deleteMessage = (id: string) => chatMessageDb.deleteChatMessage(id);

  return {
    // Threads
    listThreads,
    getThread,
    createThread,
    updateThread,
    deleteThread,
    // Messages
    listMessages,
    getMessage,
    createMessage,
    updateMessage,
    deleteMessage,
  };
};

export type ChatPersistence = ReturnType<typeof createChatPersistence>;
