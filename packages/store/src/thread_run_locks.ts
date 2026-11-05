/**
 * In-process run leases.
 *
 * A prototype is one process (pi's contract: "One process owns a storage at a
 * time; there is no cross-process locking"). Holding a thread while a turn runs is
 * still useful — it refuses a second concurrent turn on the same thread — so the
 * lease lives in a module-level map with a TTL and a heartbeat, same public API as
 * the SQL version it replaced.
 */

import { createLogger } from '@iki/core/logger';
import { createPrefixedId } from '@iki/core/utils/id';

const lockLogger = createLogger({ module: 'thread_run_locks' });

const LEASE_TTL_MS = 120_000;
const LEASE_REFRESH_INTERVAL_MS = 30_000;

type Lease = { token: string; expiresAt: number };

const leases = new Map<string, Lease>();

const pruneExpired = (now: number): void => {
  for (const [threadId, lease] of leases) {
    if (lease.expiresAt <= now) leases.delete(threadId);
  }
};

export const hasLiveThreadRunLease = (threadId: string): boolean => {
  const lease = leases.get(threadId);
  if (!lease) return false;
  if (lease.expiresAt <= Date.now()) {
    leases.delete(threadId);
    return false;
  }
  return true;
};

export const tryAcquireCrossProcessThreadRun = (
  threadId: string,
  options?: {
    onLeaseLost?: () => void;
    refreshIntervalMs?: number;
  }
): (() => void) | null => {
  const token = createPrefixedId('runlease');
  const now = Date.now();
  pruneExpired(now);
  if (leases.has(threadId)) return null;

  leases.set(threadId, { token, expiresAt: now + LEASE_TTL_MS });

  let leaseLost = false;
  const heartbeat = setInterval(() => {
    if (leaseLost) return;
    const lease = leases.get(threadId);
    if (!lease || lease.token !== token) {
      leaseLost = true;
      clearInterval(heartbeat);
      lockLogger.event({
        level: 'warn',
        event: 'thread_run_lock.heartbeat',
        outcome: 'failed',
        entity: { thread_id: threadId },
        message: 'Thread run lease was reclaimed; aborting holder.',
      });
      options?.onLeaseLost?.();
      return;
    }
    lease.expiresAt = Date.now() + LEASE_TTL_MS;
  }, options?.refreshIntervalMs ?? LEASE_REFRESH_INTERVAL_MS);
  heartbeat.unref?.();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    clearInterval(heartbeat);
    const lease = leases.get(threadId);
    if (lease && lease.token === token) leases.delete(threadId);
  };
};

/** Test hook: drop all leases. */
export const resetThreadRunLocksForTests = (): void => {
  leases.clear();
};
