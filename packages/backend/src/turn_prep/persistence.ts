import { appendSessionFacts, findMessageEvent } from '@iki/store/session_events';
import {
  INPUT_ACCEPTED,
  MODEL_OUTPUT_COMMITTED,
  SESSION_EVENT_VERSION,
} from '@iki/core/types/session_events';
import * as chatThreadDb from '@iki/store/chat_thread';
import * as awaitersDb from '@iki/store/awaiters';
import { createLogger } from '@iki/core/logger';
import type { ChatThread } from '@iki/core/types/chat';
import type { ChatUiMessage } from '@iki/ai/message/message_parts';
import { normalizeUiMessage } from '@iki/ai/message/ui_message_codec';
import { isObjectRecord } from '@iki/core/utils/guards';
import { normalizeOptionalString } from '@iki/core/utils/text';
import { createPrefixedId } from '@iki/core/utils/id';
import { ensureThreadWorkspaceSelection } from '@iki/backend/workspaces/thread_workspace';
import { isThreadWorktreeWorkspaceId } from '@iki/backend/workspaces/worktree_ids';

const chatPersistenceLogger = createLogger({ module: 'chat_persistence' });

const normalizeFlag = (value: unknown): number => {
  if (typeof value === 'number') return value ? 1 : 0;
  return value ? 1 : 0;
};

export type ChatPersistenceDeps = {
  /**
   * The session log is the one rebuild of a thread's conversation (ADR-008).
   * Both readers — this display list and a resumed turn's replay input — take
   * their messages from that owner; turn_prep may not slice history itself and
   * may not import thread_session (arch rule `turn-prep-below-session`), so the
   * rebuild arrives as an injected port wired by the composition root.
   */
  rebuildMessages: (threadId: string) => ChatUiMessage[];
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
    model: normalizeOptionalString(thread.model) ?? undefined,
    reasoning_effort: normalizeOptionalString(thread.reasoning_effort) || 'medium',
    metadata:
      typeof thread.metadata === 'string' && thread.metadata.trim() ? thread.metadata : '{}',
    is_generating: false,
    client_id: normalizeOptionalString(thread.client_id) ?? undefined,
    prompt_app_id: normalizeOptionalString(thread.prompt_app_id) ?? undefined,
    tools: normalizeOptionalString(thread.tools) ?? undefined,
    is_favorited: normalizeFlag(thread.is_favorited),
    is_incognito: normalizeFlag(thread.is_incognito),
    workspace_id: normalizeOptionalString(thread.workspace_id) ?? undefined,
    enable_artifacts: normalizeFlag(thread.enable_artifacts),
    artifact_workspace_id: normalizeOptionalString(thread.artifact_workspace_id) ?? undefined,
    skill_ids: normalizeOptionalString(thread.skill_ids) ?? undefined,
  };
};

/**
 * Take the message a caller hands in and land it as the structured ChatUiMessage
 * the session log stores. A JSON string is parsed (the renderer's edit path still
 * crosses the IPC with one); a plain non-JSON string becomes a user text message,
 * exactly the shape the input fact has always carried. Nothing is ever
 * re-stringified into a row-shaped `message` column — that fake row was the
 * second copy of every message and it is gone.
 */
const structuredUiMessage = (message: unknown, fallbackId: string): ChatUiMessage => {
  let source: unknown = message;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      source = { content: source };
    }
  }
  const ui = normalizeUiMessage(source, { fallbackId });
  if (!ui) {
    throw new Error(`Message ${fallbackId} has no structured ChatUiMessage to persist`);
  }
  return ui;
};

