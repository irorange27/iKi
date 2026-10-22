import {
  MESSAGE_EVENT_TYPES,
  SESSION_EVENT_VERSION,
  appendSessionFacts,
  findMessageEvent,
  getSessionEvents,
} from '@iki/backend/db/session_events';
import * as chatThreadDb from '@iki/backend/db/chat_thread';
import * as awaitersDb from '@iki/backend/db/awaiters';
import * as tasksDb from '@iki/backend/db/tasks';
import { getDb } from '@iki/backend/db/database';
import { createLogger } from '@iki/backend/logger';
import type { ChatMessage, ChatThread } from '@iki/backend/types/chat';
import { isObjectRecord } from '@iki/backend/utils/guards';
import { createPrefixedId } from '@iki/backend/utils/id';
import { ensureThreadWorkspaceSelection } from '@iki/backend/workspaces/thread_workspace';
import { isThreadWorktreeWorkspaceId } from '@iki/backend/workspaces/git_worktree';
import { sanitizeUiMessageJsonForStorage } from '@iki/backend/message/ui_message_codec';

const chatPersistenceLogger = createLogger({ module: 'chat_persistence' });

const normalizedString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeFlag = (value: unknown): number => {
  if (typeof value === 'number') return value ? 1 : 0;
  return value ? 1 : 0;
};

const normalizeThreadInput = (
  input: unknown,
  overrides?: { id?: string; title?: string }
): Required<
  Pick<
    ChatThread,
    | 'id'
    | 'title'
    | 'metadata'
    | 'is_generating'
    | 'is_favorited'
    | 'is_incognito'
    | 'enable_artifacts'
  >
> &
  Pick<
    ChatThread,
    | 'model'
    | 'reasoning_effort'
    | 'client_id'
    | 'prompt_app_id'
    | 'tools'
    | 'workspace_id'
    | 'artifact_workspace_id'
    | 'skill_ids'
  > => {
  const thread = isObjectRecord(input) ? (input as Partial<ChatThread>) : {};

  return {
    id:
      overrides?.id ||
      (typeof thread.id === 'string' && thread.id.trim()
        ? thread.id.trim()
        : createPrefixedId('thread')),
    title:
      overrides?.title ||
      (typeof thread.title === 'string' && thread.title.trim() ? thread.title : 'New Chat'),
    model: normalizedString(thread.model) ?? undefined,
    reasoning_effort: normalizedString(thread.reasoning_effort) || 'medium',
    metadata:
      typeof thread.metadata === 'string' && thread.metadata.trim() ? thread.metadata : '{}',
    is_generating: false,
    client_id: normalizedString(thread.client_id) ?? undefined,
    prompt_app_id: normalizedString(thread.prompt_app_id) ?? undefined,
    tools: normalizedString(thread.tools) ?? undefined,
    is_favorited: normalizeFlag(thread.is_favorited),
    is_incognito: normalizeFlag(thread.is_incognito),
    workspace_id: normalizedString(thread.workspace_id) ?? undefined,
    enable_artifacts: normalizeFlag(thread.enable_artifacts),
    artifact_workspace_id: normalizedString(thread.artifact_workspace_id) ?? undefined,
    skill_ids: normalizedString(thread.skill_ids) ?? undefined,
  };
};

