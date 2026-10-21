import { findMessageEvent } from '@iki/backend/db/session_events';
import * as chatThreadDb from '@iki/backend/db/chat_thread';
import { getDb } from '@iki/backend/db/database';
import { insertSessionEventsAtHead } from '@iki/backend/db/session_events';
import {
  MESSAGES_TRUNCATED,
  SESSION_EVENT_VERSION,
  type MessagesTruncatedPayload,
} from './session_log';

export type TruncateHistoryResult = {
  success: boolean;

  deletedIds: string[];
  error?: string;
};

export const truncateAfterMessage = (
  threadId: string,
  messageId: string
): TruncateHistoryResult => {
  const normalizedThreadId = typeof threadId === 'string' ? threadId.trim() : '';
  const normalizedMessageId = typeof messageId === 'string' ? messageId.trim() : '';
  if (!normalizedThreadId) return { success: false, deletedIds: [], error: 'Missing thread ID' };
  if (!normalizedMessageId)
    return { success: false, deletedIds: [], error: 'Missing message ID' };

  const db = getDb();

  const tailWhere = 'thread_id = ? AND (timestamp, created_at, id) > (?, ?, ?)';

  return db.transaction((): TruncateHistoryResult => {
    if (!chatThreadDb.getChatThread(normalizedThreadId)) {
      return { success: false, deletedIds: [], error: 'Thread not found' };
    }

    const anchorEvent = findMessageEvent(normalizedMessageId, normalizedThreadId);
    if (!anchorEvent) {
      return { success: true, deletedIds: [] };
    }

    const payload: MessagesTruncatedPayload = {
      afterMessageId: normalizedMessageId,

      deletedMessageIds: [],
      truncatedAt: new Date().toISOString(),
    };
    insertSessionEventsAtHead(normalizedThreadId, [
      { type: MESSAGES_TRUNCATED, version: SESSION_EVENT_VERSION, payload },
    ]);

    return { success: true, deletedIds: [] };
  })();
};
