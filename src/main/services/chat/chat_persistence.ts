import * as chatMessageDb from '../../../core/db/chat_message';
import * as chatThreadDb from '../../../core/db/chat_thread';
import type { ChatMessage, ChatThread } from '../../../shared/types/chat';
import { isObjectRecord } from '../../../shared/utils/guards';
import { getErrorMessage } from '../../utils/errors';
import { touchThreadRelationshipState } from '../relationship/relationship_service';
import type { ChatMemory } from './chat_memory';
import { sanitizeUiMessageJsonForStorage } from './chat_ui';

export const createChatPersistence = (deps: { memory: ChatMemory }) => {
  const listThreads = () => chatThreadDb.getChatThreads();
  const getThread = (id: string) => chatThreadDb.getChatThread(id);
  const createThread = (input: unknown) => {
    const thread = isObjectRecord(input) ? (input as Partial<ChatThread>) : {};
    const threadId =
      typeof thread.id === 'string' && thread.id.trim()
        ? thread.id.trim()
        : `thread_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const title =
      typeof thread.title === 'string' && thread.title.trim() ? thread.title : 'New Chat';
    const normalizedString = (value: unknown): string | null => {
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    };

    const normalizeFlag = (value: unknown): number => {
      if (typeof value === 'number') return value ? 1 : 0;
      return value ? 1 : 0;
    };

    chatThreadDb.addChatThread({
      id: threadId,
      title,
      model: normalizedString(thread.model),
      reasoning_effort: normalizedString(thread.reasoning_effort) || 'medium',
      metadata:
        typeof thread.metadata === 'string' && thread.metadata.trim() ? thread.metadata : '{}',
      is_generating: false,
      client_id: normalizedString(thread.client_id),
      prompt_app_id: normalizedString(thread.prompt_app_id),
      tools: normalizedString(thread.tools),
      is_favorited: normalizeFlag(thread.is_favorited),
      is_incognito: normalizeFlag(thread.is_incognito),
      workspace_id: normalizedString(thread.workspace_id),
      enable_artifacts: normalizeFlag(thread.enable_artifacts),
      artifact_workspace_id: normalizedString(thread.artifact_workspace_id),
      skill_ids: normalizedString(thread.skill_ids),
    });
    return chatThreadDb.getChatThread(threadId);
  };
  const updateThread = (id: string, input: unknown) => {
    const thread = isObjectRecord(input) ? (input as Partial<ChatThread>) : {};
    return chatThreadDb.updateChatThread(id, thread);
  };
  const deleteThread = (id: string) => chatThreadDb.deleteChatThread(id);

  const listMessages = (threadId: string) => chatMessageDb.getChatMessages(threadId);
  const getMessage = (id: string) => chatMessageDb.getChatMessage(id);
  const createMessage = (input: unknown) => {
    const message = isObjectRecord(input) ? (input as Partial<ChatMessage>) : {};
    const messageId =
      typeof message.id === 'string' && message.id.trim()
        ? message.id.trim()
        : `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp =
      typeof message.timestamp === 'string' && message.timestamp.trim()
        ? message.timestamp
        : new Date().toISOString();
    const sanitizedMessageJson =
      typeof message.message === 'string'
        ? sanitizeUiMessageJsonForStorage(message.message)
        : JSON.stringify(message.message ?? {});

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
        touchThreadRelationshipState(message.thread_id, timestamp);
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
    return created;
  };

  const updateMessage = (id: string, input: unknown) => {
    const sanitizedUpdate: Partial<ChatMessage> = isObjectRecord(input)
      ? {
          ...(input as Partial<ChatMessage>),
          ...(typeof (input as { message?: unknown }).message === 'string'
            ? {
                message: sanitizeUiMessageJsonForStorage((input as { message: string }).message),
              }
            : {}),
        }
      : {};

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
        touchThreadRelationshipState(threadId);
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
