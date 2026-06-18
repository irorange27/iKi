export type ChatUsagePeriod = '7d' | '30d' | '90d' | '365d' | 'all';

export interface TokenUsageMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  estimatedCostUsd: number;
}

export interface ChatUsageTotals extends TokenUsageMetrics {
  messageCount: number;
}

export interface ChatUsageDailyPoint extends ChatUsageTotals {
  date: string;
}

export interface ChatUsageMonthlyPoint extends ChatUsageTotals {
  month: string;
}

export interface ChatUsageHeatmapCell {
  date: string;
  totalTokens: number;
  messageCount: number;
}

export interface ChatUsageSummary {
  period: ChatUsagePeriod;
  from: string | null;
  to: string;
  totals: ChatUsageTotals;
  daily: ChatUsageDailyPoint[];
  monthly: ChatUsageMonthlyPoint[];
  heatmap: ChatUsageHeatmapCell[];
}

export interface ChatUsageEvent {
  id: string;
  thread_id?: string | null;
  message_id?: string | null;
  provider_type: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  estimated_cost_usd: number;
  source: string;
  metadata: string;
  created_at: string;
}
