import { getDb } from './database';
import { createLogger } from '@iki/backend/logger';
import { createPrefixedId } from '@iki/backend/utils/id';

const lockLogger = createLogger({ module: 'thread_run_locks' });

// A turn can outlive the TTL by hours (autonomous batches, approval waits), so
// the holder refreshes the lease on a heartbeat; the TTL only bounds how long
// a crashed process can block a thread.
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
      // Connection already rolled back (e.g. SQLITE_BUSY); nothing to undo.
    }
    throw error;
  }
};


/**
 * Cross-process admission lease for thread turns, persisted in the SQLite
 * database every shell (desktop, daemon) already shares. Extends the
 * in-memory coordinator lease: a thread with a live turn in another process
 * must return busy here too. Expired leases (crashed holder) are reclaimed.
 *
 * The returned release function is idempotent and only deletes the caller's
 * own lease row, so a stale release after TTL expiry cannot drop a lease
 * another process legitimately re-acquired.
 *
 * Loss detection: if a heartbeat refresh updates zero rows the lease was
 * reclaimed by another process (TTL expiry while this holder stalled), and
 * `onLeaseLost` fires exactly once so the holder can abort its run instead of
 * continuing beside the new owner.
 */
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

  // Single synchronous attempt: BEGIN IMMEDIATE either wins the write lock or
  // reports real contention from the process holding it, which is exactly the
  // "thread busy" answer this lease exists to give.
  let acquired = false;
  try {
    acquired = attemptAcquire();
  } catch (error) {
    // Never let lease bookkeeping break a turn: report contention so the
    // caller surfaces its normal "thread busy" answer.
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
        // Another process reclaimed the expired lease: stop holding court and
        // let the run abort rather than double-running the thread.
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
      // Transient database errors keep the holder running: the lease may
      // still be ours, and aborting on one failed refresh would kill healthy
      // turns. Zero-row updates above are the definitive loss signal.
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
