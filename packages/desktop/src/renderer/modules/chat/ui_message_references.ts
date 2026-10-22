import type { ChatUiMessage, SkillUsageEntry } from '@iki/backend/message/message_parts';
import type {
  ContextCompositionCategory,
  ContextCompositionSummary,
} from '@iki/backend/types/context_composition';
import { normalizeModelCapabilityLimits } from '@iki/backend/utils/provider_models';
import { normalizeWhitespace } from '@iki/backend/utils/text';
import { translate } from '../../i18n';

import {
  getSkillUsagePartData,
  getTokenUsagePartData,
  isObjectRecord,
  isSkillUsagePart,
  isTokenUsagePart,
} from '@iki/backend/message/message_parts';
import {
  getParsedToolOutput,
  getToolCallIdFromPart,
  getToolName,
  getToolInput,
  getToolOutput,
  isToolPart,
  normalizeToolNameKey,
} from './ui_message_tool_calls';

export type ToolReferenceSummary = {
  callCount: number;
  kindCount: number;
  names: string[];
  items: Array<{
    name: string;
    callCount: number;
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
  selectedItems: SkillReferenceItem[];
  selectedOnlyItems: SkillReferenceItem[];
};

export type TokenUsageSummary = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  estimatedCostUsd: number | null;
  
  lastStepInputTokens: number | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  model: string;
  providerType: string;
  providerId: string;
  
  llmMs: number | null;
  toolMs: number | null;
  firstTokenMs: number | null;
  firstTokenSamples: number | null;
  steps: number | null;
  toolCalls: number | null;
  
  contextComposition: ContextCompositionSummary | null;
};

export type ContextCompositionRow = {
  key: ContextCompositionCategory;
  tokens: number;
  percent: number;
};

export const buildContextCompositionRows = (
  summary: TokenUsageSummary | null
): ContextCompositionRow[] => {
  const composition = summary?.contextComposition ?? null;
  if (!composition) return [];

  const rows: ContextCompositionRow[] = [];
  const total = composition.estimatedTotalTokens;
  for (const [key, tokens] of Object.entries(composition.categories) as Array<
    [ContextCompositionCategory, number]
  >) {
    if (!Number.isFinite(tokens) || tokens <= 0) continue;
    rows.push({
      key,
      tokens: Math.round(tokens),
      percent: total > 0 ? Math.round((tokens / total) * 100) : 0,
    });
  }
  return rows.sort((a, b) => b.tokens - a.tokens);
};

export type ContextUsageIndicator = {
  usedTokens: number;
  budgetTokens: number | null;
  percent: number | null;
  percentLabel: string;
  tokenLabel: string;
  tooltip: string;
};

export type SessionPerfStats = {
  rounds: number;
  steps: number;
  toolCalls: number;
  llmMs: number;
  toolMs: number;
  avgFirstTokenMs: number | null;
  tokensPerSecond: number | null;
  cacheHitPercent: number | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  estimatedCostUsd: number;
  model: string;
};

const getMessageParts = (message: unknown): unknown[] =>
  isObjectRecord(message) && Array.isArray(message.parts) ? message.parts : [];

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

const normalizeSkillItems = (rawSkills: unknown): SkillReferenceItem[] => {
  const skills = Array.isArray(rawSkills) ? rawSkills : [];
  const seen = new Set<string>();

  return skills
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
      name: normalizeWhitespace(entry.name),
      description:
        typeof entry.description === 'string' ? normalizeWhitespace(entry.description) : '',
      source: normalizeSkillSource(entry.source),
      sourceLabel: formatSkillSourceLabel(entry.source),
    }))
    .filter(entry => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
};

