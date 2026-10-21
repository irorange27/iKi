/**
 * Wire-level scalar types used across provider and message code.
 *
 * These used to come from `ai` / `@ai-sdk/provider`, which kept those packages
 * as a type dependency after ADR 009 removed them at runtime. They are plain
 * JSON aliases, declared here so iKi owns its own vocabulary end to end.
 */
export type JsonPrimitive = string | number | boolean | null;
export type JSONValue = JsonPrimitive | JSONValue[] | { [key: string]: JSONValue };
export type JSONObject = { [key: string]: JSONValue };

/** Provider-specific metadata passed through untouched. */
export type ProviderMetadata = Record<string, Record<string, JSONValue>>;
export type SharedV3ProviderOptions = ProviderMetadata;

/** Token accounting as a provider reports it. */
export type LanguageModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  inputTokenDetails?: {
    noCacheTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  outputTokenDetails?: {
    textTokens?: number;
    reasoningTokens?: number;
  };
  /** The provider's own usage payload, kept for diagnostics. */
  raw?: unknown;
};
