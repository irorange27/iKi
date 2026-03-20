import { getDb } from './database';
import type { ThreadContextEntry } from '../../shared/types/memory';

const nowIso = () => new Date().toISOString();

export const getThreadContext = (threadId: string): ThreadContextEntry | null => {
  if (!threadId) return null;
  const row = getDb()
    .prepare('SELECT * FROM chat_thread_context WHERE thread_id = ?')
    .get(threadId) as ThreadContextEntry | undefined;
  return row || null;
};

export const upsertThreadContext = (entry: {
  thread_id: string;
  summary: string;
  covered_message_count: number;
  metadata?: unknown;
}) => {
  if (!entry.thread_id || !entry.summary.trim()) return null;

  const now = nowIso();
  const stmt = getDb().prepare(`
    INSERT INTO chat_thread_context (
      thread_id, summary, covered_message_count, metadata, created_at, updated_at
    ) VALUES (
      @thread_id, @summary, @covered_message_count, @metadata, @created_at, @updated_at
    )
    ON CONFLICT(thread_id) DO UPDATE SET
      summary = excluded.summary,
      covered_message_count = excluded.covered_message_count,
      metadata = excluded.metadata,
      updated_at = excluded.updated_at
  `);

  return stmt.run({
    thread_id: entry.thread_id,
    summary: entry.summary,
    covered_message_count: Math.max(0, Math.trunc(entry.covered_message_count || 0)),
    metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
    created_at: now,
    updated_at: now,
  });
};

export const deleteThreadContext = (threadId: string) => {
  if (!threadId) return null;
  return getDb().prepare('DELETE FROM chat_thread_context WHERE thread_id = ?').run(threadId);
};