const buildToolReferenceSummary = (message: ChatUiMessage | unknown): ToolReferenceSummary => {
  const parts = getMessageParts(message);
  const orderedToolNameKeys: string[] = [];
  const toolNamesSeen = new Set<string>();
  const toolDisplayNames = new Map<string, string>();
  const toolNameCallCounts = new Map<string, number>();
  const countedCalls = new Map<string, string | null>();

  for (const part of parts) {
    if (!isToolPart(part)) continue;

    const toolCallId = getToolCallIdFromPart(part);
    const toolName = normalizeWhitespace(getToolName(part));
    if (toolName && normalizeToolNameKey(toolName) === 'load_skill') {
      continue;
    }

    const toolNameKey = toolName ? normalizeToolNameKey(toolName) || toolName : '';
    if (toolName && toolNameKey && !toolNamesSeen.has(toolNameKey)) {
      toolNamesSeen.add(toolNameKey);
      orderedToolNameKeys.push(toolNameKey);
      toolDisplayNames.set(toolNameKey, toolName);
    }

    const callKey = toolCallId ? `id:${toolCallId}` : toolNameKey ? `name:${toolNameKey}` : '';
    if (!callKey) continue;

    const countedToolNameKey = countedCalls.get(callKey);
    if (countedToolNameKey !== undefined) {
      if (!countedToolNameKey && toolNameKey) {
        countedCalls.set(callKey, toolNameKey);
        toolNameCallCounts.set(toolNameKey, (toolNameCallCounts.get(toolNameKey) || 0) + 1);
      }
      continue;
    }

    countedCalls.set(callKey, toolNameKey || null);
    if (toolNameKey) {
      toolNameCallCounts.set(toolNameKey, (toolNameCallCounts.get(toolNameKey) || 0) + 1);
    }
  }

  return {
    callCount: countedCalls.size,
    kindCount: orderedToolNameKeys.length,
    names: orderedToolNameKeys.map(nameKey => toolDisplayNames.get(nameKey) || nameKey),
    items: orderedToolNameKeys
      .map(nameKey => ({
        name: toolDisplayNames.get(nameKey) || nameKey,
        callCount: toolNameCallCounts.get(nameKey) || 0,
      }))
      .filter(item => item.callCount > 0),
  };
};

const buildSelectedSkillReferenceSummary = (
  message: ChatUiMessage | unknown
): Pick<SkillReferenceSummary, 'mode' | 'selectedItems'> => {
  const parts = getMessageParts(message);
  const skillPart = parts.find(part => isSkillUsagePart(part));

  if (!skillPart) {
    return {
      mode: 'manual',
      selectedItems: [],
    };
  }

  return {
    mode: getSkillUsagePartData(skillPart)?.mode === 'auto' ? 'auto' : 'manual',
    selectedItems: normalizeSkillItems(getSkillUsagePartData(skillPart)?.skills),
  };
};

const buildSkillReferenceSummary = (message: ChatUiMessage | unknown): SkillReferenceSummary => {
  const parts = getMessageParts(message);
  const selectedSummary = buildSelectedSkillReferenceSummary(message);
  const selectedById = new Map(selectedSummary.selectedItems.map(item => [item.id, item] as const));

  const loadedById = new Map<string, SkillReferenceItem>();
  for (const part of parts) {
    if (!isToolPart(part)) continue;
    if (normalizeToolNameKey(getToolName(part)) !== 'load_skill') continue;

    const parsedOutput = getParsedToolOutput(part);
    if (parsedOutput.kind !== 'load_skill') continue;

    const output = parsedOutput.output;
    const id = typeof output.id === 'string' ? output.id.trim() : '';
    const name = typeof output.name === 'string' ? normalizeWhitespace(output.name) : '';
    if (!id || !name || loadedById.has(id)) continue;

    const selected = selectedById.get(id);
    const source = normalizeSkillSource(output.source ?? selected?.source);
    loadedById.set(id, {
      id,
      name,
      description: selected?.description || '',
      source,
      sourceLabel: formatSkillSourceLabel(source),
    });
  }

  const items = Array.from(loadedById.values());
  const selectedOnlyItems = selectedSummary.selectedItems.filter(item => !loadedById.has(item.id));

  return {
    mode: selectedSummary.mode,
    items,
    selectedItems: selectedSummary.selectedItems,
    selectedOnlyItems,
  };
};

