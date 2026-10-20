// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase, getDb, initializeDatabase } from '@iki/backend/db/database';
import { getChatMessages } from '@iki/backend/db/chat_message';
import { getSessionEvents } from '@iki/backend/db/session_events';
import { createChatPersistence } from '@iki/backend/turn_prep/persistence';
import { truncateAfterMessage } from '@iki/backend/thread_session/history_truncation';
import { rebuildResumeHistoryFromEvents } from '@iki/backend/thread_session/run_rehydrator';
import {
  INPUT_ACCEPTED,
  MESSAGES_TRUNCATED,
  MODEL_OUTPUT_COMMITTED,
  SESSION_EVENT_VERSION,
  rebuildThreadViewFromEvents,
  recordSessionEvents,
} from '@iki/backend/thread_session/session_log';

const memory = {
  onMessagePersisted: () => undefined,
  injectMemoryIntoMessages: (messages: unknown[]) => messages,
  getAffectContextMessage: () => '',
};

const uiMessageJson = (id: string, role: 'user' | 'assistant', text: string) =>
  JSON.stringify({ id, role, parts: [{ type: 'text', text }] });

/** Persist a conversation turn the way the durable layer does: a
 *  chat_messages row (display projection) AND the matching session-log fact
 *  (recovery authority) — the dual write the truncate must keep consistent. */
const seedTurn = (
  conversation: ReturnType<typeof createChatPersistence>,
  threadId: string,
  id: string,
  role: 'user' | 'assistant',
  text: string,
  timestamp: string
) => {
  const message = uiMessageJson(id, role, text);
  conversation.createMessage({
    id,
    thread_id: threadId,
    message,
    timestamp,
    metadata: JSON.stringify({ format: 'ai-ui-message-v1' }),
  });
  recordSessionEvents(threadId, [
    {
      type: role === 'user' ? INPUT_ACCEPTED : MODEL_OUTPUT_COMMITTED,
      version: SESSION_EVENT_VERSION,
      payload:
        role === 'user'
          ? { messageId: id, message: JSON.parse(message) }
          : { messageId: id, message: JSON.parse(message), transport: 'ipc', runId: `run_${id}` },
    },
  ]);
};

