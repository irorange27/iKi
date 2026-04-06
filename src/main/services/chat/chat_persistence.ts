import * as chatMessageDb from '../../../core/db/chat_message';
import * as chatThreadDb from '../../../core/db/chat_thread';
import * as threadTodoDb from '../../../core/db/thread_todos';
import { createLogger } from '../../../core/logger';
import type { ChatMessage, ChatThread } from '../../../shared/types/chat';
import { isObjectRecord } from '../../../shared/utils/guards';
import { createPrefixedId } from '../../../shared/utils/id';
import { ensureThreadWorkspaceSelection } from '../../../core/workspaces/thread_workspace';
import { getErrorMessage } from '../../utils/errors';
import { onMessagePersisted as onContinuityMessagePersisted } from '../continuity/continuity_service';
import type { ChatMemory } from './chat_memory';
import { sanitizeUiMessageJsonForStorage } from './chat_ui';

const chatPersistenceLogger = createLogger({ module: 'chat_persistence' });

const normalizedString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const createChatPersistence = (deps: { memory: ChatMemory }) => {
  const listThreads = () => chatThreadDb.getChatThreads();
  const getThread = (id: string) => {
    ensureThreadWorkspaceSelection(id);
    return chatThreadDb.getChatThread(id);
  };
  const getThreadTodoPlan = (threadId: string) => threadTodoDb.getThreadTodoPlan(threadId);
  const createThread = (input: unknown) => {
    const thread = isObjectRecord(input) ? (input as Partial<ChatThread>) : {};
    const threadId =
      typeof thread.id === 'string' && thread.id.trim()
        ? thread.id.trim()
        : createPrefixedId('thread');
    const title =
      typeof thread.title === 'string' && thread.title.trim() ? thread.title : 'New Chat';

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
    ensureThreadWorkspaceSelection(threadId);
    return chatThreadDb.getChatThread(threadId);
  };
  const updateThread = (id: string, input: unknown) => {
    const thread = isObjectRecord(input) ? (input as Partial<ChatThread>) : {};
    const hasWorkspaceUpdate = Object.prototype.hasOwnProperty.call(thread, 'workspace_id');
    const existingThread = hasWorkspaceUpdate ? chatThreadDb.getChatThread(id) : null;
    const nextWorkspaceId = hasWorkspaceUpdate ? normalizedString(thread.workspace_id) : null;
    const currentWorkspaceId = normalizedString(existingThread?.workspace_id);
    const workspaceChanged = hasWorkspaceUpdate && nextWorkspaceId !== currentWorkspaceId;

    if (workspaceChanged) {
      const messageCount = chatMessageDb.countChatMessagesByThread(id);
      if (messageCount > 0) {
        chatPersistenceLogger.event({
          level: 'warn',
          event: 'chat.thread.workspace_update',
          outcome: 'skipped',
          message: 'Refused to change workspace after the thread already has messages.',
          entity: {
            thread_id: id,
            workspace_id: nextWorkspaceId,
          },
          data: {
            previous_workspace_id: currentWorkspaceId,
            message_count: messageCount,
          },
        });

        const nextThread = { ...thread };
        delete nextThread.workspace_id;
        if (Object.keys(nextThread).length === 0) {
          return { changes: 0 };
        }
        return chatThreadDb.updateChatThread(id, nextThread);
      }
    }

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
        : createPrefixedId('msg');
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
        chatPersistenceLogger.event({
          level: 'warn',
          event: 'chat.message.create',
          outcome: 'degraded',
          message: 'Duplicate chat message create ignored.',
          entity: {
            message_id: messageId,
            thread_id: typeof message.thread_id === 'string' ? message.thread_id : null,
            parent_id: typeof message.parent_id === 'string' ? message.parent_id : null,
          },
        });
        const existing = chatMessageDb.getChatMessage(messageId);
        if (existing) return existing;
      }

      chatPersistenceLogger.event({
        level: 'error',
        event: 'chat.message.create',
        outcome: 'failed',
        error,
        entity: {
          message_id: messageId,
          thread_id: typeof message.thread_id === 'string' ? message.thread_id : null,
        },
        data: {
          error_code: errorCode || 'unknown',
          error_message: errorMessage,
        },
      });
      throw error;
    }

    deps.memory.onMessagePersisted({
      threadId: message.thread_id,
      messageId,
      messageJson: sanitizedMessageJson,
    });
    void onContinuityMessagePersisted({
      threadId: message.thread_id,
      messageId,
      messageJson: sanitizedMessageJson,
    });

    const created = chatMessageDb.getChatMessage(messageId);
    return created;
  };

  const createMessageWithProcessing = async (
    input: unknown,
    options?: { waitForEmotionAnalysis?: boolean }
  ) => {
    const created = createMessage(input);
    if (
      options?.waitForEmotionAnalysis &&
      created &&
      typeof created.thread_id === 'string' &&
      typeof created.id === 'string' &&
      typeof created.message === 'string'
    ) {
      await deps.memory.waitForEmotionAnalysis?.({
        threadId: created.thread_id,
        messageId: created.id,
        messageJson: created.message,
      });
    }
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
      }
    } catch (error) {
      chatPersistenceLogger.event({
        level: 'warn',
        event: 'chat.message.update',
        outcome: 'degraded',
        error,
        entity: {
          message_id: id,
        },
        data: {
          error_message: getErrorMessage(error),
        },
      });
    }

    return result;
  };

  const deleteMessage = (id: string) => chatMessageDb.deleteChatMessage(id);

  return {
    // Threads
    listThreads,
    getThread,
    getThreadTodoPlan,
    createThread,
    updateThread,
    deleteThread,
    // Messages
    listMessages,
    getMessage,
    createMessage,
    createMessageWithProcessing,
    updateMessage,
    deleteMessage,
  };
};

export type ChatPersistence = ReturnType<typeof createChatPersistence>;
