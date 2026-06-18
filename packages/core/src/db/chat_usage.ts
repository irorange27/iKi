import { getDb } from './database';
import type {
  ChatUsageDailyPoint,
  ChatUsageEvent,
  ChatUsageMonthlyPoint,
  ChatUsageTotals,
} from '../types/chat_usage';

type ChatUsageRange = {
  from?: string | null;
  to?: string | null;
};

type UsageAggregateRow = {
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  estimatedCostUsd: number;
};

const clampInteger = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
};

const clampCost = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
};

const sanitizeSource = (value: unknown): string => {
  if (typeof value !== 'string') return 'chat';
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : 'chat';
};

const buildWhereClause = (
  range?: ChatUsageRange
): {
  whereSql: string;
  params: Record<string, string>;
} => {
  const conditions: string[] = [];
  const params: Record<string, string> = {};

  const from = typeof range?.from === 'string' ? range.from.trim() : '';
  const to = typeof range?.to === 'string' ? range.to.trim() : '';

  if (from) {
    conditions.push('created_at >= @from');
    params.from = from;
  }
  if (to) {
    conditions.push('created_at <= @to');
    params.to = to;
  }

  return {
    whereSql: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
};

const mapAggregateRow = (row?: Partial<UsageAggregateRow>): ChatUsageTotals => ({
  messageCount: clampInteger(row?.messageCount),
  inputTokens: clampInteger(row?.inputTokens),
  outputTokens: clampInteger(row?.outputTokens),
  totalTokens: clampInteger(row?.totalTokens),
  cacheReadTokens: clampInteger(row?.cacheReadTokens),
  cacheWriteTokens: clampInteger(row?.cacheWriteTokens),
  reasoningTokens: clampInteger(row?.reasoningTokens),
  estimatedCostUsd: clampCost(row?.estimatedCostUsd),
});

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
  const stmt = getDb().prepare(`
    INSERT INTO chat_usage_events (
      id,
      thread_id,
      message_id,
      provider_type,
      model,
      input_tokens,
      output_tokens,
      total_tokens,
      cache_read_tokens,
      cache_write_tokens,
      reasoning_tokens,
      estimated_cost_usd,
      source,
      metadata,
      created_at
    ) VALUES (
      @id,
      @thread_id,
      @message_id,
      @provider_type,
      @model,
      @input_tokens,
      @output_tokens,
      @total_tokens,
      @cache_read_tokens,
      @cache_write_tokens,
      @reasoning_tokens,
      @estimated_cost_usd,
      @source,
      @metadata,
      @created_at
    )
  `);

  return stmt.run({
    id: input.id,
    thread_id:
      typeof input.thread_id === 'string' && input.thread_id.trim() ? input.thread_id : null,
    message_id:
      typeof input.message_id === 'string' && input.message_id.trim() ? input.message_id : null,
    provider_type: input.provider_type,
    model: input.model,
    input_tokens: clampInteger(input.input_tokens),
    output_tokens: clampInteger(input.output_tokens),
    total_tokens: clampInteger(input.total_tokens),
    cache_read_tokens: clampInteger(input.cache_read_tokens),
    cache_write_tokens: clampInteger(input.cache_write_tokens),
    reasoning_tokens: clampInteger(input.reasoning_tokens),
    estimated_cost_usd: clampCost(input.estimated_cost_usd),
    source: sanitizeSource(input.source),
    metadata: typeof input.metadata === 'string' && input.metadata.trim() ? input.metadata : '{}',
    created_at: input.created_at,
  });
};

export const getChatUsageTotals = (range?: ChatUsageRange): ChatUsageTotals => {
  const { whereSql, params } = buildWhereClause(range);

  const row = getDb()
    .prepare(
      `
      SELECT
        COUNT(1) AS messageCount,
        COALESCE(SUM(input_tokens), 0) AS inputTokens,
        COALESCE(SUM(output_tokens), 0) AS outputTokens,
        COALESCE(SUM(total_tokens), 0) AS totalTokens,
        COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
        COALESCE(SUM(cache_write_tokens), 0) AS cacheWriteTokens,
        COALESCE(SUM(reasoning_tokens), 0) AS reasoningTokens,
        COALESCE(SUM(estimated_cost_usd), 0) AS estimatedCostUsd
      FROM chat_usage_events
      ${whereSql}
    `
    )
    .get(params) as UsageAggregateRow | undefined;

  return mapAggregateRow(row);
};

export const listChatUsageDaily = (range?: ChatUsageRange): ChatUsageDailyPoint[] => {
  const { whereSql, params } = buildWhereClause(range);

  const rows = getDb()
    .prepare(
      `
      SELECT
        substr(created_at, 1, 10) AS date,
        COUNT(1) AS messageCount,
        COALESCE(SUM(input_tokens), 0) AS inputTokens,
        COALESCE(SUM(output_tokens), 0) AS outputTokens,
        COALESCE(SUM(total_tokens), 0) AS totalTokens,
        COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
        COALESCE(SUM(cache_write_tokens), 0) AS cacheWriteTokens,
        COALESCE(SUM(reasoning_tokens), 0) AS reasoningTokens,
        COALESCE(SUM(estimated_cost_usd), 0) AS estimatedCostUsd
      FROM chat_usage_events
      ${whereSql}
      GROUP BY substr(created_at, 1, 10)
      ORDER BY date ASC
    `
    )
    .all(params) as Array<UsageAggregateRow & { date: string }>;

  return rows.map(row => ({
    date: row.date,
    ...mapAggregateRow(row),
  }));
};

export const listChatUsageMonthly = (range?: ChatUsageRange): ChatUsageMonthlyPoint[] => {
  const { whereSql, params } = buildWhereClause(range);

  const rows = getDb()
    .prepare(
      `
      SELECT
        substr(created_at, 1, 7) AS month,
        COUNT(1) AS messageCount,
        COALESCE(SUM(input_tokens), 0) AS inputTokens,
        COALESCE(SUM(output_tokens), 0) AS outputTokens,
        COALESCE(SUM(total_tokens), 0) AS totalTokens,
        COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
        COALESCE(SUM(cache_write_tokens), 0) AS cacheWriteTokens,
        COALESCE(SUM(reasoning_tokens), 0) AS reasoningTokens,
        COALESCE(SUM(estimated_cost_usd), 0) AS estimatedCostUsd
      FROM chat_usage_events
      ${whereSql}
      GROUP BY substr(created_at, 1, 7)
      ORDER BY month ASC
    `
    )
    .all(params) as Array<UsageAggregateRow & { month: string }>;

  return rows.map(row => ({
    month: row.month,
    ...mapAggregateRow(row),
  }));
};
