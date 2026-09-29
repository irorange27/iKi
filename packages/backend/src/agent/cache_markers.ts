import type { ModelMessage } from 'ai';

/** Provider families whose prompt caching is driven by explicit breakpoints. */
export const ANTHROPIC_CACHE_PROVIDER_TYPES = new Set(['anthropic', 'anthropic-compatible']);

/**
 * Anthropic prompt caching: mark the last message as an ephemeral cache
 * breakpoint so the system prompt, tool definitions and the growing history
 * prefix are eligible for provider cache reuse on subsequent steps/batches.
 * A local marker cannot guarantee that Anthropic retains or serves a cache
 * entry; usage metrics report whether a particular request got a hit.
 * Stale breakpoints on earlier messages are stripped first: prepareStep feeds
 * the previous step's marked messages back in, so a leftover marker would pin
 * one of Anthropic's four breakpoint slots to a prefix that no longer grows.
 * The caller's history array is never mutated.
 */
export const stripCacheMarker = (message: ModelMessage): ModelMessage => {
  const source = message as ModelMessage & { providerOptions?: Record<string, any> };
  const anthropicOptions = source.providerOptions?.anthropic;
  if (anthropicOptions?.cacheControl === undefined) return message;
  const { cacheControl: _stale, ...rest } = anthropicOptions;
  return {
    ...source,
    providerOptions: { ...source.providerOptions, anthropic: rest },
  } as ModelMessage;
};

export const withCacheBreakpoint = (providerType: string, messages: ModelMessage[]): ModelMessage[] => {
  if (!ANTHROPIC_CACHE_PROVIDER_TYPES.has(providerType) || messages.length === 0) {
    return messages;
  }

  return messages.map((message, index) => {
    if (index !== messages.length - 1) return stripCacheMarker(message);
    const source = message as ModelMessage & { providerOptions?: Record<string, any> };
    return {
      ...source,
      providerOptions: {
        ...source.providerOptions,
        anthropic: { ...source.providerOptions?.anthropic, cacheControl: { type: 'ephemeral' } },
      },
    } as ModelMessage;
  });
};

/**
 * Marker-free copies for auxiliary requests that own no breakpoint of their
 * own. The compaction summarizer's cache-aware replay uses this on the prefix
 * it receives and then re-marks the prefix tail via {@link withCacheBreakpoint}
 * before sending, so the aux read matches the routed request's cached prefix.
 */
export const withoutCacheMarkers = (messages: ModelMessage[]): ModelMessage[] =>
  messages.map(stripCacheMarker);
