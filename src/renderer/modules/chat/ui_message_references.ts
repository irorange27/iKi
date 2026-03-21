import type { UIMessage } from 'ai';
import type { ContextReportItem, SkillUsageEntry } from '../../../shared/chat/message_parts';
import type { AppConfig } from '../../../shared/types/config';

import {
  isContextReportPart,
  isMemoryPart,
  isObjectRecord,
  isSkillUsagePart,
} from '../../../shared/chat/message_parts';
import { getToolCallIdFromPart, getToolName, isToolPart } from './ui_message_tool_parts';

export type ToolReferenceSummary = {
  count: number;
  names: string[];
  items: Array<{
    name: string;
    count: number;
  }>;
};

export type SkillReferenceItem = {
  id: string;
  name: string;
  description: string;
  source: 'user' | 'codex' | '';
  sourceLabel: string;
};

export type SkillReferenceSummary = {
  mode: 'manual' | 'auto';
  items: SkillReferenceItem[];
};

export type MemoryReferenceItem = {
  id?: string;
  summary: string;
  score: number | null;
  updatedAt: string;
  tags: string[];
  sourceMessageCount: number | null;
};

export type MemoryReferenceSummary = {
  query: string;
  items: MemoryReferenceItem[];
};

export type ContextReferenceItem = {
  kind: string;
  status: string;
  estimatedTokens: number | null;
  charCount: number | null;
  reason: string;
  sourceCount: number | null;
};

export type ContextReferenceSummary = {
  totalEstimatedTokens: number | null;
  retainedRecentMessages: number | null;
  compactedMessages: number | null;
  items: ContextReferenceItem[];
};

export type ContextUsageIndicator = {
  usedTokens: number;
  budgetTokens: number | null;
  percent: number | null;
  percentLabel: string;
  tokenLabel: string;
  tooltip: string;
};

type ContextBudgetConfig = Pick<
  AppConfig['memory']['context'],
  | 'maxRecentTokens'
  | 'maxIdentityTokens'
  | 'maxRelationshipTokens'
  | 'maxLifeStateTokens'
  | 'maxReflectionTokens'
  | 'maxSummaryTokens'
  | 'maxMemoryTokens'
  | 'maxSkillTokens'
>;

const getMessageParts = (message: unknown): unknown[] =>
  isObjectRecord(message) && Array.isArray(message.parts) ? message.parts : [];

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const parseStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map(entry => normalizeText(entry))
      .filter(Boolean);
  }

  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((entry): entry is string => typeof entry === 'string')
          .map(entry => normalizeText(entry))
          .filter(Boolean);
      }
    } catch {
      return [normalizeText(value)];
    }
  }

  return [];
};

const getSourceMessageCount = (entry: Record<string, unknown>): number | null => {
  const directCount = entry.sourceMessageCount;
  if (typeof directCount === 'number' && Number.isFinite(directCount) && directCount > 0) {
    return Math.trunc(directCount);
  }

  const ids = parseStringArray(entry.source_message_ids);
  return ids.length > 0 ? ids.length : null;
};

const toScore = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const formatSkillSourceLabel = (value: unknown): SkillReferenceItem['sourceLabel'] => {
  if (value === 'codex') return 'Codex';
  if (value === 'user') return 'User';
  return 'Skill';
};

const normalizeSkillSource = (value: unknown): SkillReferenceItem['source'] => {
  if (value === 'user' || value === 'codex') return value;
  return '';
};

export const getToolReferenceSummary = (message: UIMessage | unknown): ToolReferenceSummary => {
  const parts = getMessageParts(message);
  const toolCallIds = new Set<string>();
  const toolNames: string[] = [];
  const toolNamesSeen = new Set<string>();
  const toolNameCounts = new Map<string, number>();
  const countedCallIds = new Set<string>();

  for (const part of parts) {
    if (!isToolPart(part)) continue;

    const toolCallId = getToolCallIdFromPart(part);
    const toolName = normalizeText(getToolName(part));

    if (toolCallId && countedCallIds.has(toolCallId)) {
      if (toolName && !toolNamesSeen.has(toolName)) {
        toolNamesSeen.add(toolName);
        toolNames.push(toolName);
      }
      continue;
    }

    if (toolCallId) {
      toolCallIds.add(toolCallId);
      countedCallIds.add(toolCallId);
    }

    if (toolName && !toolNamesSeen.has(toolName)) {
      toolNamesSeen.add(toolName);
      toolNames.push(toolName);
    }

    if (toolName) {
      toolNameCounts.set(toolName, (toolNameCounts.get(toolName) || 0) + 1);
    }
  }

  return {
    count: toolCallIds.size > 0 ? toolCallIds.size : toolNames.length,
    names: toolNames,
    items: Array.from(toolNameCounts.entries()).map(([name, count]) => ({ name, count })),
  };
};

export const getSkillReferenceSummary = (message: UIMessage | unknown): SkillReferenceSummary => {
  const parts = getMessageParts(message);
  const skillPart = parts.find(part => isSkillUsagePart(part));

  if (!skillPart) {
    return {
      mode: 'manual',
      items: [],
    };
  }

  const rawSkills = Array.isArray(skillPart.skills) ? skillPart.skills : [];
  const seen = new Set<string>();
  const items = rawSkills
    .filter(
      (entry): entry is SkillUsageEntry =>
        isObjectRecord(entry) &&
        typeof entry.id === 'string' &&
        entry.id.trim().length > 0 &&
        typeof entry.name === 'string' &&
        entry.name.trim().length > 0
    )
    .map(entry => ({
      id: entry.id.trim(),
      name: normalizeText(entry.name),
      description: typeof entry.description === 'string' ? normalizeText(entry.description) : '',
      source: normalizeSkillSource(entry.source),
      sourceLabel: formatSkillSourceLabel(entry.source),
    }))
    .filter(entry => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });

  return {
    mode: skillPart.mode === 'auto' ? 'auto' : 'manual',
    items,
  };
};

