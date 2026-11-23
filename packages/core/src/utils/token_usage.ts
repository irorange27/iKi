export type TokenUsageCounts = {
  inputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  outputTokens?: number | null;
};

/**
 * Wire and harness `inputTokens` represent the full prompt (`input + cacheRead + cacheWrite`).
 * Only `cacheReadTokens` is a cache hit (`cacheWriteTokens` is a cache miss written into the
 * cache for subsequent turns), so UI surfaces show `cache` from `cacheReadTokens` and `in`/`Input`
 * from non-cache-hit input (`inputTokens - cacheReadTokens`).
 */
export const getCachedInputTokens = (usage: TokenUsageCounts): number =>
  typeof usage.cacheReadTokens === 'number' && Number.isFinite(usage.cacheReadTokens)
    ? Math.max(0, usage.cacheReadTokens)
    : 0;

/** Non-cache-hit input tokens (`input + cacheWrite`). */
export const getUncachedInputTokens = (usage: TokenUsageCounts): number => {
  const totalInput =
    typeof usage.inputTokens === 'number' && Number.isFinite(usage.inputTokens)
      ? Math.max(0, usage.inputTokens)
      : 0;
  return Math.max(0, totalInput - getCachedInputTokens(usage));
};
