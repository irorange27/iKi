import * as chatMessageDb from '@iki/backend/db/chat_message';
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
  /** The message ids whose chat_messages rows this call deleted (empty for
   *  a no-op truncate). */
  deletedIds: string[];
  error?: string;
};

/**
 * The ONE owner of user-driven history truncation (edit/resend). A renderer
 * loop of single-row deletes was non-atomic (a mid-loop failure left a
 * half-truncated conversation) and never reached the session log, so a crash
 * replay rebuilt history INCLUDING the rows the user deleted — the display
 * projection and the recovery authority disagreed (ADR 008: the session log
 * is the sole recovery authority).
 *
 * Contract: inside ONE SQLite transaction, delete every chat_messages row of
 * the thread that sorts strictly AFTER `messageId` in the display order
 * (`timestamp ASC, created_at ASC, id ASC` — the same order
 * `getChatMessages` reads), and append a `messages_truncated` fact naming
 * the anchor and the deleted ids, so `rebuildThreadViewFromEvents` yields
 * the truncated view. The anchor row itself is KEPT — it is the edited
 * message the user is resending.
 *
 * Semantics:
 * - Unknown thread: refused ({ success: false }) — nothing is written.
 * - Missing anchor messageId: idempotent success with no deletes and no
 *   fact (already-truncated or never-persisted tail).
 * - Fail-closed: a fact-append failure throws with the row deletes rolled
 *   back, so rows and log can never land on only one side (same discipline
 *   as recordSessionEvents, ADR 008 F1). The enclosing transaction is why
 *   the append goes through insertSessionEventsAtHead (no self-committed
 *   transaction) instead of recordSessionEvents.
 */
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
  // The display order (getChatMessages: timestamp ASC, created_at ASC, id
  // ASC — all three columns are NOT NULL in the schema). A row-value
  // comparison against the anchor's own triple means exactly "strictly
  // after the anchor in that order", so there is no second slicing rule to
  // keep in sync with the read path's ORDER BY.
  const tailWhere = 'thread_id = ? AND (timestamp, created_at, id) > (?, ?, ?)';

  return db.transaction((): TruncateHistoryResult => {
    if (!chatThreadDb.getChatThread(normalizedThreadId)) {
      return { success: false, deletedIds: [], error: 'Thread not found' };
    }

    const anchor = chatMessageDb.getChatMessage(normalizedMessageId);
    if (!anchor || anchor.thread_id !== normalizedThreadId) {
      return { success: true, deletedIds: [] };
    }

    const rows = db
      .prepare(
        `SELECT id FROM chat_messages WHERE ${tailWhere}
         ORDER BY timestamp ASC, created_at ASC, id ASC`
      )
      .all(
        normalizedThreadId,
        anchor.timestamp,
        anchor.created_at,
        anchor.id
      ) as { id: string }[];
    const deletedIds = rows.map(row => row.id);

    if (deletedIds.length > 0) {
      db.prepare(`DELETE FROM chat_messages WHERE ${tailWhere}`).run(
        normalizedThreadId,
        anchor.timestamp,
        anchor.created_at,
        anchor.id
      );
      const payload: MessagesTruncatedPayload = {
        afterMessageId: normalizedMessageId,
        deletedMessageIds: deletedIds,
        truncatedAt: new Date().toISOString(),
      };
      insertSessionEventsAtHead(normalizedThreadId, [
        { type: MESSAGES_TRUNCATED, version: SESSION_EVENT_VERSION, payload },
      ]);
    }

    return { success: true, deletedIds };
  })();
};