export const getMemoryReferenceSummary = (message: UIMessage | unknown): MemoryReferenceSummary => {
  const parts = getMessageParts(message);
  const memoryPart = parts.find(part => isMemoryPart(part));

  if (!memoryPart) {
    return {
      query: '',
      items: [],
    };
  }

  const rawResults = Array.isArray(memoryPart.results) ? memoryPart.results : [];
  const items = rawResults
    .filter(
      (entry): entry is Record<string, unknown> =>
        isObjectRecord(entry) &&
        typeof entry.summary === 'string' &&
        entry.summary.trim().length > 0
    )
    .map(entry => ({
      ...(typeof entry.id === 'string' && entry.id.trim() ? { id: entry.id.trim() } : {}),
      summary: normalizeText(entry.summary as string),
      score: toScore(entry.score),
      updatedAt: typeof entry.updated_at === 'string' ? entry.updated_at : '',
      tags: parseStringArray(entry.tags),
      sourceMessageCount: getSourceMessageCount(entry),
    }));

  return {
    query: typeof memoryPart.query === 'string' ? normalizeText(memoryPart.query) : '',
    items,
  };
};

export const getContextReferenceSummary = (message: UIMessage | unknown): ContextReferenceSummary => {
  const parts = getMessageParts(message);
  const contextPart = parts.find(part => isContextReportPart(part));

  if (!contextPart) {
    return {
      totalEstimatedTokens: null,
      retainedRecentMessages: null,
      compactedMessages: null,
      items: [],
    };
  }

  const rawBlocks = Array.isArray(contextPart.blocks) ? contextPart.blocks : [];
  const items = rawBlocks
    .filter(
      (entry): entry is ContextReportItem =>
        isObjectRecord(entry) &&
        typeof entry.kind === 'string' &&
        typeof entry.status === 'string'
    )
    .map(entry => ({
      kind: normalizeText(entry.kind),
      status: normalizeText(entry.status),
      estimatedTokens: toScore(entry.estimatedTokens),
      charCount: toScore(entry.charCount),
      reason: typeof entry.reason === 'string' ? normalizeText(entry.reason) : '',
      sourceCount: toScore(entry.sourceCount),
    }));

  return {
    totalEstimatedTokens: toScore(contextPart.totalEstimatedTokens),
    retainedRecentMessages: toScore(contextPart.retainedRecentMessages),
    compactedMessages: toScore(contextPart.compactedMessages),
    items,
  };
};

export const formatContextTokenCount = (tokens: number | null): string => {
  if (tokens === null || !Number.isFinite(tokens)) return '';
  return `${Math.max(0, Math.trunc(tokens)).toLocaleString()} tok`;
};

export const getContextBudgetTokens = (
  config: Partial<ContextBudgetConfig> | null | undefined
): number => {
  if (!config) return 0;

  return [
    config.maxRecentTokens,
    config.maxIdentityTokens,
    config.maxRelationshipTokens,
    config.maxLifeStateTokens,
    config.maxReflectionTokens,
    config.maxSummaryTokens,
    config.maxMemoryTokens,
    config.maxSkillTokens,
  ].reduce((sum, value) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return sum;
    }
    return sum + Math.trunc(value);
  }, 0);
};

export const buildContextUsageIndicator = (
  summary: ContextReferenceSummary,
  config: Partial<ContextBudgetConfig> | null | undefined
): ContextUsageIndicator | null => {
  if (summary.totalEstimatedTokens === null || !Number.isFinite(summary.totalEstimatedTokens)) {
    return null;
  }

  const usedTokens = Math.max(0, Math.trunc(summary.totalEstimatedTokens));
  const budgetTokens = getContextBudgetTokens(config);
  const percent =
    budgetTokens > 0
      ? Math.min(999, Math.max(0, Math.round((usedTokens / budgetTokens) * 100)))
      : null;
  const percentLabel = percent === null ? '' : `${percent}%`;
  const tokenLabel = formatContextTokenCount(usedTokens);

  const detailLines = summary.items.map(item => {
    const detailParts = [`${item.kind}: ${item.status}`];
    if (item.estimatedTokens !== null) {
      detailParts.push(formatContextTokenCount(item.estimatedTokens));
    }
    if (item.reason) {
      detailParts.push(item.reason);
    }
    return detailParts.join(' · ');
  });

  const tooltipLines = [
    budgetTokens > 0
      ? `Context usage: ${tokenLabel} / ${budgetTokens.toLocaleString()} tok${percentLabel ? ` (${percentLabel})` : ''}`
      : `Context usage: ${tokenLabel}`,
    ...(summary.retainedRecentMessages !== null
      ? [`Recent messages kept: ${Math.trunc(summary.retainedRecentMessages)}`]
      : []),
    ...(summary.compactedMessages !== null && summary.compactedMessages > 0
      ? [`Compacted messages: ${Math.trunc(summary.compactedMessages)}`]
      : []),
    ...detailLines,
  ];

  return {
    usedTokens,
    budgetTokens: budgetTokens > 0 ? budgetTokens : null,
    percent,
    percentLabel,
    tokenLabel,
    tooltip: tooltipLines.join('\n'),
  };
};

export const hasReferenceSummary = (message: UIMessage | unknown): boolean => {
  const toolSummary = getToolReferenceSummary(message);
  if (toolSummary.count > 0) return true;
  if (getSkillReferenceSummary(message).items.length > 0) return true;
  if (getMemoryReferenceSummary(message).items.length > 0) return true;
  return false;
};