const buildTokenUsageSummary = (message: ChatUiMessage | unknown): TokenUsageSummary => {
  const parts = getMessageParts(message);
  const usagePart = parts.find(part => isTokenUsagePart(part));

  if (!usagePart) {
    return {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
      estimatedCostUsd: null,
      lastStepInputTokens: null,
      maxInputTokens: null,
      maxOutputTokens: null,
      model: '',
      providerType: '',
      providerId: '',
    llmMs: null,
    toolMs: null,
    firstTokenMs: null,
    firstTokenSamples: null,
    steps: null,
    toolCalls: null,
    contextComposition: null,
  };
  }

  const usageData = getTokenUsagePartData(usagePart);

  return {
    inputTokens: toScore(usageData?.inputTokens),
    outputTokens: toScore(usageData?.outputTokens),
    totalTokens: toScore(usageData?.totalTokens),
    cacheReadTokens: toScore(usageData?.cacheReadTokens),
    cacheWriteTokens: toScore(usageData?.cacheWriteTokens),
    reasoningTokens: toScore(usageData?.reasoningTokens),
    estimatedCostUsd: toScore(usageData?.estimatedCostUsd),
    lastStepInputTokens: toScore(usageData?.lastStepInputTokens),
    maxInputTokens: toScore(usageData?.maxInputTokens),
    maxOutputTokens: toScore(usageData?.maxOutputTokens),
    model: typeof usageData?.model === 'string' ? normalizeWhitespace(usageData.model) : '',
    providerType:
      typeof usageData?.providerType === 'string' ? normalizeWhitespace(usageData.providerType) : '',
    providerId:
      typeof usageData?.providerId === 'string' ? normalizeWhitespace(usageData.providerId) : '',
    llmMs: toScore(usageData?.llmMs),
    toolMs: toScore(usageData?.toolMs),
    firstTokenMs: toScore(usageData?.firstTokenMs),
    firstTokenSamples: toScore(usageData?.firstTokenSamples),
    steps: toScore(usageData?.steps),
    toolCalls: toScore(usageData?.toolCalls),
    contextComposition: usageData?.contextComposition ?? null,
  };
};

type SummaryCache<T> = WeakMap<object, { sources: unknown[]; value: T }>;
const reuseSummary = <T>(
  cache: SummaryCache<T>,
  key: object,
  sources: unknown[],
  build: () => T
): T => {
  const previous = cache.get(key);
  if (
    previous &&
    previous.sources.length === sources.length &&
    sources.every((source, index) => Object.is(source, previous.sources[index]))
  ) {
    return previous.value;
  }
  const value = build();
  cache.set(key, { sources, value });
  return value;
};
const toolSummaryCache: SummaryCache<ToolReferenceSummary> = new WeakMap();
const skillSummaryCache: SummaryCache<SkillReferenceSummary> = new WeakMap();
const usageSummaryCache: SummaryCache<TokenUsageSummary> = new WeakMap();

export const getReferenceSummaries = (message: unknown) => {
  const parts = getMessageParts(message);
  const tools: unknown[] = [];
  const skills: unknown[] = [];
  const toolSources: unknown[] = [];
  const skillSources: unknown[] = [];
  for (const part of parts) {
    if (isToolPart(part)) {
      tools.push(part);
      toolSources.push(getToolName(part), getToolCallIdFromPart(part));
      if (normalizeToolNameKey(getToolName(part)) === 'load_skill') {
        skills.push(part);
        skillSources.push(getToolName(part), getToolInput(part), getToolOutput(part));
      }
    } else if (isSkillUsagePart(part)) {
      skills.push(part);
      skillSources.push(getSkillUsagePartData(part));
    }
  }
  return {
    tool: reuseSummary(toolSummaryCache, parts, toolSources, () =>
      buildToolReferenceSummary({ parts: tools })
    ),
    skill: reuseSummary(skillSummaryCache, parts, skillSources, () =>
      buildSkillReferenceSummary({ parts: skills })
    ),
  };
};
export const getToolReferenceSummary = (message: unknown) => getReferenceSummaries(message).tool;
export const getSkillReferenceSummary = (message: unknown) => getReferenceSummaries(message).skill;
export const getTokenUsageSummary = (message: unknown): TokenUsageSummary => {
  const parts = getMessageParts(message);
  const part = parts.find(isTokenUsagePart);
  return reuseSummary(usageSummaryCache, parts, [part && getTokenUsagePartData(part)], () =>
    buildTokenUsageSummary({ parts: part ? [part] : [] })
  );
};

export const formatTokenCount = (tokens: number | null): string => {
  if (tokens === null || !Number.isFinite(tokens)) return '';
  return translate('chat.contextUsage.tokenCount', {
    value: Math.max(0, Math.trunc(tokens)).toLocaleString(),
  });
};

const hasUsageData = (summary: TokenUsageSummary): boolean =>
  summary.inputTokens !== null ||
  summary.outputTokens !== null ||
  summary.llmMs !== null ||
  summary.steps !== null ||
  summary.toolCalls !== null;

