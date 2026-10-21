
export type JsonPrimitive = string | number | boolean | null;
export type JSONValue = JsonPrimitive | JSONValue[] | { [key: string]: JSONValue };
export type JSONObject = { [key: string]: JSONValue };

export type ProviderMetadata = Record<string, Record<string, JSONValue>>;
export type SharedV3ProviderOptions = ProviderMetadata;

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

  raw?: unknown;
};
