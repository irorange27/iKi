import { getDb } from './database';
import type { ThreadContextEntry } from '../types/memory';
import { toIsoNow } from '../utils/text';
import { createLogger } from '../logger';
import { CHAT_THREAD_CONTEXT_SCHEMA_SQL } from './thread_context_schema';

let threadContextSchemaEnsured = false;
const threadContextLogger = createLogger({ module: 'thread_context_db' });

const isMissingThreadContextTableError = (error: unknown): boolean =>
  error instanceof Error && /no such table:\s*chat_thread_context/i.test(error.message);

const ensureThreadContextSchema = (): boolean => {
  if (threadContextSchemaEnsured) return true;

  try {
    getDb().exec(CHAT_THREAD_CONTEXT_SCHEMA_SQL);
    threadContextSchemaEnsured = true;
    return true;
  } catch (error) {
    threadContextLogger.event({
      level: 'warn',
      event: 'thread_context.schema.ensure',
      outcome: 'failed',
      error,
    });
    return false;
  }
};

const withThreadContextTable = <T>(operation: () => T): T | null => {
  if (!ensureThreadContextSchema()) return null;

  try {
    return operation();
  } catch (error) {
    if (!isMissingThreadContextTableError(error)) {
      throw error;
    }

    threadContextSchemaEnsured = false;
    if (!ensureThreadContextSchema()) return null;

    try {
      return operation();
    } catch (retryError) {
      if (isMissingThreadContextTableError(retryError)) {
        threadContextLogger.event({
          level: 'warn',
          event: 'thread_context.schema.ensure',
          outcome: 'degraded',
          message: 'chat_thread_context table remained unavailable after retry.',
          error: retryError,
        });
        return null;
      }
      throw retryError;
    }
  }
};

export const getThreadContext = (threadId: string): ThreadContextEntry | null => {
  if (!threadId) return null;
  const row = withThreadContextTable(
    () =>
      getDb()
        .prepare('SELECT * FROM chat_thread_context WHERE thread_id = ?')
        .get(threadId) as ThreadContextEntry | undefined
  );
  return row || null;
};

export const upsertThreadContext = (entry: {
  thread_id: string;
  summary: string;
  covered_message_count: number;
  metadata?: unknown;
}) => {
  if (!entry.thread_id || !entry.summary.trim()) return null;

  const now = toIsoNow();
  return withThreadContextTable(() => {
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
  });
};

export const deleteThreadContext = (threadId: string) => {
  if (!threadId) return null;
  return withThreadContextTable(() =>
    getDb().prepare('DELETE FROM chat_thread_context WHERE thread_id = ?').run(threadId)
  );
};
