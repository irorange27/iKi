import type { LanguageModelUsage } from 'ai';

import type { TokenUsageMetrics } from '../../../shared/types/chat_usage';

const clampInteger = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
};

const clampCost = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
};

const readNumeric = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const readCostFromRecord = (record: Record<string, unknown>): number | null => {
  const directKeys = [
    'cost',
    'costUsd',
    'cost_usd',
    'totalCost',
    'total_cost',
    'totalPrice',
    'total_price',
    'price',
    'usd',
  ];

  for (const key of directKeys) {
    const value = readNumeric(record[key]);
    if (value !== null) return value;
  }

  return null;
};

export const extractEstimatedCostUsd = (usage: LanguageModelUsage | undefined): number => {
  const raw = usage?.raw;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 0;

  const directCost = readCostFromRecord(raw as Record<string, unknown>);
  if (directCost !== null) return clampCost(directCost);

  const nestedKeys = ['usage', 'billing', 'metadata', 'cost'];
  for (const key of nestedKeys) {
    const nested = (raw as Record<string, unknown>)[key];
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue;
    const nestedCost = readCostFromRecord(nested as Record<string, unknown>);
    if (nestedCost !== null) return clampCost(nestedCost);
  }

  return 0;
};

export const normalizeLanguageModelUsage = (
  usage: LanguageModelUsage | undefined
): TokenUsageMetrics => {
  const inputTokens = clampInteger(usage?.inputTokens);
  const outputTokens = clampInteger(usage?.outputTokens);
  const cacheReadTokens = clampInteger(
    usage?.inputTokenDetails?.cacheReadTokens ?? usage?.cachedInputTokens
  );
  const cacheWriteTokens = clampInteger(usage?.inputTokenDetails?.cacheWriteTokens);
  const reasoningTokens = clampInteger(
    usage?.outputTokenDetails?.reasoningTokens ?? usage?.reasoningTokens
  );
  const totalTokens = Math.max(clampInteger(usage?.totalTokens), inputTokens + outputTokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    estimatedCostUsd: extractEstimatedCostUsd(usage),
  };
};
