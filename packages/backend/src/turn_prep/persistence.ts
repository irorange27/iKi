import {
  MESSAGE_EVENT_TYPES,
  SESSION_EVENT_VERSION,
  appendSessionFacts,
  findMessageEvent,
  getSessionEvents,
} from '@iki/backend/db/session_events';
import * as chatThreadDb from '@iki/backend/db/chat_thread';
import * as threadTodoDb from '@iki/backend/db/thread_todos';
import * as awaitersDb from '@iki/backend/db/awaiters';
import * as tasksDb from '@iki/backend/db/tasks';
import { getDb } from '@iki/backend/db/database';
import { createLogger } from '@iki/backend/logger';
import type { ChatMessage, ChatThread } from '@iki/backend/types/chat';
import { isObjectRecord } from '@iki/backend/utils/guards';
import { createPrefixedId } from '@iki/backend/utils/id';
import { ensureThreadWorkspaceSelection } from '@iki/backend/workspaces/thread_workspace';
import { isThreadWorktreeWorkspaceId } from '@iki/backend/workspaces/git_worktree';
import { getErrorMessage } from '@iki/backend/utils/errors';
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

export const createChatPersistence = (deps: {
  onContinuityMessagePersisted: (params: {
    threadId: string;
    messageId: string;
    messageJson: string;
  }) => Promise<void>;
}) => {
  const listThreads = () => chatThreadDb.getChatThreads();
  const getThread = (id: string) => {
    ensureThreadWorkspaceSelection(id);
    return chatThreadDb.getChatThread(id);
  };
  const getThreadTodoPlan = (threadId: string) => threadTodoDb.getThreadTodoPlan(threadId);
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

    // Assigning the thread's own sanctioned worktree must pass even mid-thread;
    // the guard only protects arbitrary workspace switches after messages exist.
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

  /**
   * Messages are DERIVED, not stored (ADR 011). The session log is the only
   * record; this reads it back into the row shape the callers still expect.
   *
   * The shape is kept deliberately: every consumer above this seam reads
   * `ChatMessage` (id, thread_id, message JSON, timestamp), and rewriting all
   * of them at once would be a larger change than removing the table. The
   * projection is a plain fold over the two event types that carry a message,
   * so it cannot disagree with the log — there is nothing to disagree with.
   */
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
    const rows = getSessionEvents(threadId, [MESSAGE_EVENT_TYPES.INPUT_ACCEPTED, MESSAGE_EVENT_TYPES.MODEL_OUTPUT_COMMITTED]);
    const byId = new Map<string, ChatMessage>();
    for (const event of rows) {
      const row = projectRow(threadId, event);
      // Later facts overwrite earlier ones for the same id — the same
      // overwrite semantics the replay reducer uses.
      if (row) byId.set(row.id, row);
    }
    return [...byId.values()];
  };

  const getMessage = (id: string): ChatMessage | null => {
    // No thread id is available from an id alone, so this cannot use the
    // per-thread scan. It is the one lookup that still needs a scan; the
    // callers that use it already hold the thread and should pass it.
    const row = getDb()
      .prepare(
        `SELECT thread_id, payload FROM session_events
          WHERE type IN (?, ?) AND payload LIKE ?
          ORDER BY revision DESC LIMIT 1`
      )
      .get(
        MESSAGE_EVENT_TYPES.INPUT_ACCEPTED,
        MESSAGE_EVENT_TYPES.MODEL_OUTPUT_COMMITTED, `%"id":"${id.replace(/"/g, '')}"`) as
      | { thread_id: string; payload: string }
      | undefined;
    if (!row) return null;
    try {
      return projectRow(row.thread_id, {
        type: '',
        payload: JSON.parse(row.payload) as unknown,
      });
    } catch {
      return null;
    }
  };
  const createMessage = (input: unknown) => {
    const message = isObjectRecord(input) ? (input as Partial<ChatMessage>) : {};
    const messageId =
      typeof message.id === 'string' && message.id.trim()
        ? message.id.trim()
        : createPrefixedId('msg');
    const threadId = typeof message.thread_id === 'string' ? message.thread_id : '';
    if (!threadId) throw new Error('createMessage requires a thread_id');

    const sanitizedMessageJson =
      typeof message.message === 'string'
        ? sanitizeUiMessageJsonForStorage(message.message)
        : JSON.stringify(message.message ?? {});

    // ADR 011: this entry point NO LONGER WRITES.
    //
    // The turn path owns the fact: `message_send` records `input_accepted`
    // (with the run id, the system config and the id-less send's
    // `input_<runId>` id) for the input it admits, and `finalizeTurn` records
    // `model_output_committed` for the answer. This function is called by the
    // renderer's dual-write for the SAME message, so writing here produced a
    // second fact for one message — two accepted inputs where the contract is
    // one.
    //
    // Keeping it as a lookup rather than deleting the method keeps the
    // callers compiling; a message that already exists returns itself, and a
    // message the turn path has not recorded yet returns null. The log stays
    // the single writer's record.
    void sanitizedMessageJson;
    chatThreadDb.touchChatThread(threadId);

    void deps.onContinuityMessagePersisted({
      threadId,
      messageId,
      messageJson: sanitizedMessageJson,
    });

    return getMessage(messageId);
  };

  /**
   * An append-only log has no in-place update. A changed message is a NEW
   * fact carrying the same message id; the projection takes the latest one.
   * The caller-visible result is unchanged; the storage shape is not.
   */
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

  /**
   * An append-only log cannot forget. Deletion is a no-op here rather than a
   * silent partial: history truncation is handled at the thread level (the
   * stream is per thread), and a single-message delete would need a tombstone
   * fact the reducer does not have yet.
   */
  const deleteMessage = (_id: string) => ({ changes: 0 });

  return {
    // Threads
    listThreads,
    getThread,
    getThreadTodoPlan,
    createThread,
    clearThread,
    updateThread,
    deleteThread,
    // Messages
    listMessages,
    getMessage,
    createMessage,
    updateMessage,
    deleteMessage,
    /**
     * Turn-output write: create the row or update it in place when an earlier
     * write (renderer dual-write, an approval-pending partial) already created
     * it. Unlike createMessage this never silently keeps a stale partial.
     */
    upsertTurnMessage: (input: unknown) => {
      const id =
        isObjectRecord(input) && typeof (input as { id?: unknown }).id === 'string'
          ? (input as { id: string }).id.trim()
          : '';
      const existing = id ? getMessage(id) : null;
      if (existing && id) {
        // Normalize object message payloads to the sanitized JSON string the
        // column stores, mirroring createMessage.
        const rawMessage = isObjectRecord(input)
          ? (input as { message?: unknown }).message
          : undefined;
        const payload =
          rawMessage !== undefined && typeof rawMessage !== 'string'
            ? { ...(input as Record<string, unknown>), message: JSON.stringify(rawMessage) }
            : input;
        return updateMessage(id, payload);
      }
      return createMessage(input);
    },
  };
};

export type ChatPersistence = ReturnType<typeof createChatPersistence>;