export const buildSessionPerfStats = (
  messages: readonly unknown[]
): SessionPerfStats | null => {
  const stats: SessionPerfStats = {
    rounds: 0,
    steps: 0,
    toolCalls: 0,
    llmMs: 0,
    toolMs: 0,
    avgFirstTokenMs: null,
    tokensPerSecond: null,
    cacheHitPercent: null,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    estimatedCostUsd: 0,
    model: '',
  };

  let firstTokenMsSum = 0;
  let firstTokenSamples = 0;

  for (const message of messages) {
    if (!isObjectRecord(message) || message.role !== 'assistant') continue;
    const summary = getTokenUsageSummary(message);
    if (!hasUsageData(summary)) continue;

    stats.rounds += 1;
    stats.steps += summary.steps ?? 0;
    stats.toolCalls += summary.toolCalls ?? 0;
    stats.llmMs += summary.llmMs ?? 0;
    stats.toolMs += summary.toolMs ?? 0;
    stats.inputTokens += summary.inputTokens ?? 0;
    stats.outputTokens += summary.outputTokens ?? 0;
    stats.totalTokens += summary.totalTokens ?? 0;
    stats.cacheReadTokens += summary.cacheReadTokens ?? 0;
    stats.cacheWriteTokens += summary.cacheWriteTokens ?? 0;
    stats.reasoningTokens += summary.reasoningTokens ?? 0;
    stats.estimatedCostUsd += summary.estimatedCostUsd ?? 0;
    if (summary.model) stats.model = summary.model;
    if (summary.firstTokenMs !== null) firstTokenMsSum += summary.firstTokenMs;
    if (summary.firstTokenSamples !== null) firstTokenSamples += summary.firstTokenSamples;
  }

  if (stats.rounds === 0) return null;

  stats.avgFirstTokenMs =
    firstTokenSamples > 0 ? firstTokenMsSum / firstTokenSamples : null;
  stats.tokensPerSecond =
    stats.llmMs > 0 ? stats.outputTokens / (stats.llmMs / 1000) : null;
  stats.cacheHitPercent =
    stats.inputTokens > 0 ? (stats.cacheReadTokens / stats.inputTokens) * 100 : null;

  return stats;
};

export const buildTokenUsageIndicator = (
  summary: TokenUsageSummary
): ContextUsageIndicator | null => {
  if (summary.inputTokens === null || !Number.isFinite(summary.inputTokens)) {
    return null;
  }

  if (
    summary.lastStepInputTokens === null &&
    summary.steps !== null &&
    summary.steps > 1
  ) {
    return null;
  }

  const occupancyTokens = summary.lastStepInputTokens ?? summary.inputTokens;
  const usedTokens = Math.max(0, Math.trunc(occupancyTokens));
  const budgetTokens = normalizeModelCapabilityLimits({
    maxInputTokens: summary.maxInputTokens,
  }).maxInputTokens;
  const percent =
    budgetTokens > 0
      ? Math.min(999, Math.max(0, Math.round((usedTokens / budgetTokens) * 100)))
      : null;
  const percentLabel = percent === null ? '' : `${percent}%`;
  const tokenLabel = formatTokenCount(usedTokens);

  const tooltipLines = [
    budgetTokens > 0
      ? translate('chat.contextUsage.headerWithBudget', {
          used: tokenLabel,
          budget: budgetTokens.toLocaleString(),
          percent: percentLabel,
        })
      : translate('chat.contextUsage.headerWithoutBudget', {
          used: tokenLabel,
        }),
    ...(summary.outputTokens !== null
      ? [
          translate('chat.contextUsage.outputTokens', {
            tokens: formatTokenCount(summary.outputTokens),
          }),
        ]
      : []),
    ...(summary.totalTokens !== null
      ? [
          translate('chat.contextUsage.totalTokens', {
            tokens: formatTokenCount(summary.totalTokens),
          }),
        ]
      : []),
    ...(summary.model
      ? [
          translate('chat.contextUsage.model', {
            model: summary.model,
          }),
        ]
      : []),
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

export const hasReferenceSummary = (message: ChatUiMessage | unknown): boolean => {
  const { tool, skill } = getReferenceSummaries(message);
  return tool.callCount > 0 || skill.items.length > 0;
};
