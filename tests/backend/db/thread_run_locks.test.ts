// @vitest-environment node
/**
 * Run leases are in-process now (one process owns a prototype store). The contract
 * is unchanged: a second acquire on the same thread is refused, a lease expires, a
 * lost lease fires onLeaseLost, and releasing frees the thread.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  hasLiveThreadRunLease,
  resetThreadRunLocksForTests,
  tryAcquireCrossProcessThreadRun,
} from '@iki/backend/db/thread_run_locks';

afterEach(() => {
  resetThreadRunLocksForTests();
  vi.useRealTimers();
});

describe('thread run leases', () => {
  it('grants one lease per thread and refuses a second', () => {
    const release = tryAcquireCrossProcessThreadRun('thread_a');
    expect(release).not.toBeNull();
    expect(hasLiveThreadRunLease('thread_a')).toBe(true);
    expect(tryAcquireCrossProcessThreadRun('thread_a')).toBeNull();
    release!();
    expect(hasLiveThreadRunLease('thread_a')).toBe(false);
    expect(tryAcquireCrossProcessThreadRun('thread_a')).not.toBeNull();
  });

  it('keeps threads independent', () => {
    tryAcquireCrossProcessThreadRun('thread_a');
    expect(tryAcquireCrossProcessThreadRun('thread_b')).not.toBeNull();
  });

  it('treats an expired lease as free', () => {
    vi.useFakeTimers();
    tryAcquireCrossProcessThreadRun('thread_a', { refreshIntervalMs: 10_000_000 });
    expect(hasLiveThreadRunLease('thread_a')).toBe(true);
    vi.advanceTimersByTime(130_000); // past LEASE_TTL_MS with no heartbeat
    expect(hasLiveThreadRunLease('thread_a')).toBe(false);
  });

  it('is idempotent on release', () => {
    const release = tryAcquireCrossProcessThreadRun('thread_a')!;
    release();
    expect(() => release()).not.toThrow();
  });
});
