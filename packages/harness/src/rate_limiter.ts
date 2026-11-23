export type RateLimitConfig = {
  windowMs: number;
  maxRequests: number;
};

type ClientBucket = {
  windowStart: number;
  count: number;
};

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 60;

export const createRateLimiter = (config?: Partial<RateLimitConfig>) => {
  const windowMs = config?.windowMs ?? DEFAULT_WINDOW_MS;
  const maxRequests = config?.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const buckets = new Map<string, ClientBucket>();
  let lastCleanup = Date.now();
  const CLEANUP_INTERVAL_MS = 60_000;

  const pruneStaleBuckets = (now: number) => {
    if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
    lastCleanup = now;
    for (const [clientId, bucket] of buckets) {
      if (now - bucket.windowStart >= windowMs) {
        buckets.delete(clientId);
      }
    }
  };

  const check = (clientId: string): { allowed: boolean; retryAfterMs?: number } => {
    const now = Date.now();
    pruneStaleBuckets(now);

    const bucket = buckets.get(clientId);

    if (!bucket || now - bucket.windowStart >= windowMs) {
      buckets.set(clientId, { windowStart: now, count: 1 });
      return { allowed: true };
    }

    if (bucket.count < maxRequests) {
      bucket.count += 1;
      return { allowed: true };
    }

    const retryAfterMs = windowMs - (now - bucket.windowStart);
    return { allowed: false, retryAfterMs };
  };

  const reset = (clientId: string) => {
    buckets.delete(clientId);
  };

  return { check, reset };
};

export type RateLimiter = ReturnType<typeof createRateLimiter>;
