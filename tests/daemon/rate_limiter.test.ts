import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRateLimiter } from '../../src/daemon/rate_limiter';

describe('createRateLimiter', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('allows requests up to the limit and then rejects', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 3 });

    expect(limiter.check('client_1')).toEqual({ allowed: true });
    expect(limiter.check('client_1')).toEqual({ allowed: true });
    expect(limiter.check('client_1')).toEqual({ allowed: true });

    const blocked = limiter.check('client_1');
    expect(blocked.allowed).toBe(false);
    expect(typeof blocked.retryAfterMs).toBe('number');
  });

  it('resets per-client buckets independently', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2 });

    expect(limiter.check('client_a')).toEqual({ allowed: true });
    expect(limiter.check('client_a')).toEqual({ allowed: true });
    expect(limiter.check('client_a').allowed).toBe(false);

    expect(limiter.check('client_b')).toEqual({ allowed: true });
    expect(limiter.check('client_b')).toEqual({ allowed: true });
    expect(limiter.check('client_b').allowed).toBe(false);
  });

  it('purges stale buckets to prevent unbounded memory growth', () => {
    let fakeNow = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => fakeNow);

    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2 });

    // client_a makes requests and fills up
    limiter.check('client_a');
    limiter.check('client_a');

    // Advance past both the rate window AND the cleanup interval
    fakeNow += 120_001;

    // A request from client_b triggers cleanup of client_a's stale bucket
    limiter.check('client_b');

    // Now advance past client_b's window + cleanup interval too
    fakeNow += 120_001;

    // Another request triggers cleanup again
    const result = limiter.check('client_c');
    expect(result.allowed).toBe(true);

    vi.restoreAllMocks();
  });

  it('explicit reset removes a client bucket immediately', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2 });

    limiter.check('client_a');
    limiter.check('client_a');
    expect(limiter.check('client_a').allowed).toBe(false);

    limiter.reset('client_a');
    expect(limiter.check('client_a')).toEqual({ allowed: true });
  });
});