// P5 boundary regression: history truncation on edit/resend is the ONE
// backend-owned atomic transaction. The renderer loop that fired
// chat.deleteMessage per row was non-atomic AND never landed the deletion in
// the session log, so after a crash the replay rebuilt history INCLUDING the
// messages the user deleted — the displayed projection and the recovery
// authority (ADR 008: chat_events/session_events is the sole recovery
// authority) disagreed. These tests pin both halves: the single-transaction
// delete, and the replay that yields the truncated state.
describe('backend-owned atomic history truncation (P5)', () => {
  let dataDir = '';
  let conversation: ReturnType<typeof createChatPersistence>;

  const seedConversation = (threadId: string) => {
    conversation.createThread({ id: threadId });
    seedTurn(conversation, threadId, 'user_1', 'user', 'first question', '2026-01-01T00:00:01.000Z');
    seedTurn(conversation, threadId, 'assistant_1', 'assistant', 'first answer', '2026-01-01T00:00:02.000Z');
    seedTurn(conversation, threadId, 'user_2', 'user', 'follow-up', '2026-01-01T00:00:03.000Z');
    seedTurn(conversation, threadId, 'assistant_2', 'assistant', 'second answer', '2026-01-01T00:00:04.000Z');
    conversation.createMessage({
      id: 'other_thread_msg',
      thread_id: 'thread_other',
      message: uiMessageJson('other_thread_msg', 'assistant', 'must never be touched'),
      timestamp: '2026-01-01T00:00:05.000Z',
      metadata: '{}',
    });
  };

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'iki-chat-truncate-'));
    initializeDatabase({ dbPath: path.join(dataDir, 'truncate.db') });
    conversation = createChatPersistence({
      memory: memory as never,
      onContinuityMessagePersisted: async () => undefined,
    });
    conversation.createThread({ id: 'thread_other' });
  });

  afterAll(async () => {
    closeDatabase();
    await rm(dataDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    for (const threadId of ['thread_t', 'thread_last', 'thread_missing']) {
      getDb().prepare('DELETE FROM chat_messages WHERE thread_id = ?').run(threadId);
      getDb().prepare('DELETE FROM session_events WHERE thread_id = ?').run(threadId);
      getDb().prepare('DELETE FROM chat_threads WHERE id = ?').run(threadId);
    }
  });

  it('deletes the rows strictly after the anchor and appends the truncation fact in one transaction', () => {
    seedConversation('thread_t');

    const result = truncateAfterMessage('thread_t', 'user_1');

    expect(result).toMatchObject({ success: true, deletedIds: ['assistant_1', 'user_2', 'assistant_2'] });
    // The anchor stays; the tail rows are gone; another thread is untouched.
    expect(getChatMessages('thread_t').map(row => row.id)).toEqual(['user_1']);
    expect(getChatMessages('thread_other').map(row => row.id)).toEqual(['other_thread_msg']);

    // The deletion landed in the session log — the recovery authority now
    // knows the user deleted these rows.
    const events = getSessionEvents('thread_t', [MESSAGES_TRUNCATED]);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      afterMessageId: 'user_1',
      deletedMessageIds: ['assistant_1', 'user_2', 'assistant_2'],
    });
  });

  it('is idempotent for a missing anchor and a no-op for the last message', () => {
    seedConversation('thread_t');

    const missing = truncateAfterMessage('thread_t', 'never_existed');
    expect(missing).toEqual({ success: true, deletedIds: [] });
    expect(getChatMessages('thread_t')).toHaveLength(4);
    expect(getSessionEvents('thread_t', [MESSAGES_TRUNCATED])).toHaveLength(0);

    const last = truncateAfterMessage('thread_t', 'assistant_2');
    expect(last).toEqual({ success: true, deletedIds: [] });
    expect(getChatMessages('thread_t')).toHaveLength(4);
    expect(getSessionEvents('thread_t', [MESSAGES_TRUNCATED])).toHaveLength(0);
  });

  it('refuses an unknown thread and writes nothing', () => {
    seedConversation('thread_t');
    const before = getChatMessages('thread_t').length;

    const result = truncateAfterMessage('thread_missing_entirely', 'user_1');

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(getChatMessages('thread_t').length).toBe(before);
    expect(getSessionEvents('thread_t', [MESSAGES_TRUNCATED])).toHaveLength(0);
  });

  it('an anchor from ANOTHER thread is not treated as this thread\'s tail', () => {
    seedConversation('thread_t');

    const result = truncateAfterMessage('thread_other', 'user_1');

    // user_1 exists, but not in thread_other — idempotent no-op, nothing deleted.
    expect(result).toEqual({ success: true, deletedIds: [] });
    expect(getChatMessages('thread_t')).toHaveLength(4);
  });

  it('FAIL-CLOSED: a session-log append failure rolls the row deletes back (no half-truncation)', () => {
    seedConversation('thread_t');

    // Break the fact insert only: the truncate must throw with the DELETE
    // rolled back in the same transaction — never the old loop's outcome of
    // rows gone and the log unaware.
    const db = getDb();
    const originalPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      if (sql.includes('INSERT INTO session_events')) {
        throw new Error('simulated session-log write failure');
      }
      return originalPrepare(sql);
    };
    try {
      expect(() => truncateAfterMessage('thread_t', 'user_1')).toThrow(
        /simulated session-log write failure/
      );
    } finally {
      db.prepare = originalPrepare;
    }

    // The rows survived the failed truncate — the projection and the log
    // land together or not at all.
    expect(getChatMessages('thread_t')).toHaveLength(4);
    expect(getSessionEvents('thread_t', [MESSAGES_TRUNCATED])).toHaveLength(0);
  });

  it('replay yields the TRUNCATED state — the crash-recovery consistency the old renderer loop broke', async () => {
    seedConversation('thread_t');
    // Sanity: before truncation the replay shows the whole conversation.
    expect(rebuildThreadViewFromEvents('thread_t').messages.map(m => m.id)).toEqual([
      'user_1',
      'assistant_1',
      'user_2',
      'assistant_2',
    ]);

    truncateAfterMessage('thread_t', 'user_1');

    // "Crash": rebuild the conversation from the event stream alone — the
    // same pure replay path session_log_replay pins and recovery consumers
    // use. On the OLD path (renderer loop of per-row deletes, no log write)
    // this replay still contained assistant_1 / user_2 / assistant_2: the
    // displayed state and the recovery authority disagreed.
    const view = rebuildThreadViewFromEvents('thread_t');
    expect(view.messages.map(message => message.id)).toEqual(['user_1']);

    // The recovery INPUT (the ADR 008 F3 consumer a resumed/retried turn
    // rides) likewise sees only the kept conversation.
    const recovered = await rebuildResumeHistoryFromEvents('thread_t');
    expect(recovered).not.toBeNull();
    expect(JSON.stringify(recovered!.history)).not.toContain('follow-up');
    expect(JSON.stringify(recovered!.history)).not.toContain('second answer');

    // Truncate at the last message: replay is the whole conversation minus
    // nothing — the tail was already gone.
    seedConversation('thread_last');
    truncateAfterMessage('thread_last', 'assistant_2');
    expect(rebuildThreadViewFromEvents('thread_last').messages.map(m => m.id)).toEqual([
      'user_1',
      'assistant_1',
      'user_2',
      'assistant_2',
    ]);

    // Re-truncate at the same anchor (the user edits twice): the tail rows
    // are already gone, so this is an idempotent no-op — no second fact, and
    // replay still yields exactly the kept conversation.
    const restated = truncateAfterMessage('thread_t', 'user_1');
    expect(restated).toEqual({ success: true, deletedIds: [] });
    expect(getSessionEvents('thread_t', [MESSAGES_TRUNCATED])).toHaveLength(1);
    expect(rebuildThreadViewFromEvents('thread_t').messages.map(message => message.id)).toEqual([
      'user_1',
    ]);
  });

  it('RED DEMONSTRATION (old path): the renderer-style per-row delete loop leaves replay disagreeing with the display', () => {
    seedConversation('thread_t');

    // This test PINS the P5 defect: before the backend owner existed, the
    // renderer truncated by firing chat.deleteMessage once per row. Rows
    // disappeared from chat_messages, but the session log kept the input and
    // committed-output facts — so the crash-recovery replay still rebuilt
    // the deleted messages. The assertion is that the OLD mechanism yields
    // the WRONG replay; the truncateAfterMessage suites above are the fix.
    const tail = getChatMessages('thread_t')
      .slice(1)
      .map(row => row.id);
    for (const id of tail) conversation.deleteMessage(id);

    // The display projection lost the tail...
    expect(getChatMessages('thread_t').map(row => row.id)).toEqual(['user_1']);
    // ...and the recovery authority did not: replay still yields all four
    // messages. The two projections of one conversation disagree — exactly
    // what ADR 008 forbids.
    const view = rebuildThreadViewFromEvents('thread_t');
    expect(view.messages.map(message => message.id)).toEqual([
      'user_1',
      'assistant_1',
      'user_2',
      'assistant_2',
    ]);
    expect(getSessionEvents('thread_t', [MESSAGES_TRUNCATED])).toHaveLength(0);
  });
});
