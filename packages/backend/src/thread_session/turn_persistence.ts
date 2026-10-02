import { createLogger } from '@iki/backend/logger';
import { parseStoredUiMessageRow } from '@iki/backend/message/ui_message_codec';
import * as chatMessageDb from '@iki/backend/db/chat_message';
import type { ChatTurnOptions } from '../turn_prep/turn_preparer';

const logger = createLogger({ module: 'turn_persistence' });

/**
 * The conversation-store seam between turn execution and chat_messages.
 * Backend turn paths persist through here; the renderer is a view that keeps
 * only user-driven history management (edit update, delete). The rules:
 * - user messages are create-only (a client-supplied id that already exists
 *   keeps the existing row),
 * - assistant turn output is upserted (an approval-pending partial or an
 *   older progress write is updated to the newest accumulation), serialized
 *   per message id so a late progress write cannot land after the settle.
 */
export type ConversationStore = {
  createMessage: (input: unknown) => unknown;
  upsertTurnMessage: (input: unknown) => unknown;
};

export const UI_MESSAGE_METADATA_FORMAT = 'ai-ui-message-v1';

/**
 * The user message that started the turn: the last user entry with a
 * client-supplied id. Both the durable row and the session-log fact use this
 * one selection.
 */
export const pickUserTurnMessage = (
  options: ChatTurnOptions
): { messageId: string; message: unknown } | undefined => {
  const lastUser = [...options.messages].reverse().find(message => message.role === 'user');
  if (!lastUser) return undefined;
  const id = typeof (lastUser as { id?: unknown }).id === 'string' ? (lastUser as { id: string }).id : '';
  if (!id.trim()) return undefined;
  return { messageId: id, message: lastUser };
};

/**
 * Durable record of the user message that started the turn. Returns the
 * persisted message id (undefined when nothing was written) so the assistant
 * row can reference it as parent.
 */
export const persistUserTurnMessage = (
  conversation: Pick<ConversationStore, 'createMessage'>,
  options: ChatTurnOptions
): string | undefined => {
  if (!options.threadId) return undefined;
  const picked = pickUserTurnMessage(options);
  if (!picked) return undefined;
  const { messageId: id, message: lastUser } = picked;
  try {
    conversation.createMessage({
      id,
      thread_id: options.threadId,
      message: lastUser,
      metadata: JSON.stringify({ format: UI_MESSAGE_METADATA_FORMAT }),
    });
    return id;
  } catch (error) {
    logger.event({
      level: 'warn',
      event: 'chat.turn.user_persist',
      outcome: 'degraded',
      message: 'Failed to persist the user turn message.',
      error,
      data: { thread_id: options.threadId },
    });
  }
  return undefined;
};

/** Durable record of the assistant turn output (partial or completed).
 *  Writes for the same message id are serialized: a late progress write must
 *  never overtake the settle write. */
const assistantUpsertChains = new Map<string, Promise<void>>();

export const persistAssistantTurnMessage = (
  conversation: Pick<ConversationStore, 'upsertTurnMessage'>,
  threadId: string,
  message: { id: string; role: 'assistant'; parts: unknown[] },
  transport: string,
  parentId?: string
): Promise<void> => {
  const run = (assistantUpsertChains.get(message.id) ?? Promise.resolve()).then(async () => {
    try {
      await conversation.upsertTurnMessage({
        id: message.id,
        thread_id: threadId,
        ...(parentId ? { parent_id: parentId } : {}),
        message,
        metadata: JSON.stringify({ format: UI_MESSAGE_METADATA_FORMAT, transport }),
      });
    } catch (error) {
      logger.event({
        level: 'warn',
        event: 'chat.turn.assistant_persist',
        outcome: 'degraded',
        message: 'Failed to persist the assistant turn message.',
        error,
        data: { thread_id: threadId, message_id: message.id },
      });
    }
  });
  assistantUpsertChains.set(
    message.id,
    run.finally(() => {
      if (assistantUpsertChains.get(message.id) === run) assistantUpsertChains.delete(message.id);
    })
  );
  return run;
};

/**
 * Parts of an already-persisted assistant message, used as the reduction seed
 * for an approval-resumed continuation so the accumulated message stays whole
 * across the pause.
 */
export const loadPersistedAssistantParts = (messageId: string): unknown[] | undefined => {
  if (!messageId.trim()) return undefined;
  try {
    const row = chatMessageDb.getChatMessage(messageId);
    if (!row) return undefined;
    const parsed = parseStoredUiMessageRow({ id: row.id, message: row.message });
    const parts =
      parsed && typeof parsed === 'object' ? (parsed as { parts?: unknown }).parts : null;
    return Array.isArray(parts) ? parts : undefined;
  } catch (error) {
    logger.event({
      level: 'warn',
      event: 'chat.turn.seed_load',
      outcome: 'degraded',
      message: 'Failed to load the persisted assistant parts for continuation seeding.',
      error,
      data: { message_id: messageId },
    });
    return undefined;
  }
};
