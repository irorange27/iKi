import type {
  ChatUiMessage,
  SkillUsageEntry,
} from '@iki/backend/chat/message_parts';
import { isAffectLabel, type AffectLabel } from '@iki/backend/types/affect';
import { normalizeModelCapabilityLimits } from '@iki/backend/utils/provider_models';
import { normalizeWhitespace } from '@iki/backend/utils/text';
import { translate } from '../../i18n';

import {
  getAffectSignalPartData,
  getMemoryPartData,
  getSkillUsagePartData,
  getTokenUsagePartData,
  isAffectSignalPart,
  isMemoryPart,
  isObjectRecord,
  isSkillUsagePart,
  isTokenUsagePart,
} from '@iki/backend/chat/message_parts';
import {
  getParsedToolOutput,
  getToolCallIdFromPart,
  getToolName,
  isTranscriptHiddenToolPart,
  isToolPart,
  normalizeToolNameKey,
} from './ui_message_tool_parts';

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

export type AffectReferenceSummary = {
  source: 'history' | 'realtime' | '';
  guardActive: boolean;
  label: AffectLabel | '';
  confidence: number | null;
  valence: number | null;
  arousal: number | null;
  sampleCount: number | null;
  windowSize: number | null;
  ageMinutes: number | null;
  windowMinutes: number | null;
  emotions: Array<{
    label: AffectLabel;
    score: number;
  }>;
};

export type TokenUsageSummary = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  estimatedCostUsd: number | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  model: string;
  providerType: string;
  providerId: string;
};

export type ContextUsageIndicator = {
  usedTokens: number;
  budgetTokens: number | null;
  percent: number | null;
  percentLabel: string;
  tokenLabel: string;
  tooltip: string;
};

const getMessageParts = (message: unknown): unknown[] =>
  isObjectRecord(message) && Array.isArray(message.parts) ? message.parts : [];

const parseStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map(entry => normalizeWhitespace(entry))
      .filter(Boolean);
  }

  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((entry): entry is string => typeof entry === 'string')
          .map(entry => normalizeWhitespace(entry))
          .filter(Boolean);
      }
    } catch {
      return [normalizeWhitespace(value)];
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

const normalizeAffectScores = (
  value: unknown
): Array<{
  label: AffectLabel;
  score: number;
}> => {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (entry): entry is { label: AffectLabel; score: number } =>
        isObjectRecord(entry) &&
        isAffectLabel(entry.label) &&
        typeof entry.score === 'number' &&
        Number.isFinite(entry.score)
    )
    .map(entry => ({
      label: entry.label,
      score: Math.min(1, Math.max(0, entry.score)),
    }));
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

export const getToolReferenceSummary = (
  message: ChatUiMessage | unknown
): ToolReferenceSummary => {
  const parts = getMessageParts(message);
  const orderedToolNameKeys: string[] = [];
  const toolNamesSeen = new Set<string>();
  const toolDisplayNames = new Map<string, string>();
  const toolNameCallCounts = new Map<string, number>();
  const countedCalls = new Map<string, string | null>();

  for (const part of parts) {
    if (!isToolPart(part)) continue;
    if (isTranscriptHiddenToolPart(part)) continue;

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

export const getSelectedSkillReferenceSummary = (
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

export const getSkillReferenceSummary = (
  message: ChatUiMessage | unknown
): SkillReferenceSummary => {
  const parts = getMessageParts(message);
  const selectedSummary = getSelectedSkillReferenceSummary(message);
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

export const getMemoryReferenceSummary = (
  message: ChatUiMessage | unknown
): MemoryReferenceSummary => {
  const parts = getMessageParts(message);
  const memoryPart = parts.find(part => isMemoryPart(part));

  if (!memoryPart) {
    return {
      query: '',
      items: [],
    };
  }

  const memoryData = getMemoryPartData(memoryPart);
  const rawResults = Array.isArray(memoryData?.results) ? memoryData.results : [];
  const items = rawResults
    .filter(
      (entry): entry is Record<string, unknown> =>
        isObjectRecord(entry) &&
        typeof entry.summary === 'string' &&
        entry.summary.trim().length > 0
    )
    .map(entry => ({
      ...(typeof entry.id === 'string' && entry.id.trim() ? { id: entry.id.trim() } : {}),
      summary: normalizeWhitespace(entry.summary as string),
      score: toScore(entry.score),
      updatedAt: typeof entry.updated_at === 'string' ? entry.updated_at : '',
      tags: parseStringArray(entry.tags),
      sourceMessageCount: getSourceMessageCount(entry),
    }));

  return {
    query: typeof memoryData?.query === 'string' ? normalizeWhitespace(memoryData.query) : '',
    items,
  };
};

export const getAffectReferenceSummary = (
  message: ChatUiMessage | unknown
): AffectReferenceSummary => {
  const parts = getMessageParts(message);
  const affectPart = parts.find(part => isAffectSignalPart(part));

  if (!affectPart) {
    return {
      source: '',
      guardActive: false,
      label: '',
      confidence: null,
      valence: null,
      arousal: null,
      sampleCount: null,
      windowSize: null,
      ageMinutes: null,
      windowMinutes: null,
      emotions: [],
    };
  }

  const affectData = getAffectSignalPartData(affectPart);

  return {
    source:
      affectData?.source === 'history' || affectData?.source === 'realtime'
        ? affectData.source
        : '',
    guardActive: affectData?.guardActive === true,
    label: isAffectLabel(affectData?.label) ? affectData.label : '',
    confidence: toScore(affectData?.confidence),
    valence: toScore(affectData?.valence),
    arousal: toScore(affectData?.arousal),
    sampleCount: toScore(affectData?.sampleCount),
    windowSize: toScore(affectData?.windowSize),
    ageMinutes: toScore(affectData?.ageMinutes),
    windowMinutes: toScore(affectData?.windowMinutes),
    emotions: normalizeAffectScores(affectData?.emotions),
  };
};

export const getTokenUsageSummary = (
  message: ChatUiMessage | unknown
): TokenUsageSummary => {
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
      maxInputTokens: null,
      maxOutputTokens: null,
      model: '',
      providerType: '',
      providerId: '',
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
    maxInputTokens: toScore(usageData?.maxInputTokens),
    maxOutputTokens: toScore(usageData?.maxOutputTokens),
    model: typeof usageData?.model === 'string' ? normalizeWhitespace(usageData.model) : '',
    providerType:
      typeof usageData?.providerType === 'string' ? normalizeWhitespace(usageData.providerType) : '',
    providerId:
      typeof usageData?.providerId === 'string' ? normalizeWhitespace(usageData.providerId) : '',
  };
};

export const formatTokenCount = (tokens: number | null): string => {
  if (tokens === null || !Number.isFinite(tokens)) return '';
  return translate('chat.contextUsage.tokenCount', {
    value: Math.max(0, Math.trunc(tokens)).toLocaleString(),
  });
};

export const buildTokenUsageIndicator = (
  summary: TokenUsageSummary
): ContextUsageIndicator | null => {
  if (summary.inputTokens === null || !Number.isFinite(summary.inputTokens)) {
    return null;
  }

  const usedTokens = Math.max(0, Math.trunc(summary.inputTokens));
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
  const toolSummary = getToolReferenceSummary(message);
  if (toolSummary.callCount > 0) return true;
  if (getSkillReferenceSummary(message).items.length > 0) return true;
  if (getMemoryReferenceSummary(message).items.length > 0) return true;
  if (getAffectReferenceSummary(message).label) return true;
  return false;
};
