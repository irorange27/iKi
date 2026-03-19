import * as chatUsageDb from '../../../core/db/chat_usage';
import type {
  ChatUsageDailyPoint,
  ChatUsageHeatmapCell,
  ChatUsagePeriod,
  ChatUsageSummary,
  TokenUsageMetrics,
} from '../../../shared/types/chat_usage';

const PERIOD_DAYS: Record<Exclude<ChatUsagePeriod, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '365d': 365,
};
const CHAT_USAGE_PERIODS = new Set<ChatUsagePeriod>(['7d', '30d', '90d', '365d', 'all']);

const clampInteger = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
};

const clampCost = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
};

const normalizeUsage = (usage: Partial<TokenUsageMetrics> | undefined): TokenUsageMetrics => {
  const inputTokens = clampInteger(usage?.inputTokens);
  const outputTokens = clampInteger(usage?.outputTokens);
  const totalTokens = Math.max(clampInteger(usage?.totalTokens), inputTokens + outputTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens: clampInteger(usage?.cacheReadTokens),
    cacheWriteTokens: clampInteger(usage?.cacheWriteTokens),
    reasoningTokens: clampInteger(usage?.reasoningTokens),
    estimatedCostUsd: clampCost(usage?.estimatedCostUsd),
  };
};

const toIsoDay = (value: Date): string => value.toISOString().slice(0, 10);

const toDateAtUtcMidnight = (value: Date): Date =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

const getRangeForPeriod = (period: ChatUsagePeriod): { from: string | null; to: string } => {
  const now = new Date();
  if (period === 'all') {
    return {
      from: null,
      to: now.toISOString(),
    };
  }

  const days = PERIOD_DAYS[period];
  const start = toDateAtUtcMidnight(now);
  start.setUTCDate(start.getUTCDate() - (days - 1));

  return {
    from: start.toISOString(),
    to: now.toISOString(),
  };
};

const normalizePeriod = (value: unknown): ChatUsagePeriod => {
  if (typeof value !== 'string') return '30d';
  const trimmed = value.trim() as ChatUsagePeriod;
  return CHAT_USAGE_PERIODS.has(trimmed) ? trimmed : '30d';
};

const buildDenseDailySeries = (
  rows: ChatUsageDailyPoint[],
  startDate: Date,
  days: number
): ChatUsageHeatmapCell[] => {
  const byDate = new Map<string, ChatUsageDailyPoint>();
  for (const row of rows) {
    byDate.set(row.date, row);
  }

  const result: ChatUsageHeatmapCell[] = [];
  const cursor = new Date(startDate.getTime());

  for (let i = 0; i < days; i += 1) {
    const date = toIsoDay(cursor);
    const row = byDate.get(date);
    result.push({
      date,
      totalTokens: clampInteger(row?.totalTokens),
      messageCount: clampInteger(row?.messageCount),
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return result;
};

export const createChatUsage = () => {
  const recordUsageEvent = (params: {
    threadId?: string;
    messageId?: string;
    providerType: string;
    model: string;
    usage?: Partial<TokenUsageMetrics>;
    source?: string;
    metadata?: Record<string, unknown>;
  }) => {
    const providerType = params.providerType.trim();
    const model = params.model.trim();
    if (!providerType || !model) {
      return;
    }

    const usage = normalizeUsage(params.usage);

    chatUsageDb.addChatUsageEvent({
      id: `usage_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      thread_id: params.threadId,
      message_id: params.messageId,
      provider_type: providerType,
      model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_tokens: usage.totalTokens,
      cache_read_tokens: usage.cacheReadTokens,
      cache_write_tokens: usage.cacheWriteTokens,
      reasoning_tokens: usage.reasoningTokens,
      estimated_cost_usd: usage.estimatedCostUsd,
      source: params.source || 'chat',
      metadata: JSON.stringify(params.metadata || {}),
      created_at: new Date().toISOString(),
    });
  };

  const getUsageSummary = (periodInput: ChatUsagePeriod | string = '30d'): ChatUsageSummary => {
    const period = normalizePeriod(periodInput);
    const range = getRangeForPeriod(period);

    const totals = chatUsageDb.getChatUsageTotals({
      from: range.from,
      to: range.to,
    });

    const daily = chatUsageDb.listChatUsageDaily({
      from: range.from,
      to: range.to,
    });

    const monthly = chatUsageDb.listChatUsageMonthly({
      from: range.from,
      to: range.to,
    });

    const heatmapDays = 365;
    const heatmapEnd = new Date();
    const heatmapStart = toDateAtUtcMidnight(heatmapEnd);
    heatmapStart.setUTCDate(heatmapStart.getUTCDate() - (heatmapDays - 1));

    const heatmapRows = chatUsageDb.listChatUsageDaily({
      from: heatmapStart.toISOString(),
      to: heatmapEnd.toISOString(),
    });

    const heatmap = buildDenseDailySeries(heatmapRows, heatmapStart, heatmapDays);

    return {
      period,
      from: range.from,
      to: range.to,
      totals,
      daily,
      monthly,
      heatmap,
    };
  };

  return {
    recordUsageEvent,
    getUsageSummary,
  };
};

export type ChatUsageService = ReturnType<typeof createChatUsage>;
