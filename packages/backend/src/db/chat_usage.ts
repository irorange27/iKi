import { commitRows, readRows } from './collection';
import { clampNonNegativeInteger, clampNonNegativeNumber } from '@iki/backend/utils/text';
import type {
  ChatUsageDailyPoint,
  ChatUsageEvent,
  ChatUsageMonthlyPoint,
  ChatUsageTotals,
} from '@iki/backend/types/chat_usage';

type ChatUsageRange = { from?: string | null; to?: string | null };

type UsageAggregate = {
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  estimatedCostUsd: number;
};

const COLLECTION = 'chat_usage_events';

const sanitizeSource = (value: unknown): string => {
  if (typeof value !== 'string') return 'chat';
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : 'chat';
};

const inRange = (createdAt: string, range?: ChatUsageRange): boolean => {
  const from = typeof range?.from === 'string' ? range.from.trim() : '';
  const to = typeof range?.to === 'string' ? range.to.trim() : '';
  if (from && createdAt < from) return false;
  if (to && createdAt > to) return false;
  return true;
};

const emptyAggregate = (): UsageAggregate => ({
  messageCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  estimatedCostUsd: 0,
});

const addInto = (aggregate: UsageAggregate, row: ChatUsageEvent): void => {
  aggregate.messageCount += 1;
  aggregate.inputTokens += row.input_tokens;
  aggregate.outputTokens += row.output_tokens;
  aggregate.totalTokens += row.total_tokens;
  aggregate.cacheReadTokens += row.cache_read_tokens;
  aggregate.cacheWriteTokens += row.cache_write_tokens;
  aggregate.reasoningTokens += row.reasoning_tokens;
  aggregate.estimatedCostUsd += row.estimated_cost_usd;
};

const toTotals = (aggregate: UsageAggregate): ChatUsageTotals => ({
  messageCount: clampNonNegativeInteger(aggregate.messageCount),
  inputTokens: clampNonNegativeInteger(aggregate.inputTokens),
  outputTokens: clampNonNegativeInteger(aggregate.outputTokens),
  totalTokens: clampNonNegativeInteger(aggregate.totalTokens),
  cacheReadTokens: clampNonNegativeInteger(aggregate.cacheReadTokens),
  cacheWriteTokens: clampNonNegativeInteger(aggregate.cacheWriteTokens),
  reasoningTokens: clampNonNegativeInteger(aggregate.reasoningTokens),
  estimatedCostUsd: clampNonNegativeNumber(aggregate.estimatedCostUsd),
});

const rowsInRange = (range?: ChatUsageRange): ChatUsageEvent[] =>
  readRows<ChatUsageEvent>(COLLECTION).filter(row => inRange(String(row.created_at), range));

export const addChatUsageEvent = (
  input: Pick<
    ChatUsageEvent,
    | 'id'
    | 'provider_type'
    | 'model'
    | 'input_tokens'
    | 'output_tokens'
    | 'total_tokens'
    | 'cache_read_tokens'
    | 'cache_write_tokens'
    | 'reasoning_tokens'
    | 'estimated_cost_usd'
    | 'created_at'
    | 'metadata'
    | 'source'
  > &
    Partial<Pick<ChatUsageEvent, 'thread_id' | 'message_id'>>
) => {
  const row: ChatUsageEvent = {
    id: input.id,
    thread_id:
      typeof input.thread_id === 'string' && input.thread_id.trim() ? input.thread_id : null,
    message_id:
      typeof input.message_id === 'string' && input.message_id.trim() ? input.message_id : null,
    provider_type: input.provider_type,
    model: input.model,
    input_tokens: clampNonNegativeInteger(input.input_tokens),
    output_tokens: clampNonNegativeInteger(input.output_tokens),
    total_tokens: clampNonNegativeInteger(input.total_tokens),
    cache_read_tokens: clampNonNegativeInteger(input.cache_read_tokens),
    cache_write_tokens: clampNonNegativeInteger(input.cache_write_tokens),
    reasoning_tokens: clampNonNegativeInteger(input.reasoning_tokens),
    estimated_cost_usd: clampNonNegativeNumber(input.estimated_cost_usd),
    source: sanitizeSource(input.source),
    metadata: typeof input.metadata === 'string' && input.metadata.trim() ? input.metadata : '{}',
    created_at: input.created_at,
  };
  const rows = readRows<ChatUsageEvent>(COLLECTION);
  rows.push(row);
  commitRows(COLLECTION, rows);
  return { changes: 1, lastInsertRowid: 0 };
};

export const getChatUsageTotals = (range?: ChatUsageRange): ChatUsageTotals => {
  const aggregate = emptyAggregate();
  for (const row of rowsInRange(range)) addInto(aggregate, row);
  return toTotals(aggregate);
};

const bucketBy = <K extends 'date' | 'month'>(
  range: ChatUsageRange | undefined,
  key: K,
  sliceLength: number
): Array<{ bucket: string; aggregate: UsageAggregate }> => {
  const buckets = new Map<string, UsageAggregate>();
  for (const row of rowsInRange(range)) {
    const bucket = String(row.created_at).slice(0, sliceLength);
    let aggregate = buckets.get(bucket);
    if (!aggregate) {
      aggregate = emptyAggregate();
      buckets.set(bucket, aggregate);
    }
    addInto(aggregate, row);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucket, aggregate]) => ({ bucket, aggregate }));
};

export const listChatUsageDaily = (range?: ChatUsageRange): ChatUsageDailyPoint[] =>
  bucketBy(range, 'date', 10).map(({ bucket, aggregate }) => ({
    date: bucket,
    ...toTotals(aggregate),
  }));

export const listChatUsageMonthly = (range?: ChatUsageRange): ChatUsageMonthlyPoint[] =>
  bucketBy(range, 'month', 7).map(({ bucket, aggregate }) => ({
    month: bucket,
    ...toTotals(aggregate),
  }));