export const createChatPersistence = (deps: ChatPersistenceDeps) => {
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
    const clear = () => {
      awaitersDb.deleteAwaitersByThread(id);
      chatThreadDb.deleteChatThread(id);
      chatThreadDb.addChatThread(normalizedThread);
      return chatThreadDb.getChatThread(id);
    };

    const clearedThread = clear();
    ensureThreadWorkspaceSelection(id);
    return clearedThread;
  };
  const updateThread = (id: string, input: unknown) => {
    const thread = isObjectRecord(input) ? (input as Partial<ChatThread>) : {};
    const hasWorkspaceUpdate = Object.prototype.hasOwnProperty.call(thread, 'workspace_id');
    const existingThread = hasWorkspaceUpdate ? chatThreadDb.getChatThread(id) : null;
    const nextWorkspaceId = hasWorkspaceUpdate ? normalizeOptionalString(thread.workspace_id) : null;
    const currentWorkspaceId = normalizeOptionalString(existingThread?.workspace_id);
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

  const listMessages = (threadId: string): ChatUiMessage[] => deps.rebuildMessages(threadId);

  const getMessage = (id: string): ChatUiMessage | null => {
    const found = findMessageEvent(id);
    if (!found) return null;
    const payload = isObjectRecord(found.payload) ? found.payload : {};
    return normalizeUiMessage(payload.message, { fallbackId: id });
  };

  const createMessage = (input: unknown) => {
    const message = isObjectRecord(input) ? input : {};
    const messageId =
      typeof message.id === 'string' && message.id.trim()
        ? message.id.trim()
        : createPrefixedId('msg');
    const threadId = typeof message.thread_id === 'string' ? message.thread_id : '';
    if (!threadId) throw new Error('createMessage requires a thread_id');

    const structured = structuredUiMessage(message.message ?? {}, messageId);

    appendSessionFacts(threadId, [
      {
        type: INPUT_ACCEPTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          messageId,
          message: structured,
          transport: 'send',
        },
      },
    ]);
    chatThreadDb.touchChatThread(threadId);

    return structured;
  };

  /**
   * Latest fact wins: the session log is append-only and the rebuild upserts by
   * message id, so an update is just the next fact for the same id. The channel
   * stays MODEL_OUTPUT_COMMITTED for every role because that is where the replay
   * already reads edited messages — the event vocabulary itself is the session
   * log's owner's decision, not this writer's.
   */
  const updateMessage = (id: string, input: unknown) => {
    const patch = isObjectRecord(input) ? input : {};
    const existing = findMessageEvent(id);
    const threadId =
      typeof patch.thread_id === 'string' && patch.thread_id
        ? patch.thread_id
        : existing?.threadId;
    if (!threadId) return { changes: 0 };

    const existingPayload = isObjectRecord(existing?.payload) ? existing.payload : {};
    const rawMessage = patch.message ?? existingPayload.message ?? {};
    const structured = structuredUiMessage(rawMessage, id);

    const runId = typeof patch.runId === 'string' && patch.runId.trim() ? patch.runId.trim() : '';
    if (structured.role === 'assistant' && !runId) {
      // An unstamped MODEL_OUTPUT_COMMITTED can never be excluded with its dead
      // run: the replay's excludeRunIds matches commits by runId, so an empty
      // stamp lets the abandoned copy back into the retry request beside the
      // journaled tool exchange — the duplicate toolCallId that providers reject
      // with a 400. The old code guessed it out of the message body and always
      // wrote ''. Now the run that commits must say so, or the write is refused.
      throw new Error(
        `updateMessage: an assistant commit must carry the runId of the run that wrote it (message ${id})`
      );
    }

    appendSessionFacts(threadId, [
      {
        type: MODEL_OUTPUT_COMMITTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          ...(runId ? { runId } : {}),
          messageId: id,
          message: structured,
          transport: typeof patch.transport === 'string' ? patch.transport : 'stream',
        },
      },
    ]);
    chatThreadDb.touchChatThread(threadId);
    return { changes: 1 };
  };
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

    upsertTurnMessage: (input: unknown) => {
      const patch = isObjectRecord(input) ? input : {};
      const id = typeof patch.id === 'string' ? patch.id.trim() : '';
      if (!id) return null;
      const threadId =
        typeof patch.thread_id === 'string' && patch.thread_id
          ? patch.thread_id
          : findMessageEvent(id)?.threadId;
      if (!threadId) return null;
      return updateMessage(id, patch);
    },
  };
};