export const createChatPersistence = () => {
  const listThreads = () => chatThreadDb.getChatThreads();
  const getThread = (id: string) => {
    ensureThreadWorkspaceSelection(id);
    return chatThreadDb.getChatThread(id);
  };
  const createThread = (input: unknown) => {
    const normalizedThread = normalizeThreadInput(input);
    chatThreadDb.addChatThread(normalizedThread);
    ensureThreadWorkspaceSelection(normalizedThread.id);
    return chatThreadDb.getChatThread(normalizedThread.id);
  };
  const clearThread = (id: string, input: unknown) => {
    const existingThread = chatThreadDb.getChatThread(id);
    if (!existingThread) return null;

    const normalizedThread = normalizeThreadInput(input, { id });
    const clear = getDb().transaction(() => {
      const proactiveTaskIds = tasksDb.listProactiveTaskIdsByThread(id);
      awaitersDb.deleteAwaitersByThread(id);
      chatThreadDb.deleteChatThread(id);
      chatThreadDb.addChatThread(normalizedThread);
      for (const taskId of proactiveTaskIds) {
        tasksDb.updateProactiveTask(taskId, { thread_id: id });
      }
      return chatThreadDb.getChatThread(id);
    });

    const clearedThread = clear();
    ensureThreadWorkspaceSelection(id);
    return clearedThread;
  };
  const updateThread = (id: string, input: unknown) => {
    const thread = isObjectRecord(input) ? (input as Partial<ChatThread>) : {};
    const hasWorkspaceUpdate = Object.prototype.hasOwnProperty.call(thread, 'workspace_id');
    const existingThread = hasWorkspaceUpdate ? chatThreadDb.getChatThread(id) : null;
    const nextWorkspaceId = hasWorkspaceUpdate ? normalizedString(thread.workspace_id) : null;
    const currentWorkspaceId = normalizedString(existingThread?.workspace_id);
    const workspaceChanged = hasWorkspaceUpdate && nextWorkspaceId !== currentWorkspaceId;

    const guardedWorkspaceChange =
      workspaceChanged && !isThreadWorktreeWorkspaceId(nextWorkspaceId);

    if (guardedWorkspaceChange) {
      const messageCount = listMessages(id).length;
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

  const projectRow = (threadId: string, event: { type: string; payload: unknown }): ChatMessage | null => {
    const payload = event.payload as { message?: unknown; messageId?: unknown };
    const message = payload?.message;
    if (!message || typeof message !== 'object') return null;
    const id = (message as { id?: unknown }).id;
    if (typeof id !== 'string' || !id) return null;
    return {
      id,
      thread_id: threadId,
      parent_id: null,
      slot_id: null,
      depth: 0,
      message: JSON.stringify(message),
      timestamp:
        typeof (payload as { timestamp?: unknown }).timestamp === 'string'
          ? (payload as { timestamp: string }).timestamp
          : new Date(0).toISOString(),
      metadata: '{}',
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    } as unknown as ChatMessage;
  };

  const listMessages = (threadId: string): ChatMessage[] => {
    const rows = getSessionEvents(threadId, [
      MESSAGE_EVENT_TYPES.INPUT_ACCEPTED,
      MESSAGE_EVENT_TYPES.MODEL_OUTPUT_COMMITTED,
      MESSAGE_EVENT_TYPES.MESSAGES_TRUNCATED,
    ]);
    const byId = new Map<string, ChatMessage>();
    for (const event of rows) {
      if (event.type === MESSAGE_EVENT_TYPES.MESSAGES_TRUNCATED) {
        const deleted = (event.payload as { deletedMessageIds?: unknown }).deletedMessageIds;
        if (Array.isArray(deleted)) {
          for (const id of deleted) {
            if (typeof id === 'string') byId.delete(id);
          }
        }
        continue;
      }
      const row = projectRow(threadId, event);
      if (row) byId.set(row.id, row);
    }
    return [...byId.values()];
  };

  const getMessage = (id: string): ChatMessage | null => {
    const found = findMessageEvent(id);
    if (!found) return null;
    return projectRow(found.threadId, { type: '', payload: found.payload });
  };
  const createMessage = (input: unknown) => {
    const message = isObjectRecord(input) ? (input as Partial<ChatMessage>) : {};
    const messageId =
      typeof message.id === 'string' && message.id.trim()
        ? message.id.trim()
        : createPrefixedId('msg');
    const threadId = typeof message.thread_id === 'string' ? message.thread_id : '';
    if (!threadId) throw new Error('createMessage requires a thread_id');

    const parsedMessage: unknown =
      typeof message.message === 'string'
        ? (() => {
            try {
              return JSON.parse(message.message);
            } catch {
              return { id: messageId, role: 'user', parts: [{ type: 'text', text: message.message }] };
            }
          })()
        : (message.message ?? {});

    appendSessionFacts(threadId, [
      {
        type: MESSAGE_EVENT_TYPES.INPUT_ACCEPTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          messageId,
          message: parsedMessage,
          transport: 'send',
        },
      },
    ]);
    chatThreadDb.touchChatThread(threadId);

    return getMessage(messageId);
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

    const existing = getMessage(id);
    const threadId = sanitizedUpdate.thread_id || existing?.thread_id;
    if (!threadId) return { changes: 0 };

    const rawMessage = sanitizedUpdate.message ?? existing?.message ?? '{}';
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      parsed = { id, role: 'user', parts: [{ type: 'text', text: rawMessage }] };
    }
    appendSessionFacts(threadId, [
      {
        type: MESSAGE_EVENT_TYPES.MODEL_OUTPUT_COMMITTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          runId: (parsed as { runId?: string }).runId ?? '',
          messageId: id,
          message: parsed,
          transport: 'stream',
        },
      },
    ]);
    chatThreadDb.touchChatThread(threadId);
    return { changes: 1 };
  };

  const deleteMessage = (_id: string) => ({ changes: 0 });

  return {

    listThreads,
    getThread,
    createThread,
    clearThread,
    updateThread,
    deleteThread,

    listMessages,
    getMessage,
    createMessage,
    updateMessage,
    deleteMessage,

    upsertTurnMessage: (input: unknown) => {
      const id =
        isObjectRecord(input) && typeof (input as { id?: unknown }).id === 'string'
          ? (input as { id: string }).id.trim()
          : '';
      if (!id) return null;
      const existing = getMessage(id);
      if (existing) {
        const rawMessage = isObjectRecord(input)
          ? (input as { message?: unknown }).message
          : undefined;
        const payload =
          rawMessage !== undefined && typeof rawMessage !== 'string'
            ? { ...(input as Record<string, unknown>), message: JSON.stringify(rawMessage) }
            : input;
        return updateMessage(id, payload);
      }
      const threadId = isObjectRecord(input) && typeof (input as { thread_id?: unknown }).thread_id === 'string'
        ? (input as { thread_id: string }).thread_id
        : '';
      if (!threadId) return null;
      return updateMessage(id, input);
    },
  };
};
