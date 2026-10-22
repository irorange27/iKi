import { getDb } from './database';
import { createLogger } from '@iki/backend/logger';
import { createPrefixedId } from '@iki/backend/utils/id';

const lockLogger = createLogger({ module: 'thread_run_locks' });

const LEASE_TTL_MS = 120_000;
const LEASE_REFRESH_INTERVAL_MS = 30_000;

const withImmediateTransaction = <T>(run: () => T): T => {
  getDb().exec('BEGIN IMMEDIATE');
  try {
    const result = run();
    getDb().exec('COMMIT');
    return result;
  } catch (error) {
    try {
      getDb().exec('ROLLBACK');
    } catch {
    // Intentionally ignored: the caller cannot act on it.
  }
    throw error;
  }
};

export const hasLiveThreadRunLease = (threadId: string): boolean => {
  try {
    const row = getDb()
      .prepare('SELECT 1 FROM thread_run_locks WHERE thread_id = ? AND expires_at > ? LIMIT 1')
      .get(threadId, Date.now());
    return row !== undefined;
  } catch (error) {
    lockLogger.event({
      level: 'warn',
      event: 'thread_run_lock.lease_probe',
      outcome: 'degraded',
      error,
      entity: { thread_id: threadId },
      message: 'Live-lease probe failed; treating the thread as live.',
    });

    return true;
  }
};

export const tryAcquireCrossProcessThreadRun = (
  threadId: string,
  options?: {
    onLeaseLost?: () => void;
    refreshIntervalMs?: number;
  }
): (() => void) | null => {
  const token = createPrefixedId('runlease');

  const attemptAcquire = (): boolean => {
    const now = Date.now();
    return withImmediateTransaction(() => {
      getDb()
        .prepare('DELETE FROM thread_run_locks WHERE expires_at <= ?')
        .run(now);
      const inserted = getDb()
        .prepare(
          'INSERT OR IGNORE INTO thread_run_locks (thread_id, token, expires_at) VALUES (?, ?, ?)'
        )
        .run(threadId, token, now + LEASE_TTL_MS);
      return inserted.changes > 0;
    });
  };

  let acquired = false;
  try {
    acquired = attemptAcquire();
  } catch (error) {

    lockLogger.event({
      level: 'warn',
      event: 'thread_run_lock.acquire',
      outcome: 'degraded',
      error,
      entity: { thread_id: threadId },
      message: 'Cross-process lease acquire failed; treating thread as busy.',
    });
    return null;
  }
  if (!acquired) return null;

  let leaseLost = false;
  const heartbeat = setInterval(() => {
    if (leaseLost) return;
    try {
      const refreshed = getDb()
        .prepare(
          'UPDATE thread_run_locks SET expires_at = ? WHERE thread_id = ? AND token = ?'
        )
        .run(Date.now() + LEASE_TTL_MS, threadId, token);
      if (Number(refreshed.changes) === 0) {

        leaseLost = true;
        clearInterval(heartbeat);
        lockLogger.event({
          level: 'warn',
          event: 'thread_run_lock.heartbeat',
          outcome: 'failed',
          entity: { thread_id: threadId },
          message: 'Thread run lease was reclaimed by another process; aborting holder.',
        });
        options?.onLeaseLost?.();
        return;
      }
    } catch (error) {

      lockLogger.event({
        level: 'warn',
        event: 'thread_run_lock.heartbeat',
        outcome: 'degraded',
        error,
        entity: { thread_id: threadId },
      });
    }
  }, options?.refreshIntervalMs ?? LEASE_REFRESH_INTERVAL_MS);
  heartbeat.unref?.();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    clearInterval(heartbeat);
    try {
      getDb()
        .prepare('DELETE FROM thread_run_locks WHERE thread_id = ? AND token = ?')
        .run(threadId, token);
    } catch (error) {
      lockLogger.event({
        level: 'warn',
        event: 'thread_run_lock.release',
        outcome: 'degraded',
        error,
        entity: { thread_id: threadId },
      });
    }
  };
};
