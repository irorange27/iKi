import type { UIMessage, UIMessageChunk } from 'ai';

import {
  isAffectLabel,
  type AffectLabel,
  type AffectScore,
  type AffectSignalSource,
} from '@iki/core/emotion/affect';
import type { SkillSource } from '@iki/backend/types/skill';
import { isObjectRecord } from '@iki/core/utils/guards';

export { isObjectRecord };

export type MemoryResult = Record<string, unknown>;

export type MemoryPartData = {
  query?: string;
  results?: MemoryResult[];
};

export type SkillUsageEntry = {
  id: string;
  name: string;
  description?: string;
  source?: SkillSource;
};

export type SkillUsagePartData = {
  mode?: 'manual' | 'auto';
  skills?: SkillUsageEntry[];
};

export type ComposerInvocationToken = {
  id: string;
  kind?: 'skill' | 'prompt-app' | 'builtin';
  prefix?: string;
  label: string;
  title?: string;
};

export type ComposerInvocationPartData = {
  tokens?: ComposerInvocationToken[];
};

export type ContextReportItem = {
  kind?: 'recent-history' | 'identity' | 'thread-summary' | 'memory' | 'affect' | 'skills';
  status?: 'included' | 'truncated' | 'dropped';
  estimatedTokens?: number;
  charCount?: number;
  reason?: string;
  sourceCount?: number;
};

export type ContextReportPartData = {
  totalEstimatedTokens?: number;
  retainedRecentMessages?: number;
  compactedMessages?: number;
  blocks?: ContextReportItem[];
};

export type AffectSignalPartData = {
  source?: AffectSignalSource;
  guardActive?: boolean;
  label?: AffectLabel;
  confidence?: number;
  valence?: number;
  arousal?: number;
  emotions?: AffectScore[];
  sampleCount?: number;
  windowSize?: number;
  startAt?: string;
  endAt?: string;
  ageMinutes?: number;
  windowMinutes?: number;
};

export type TokenUsagePartData = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  estimatedCostUsd?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  model?: string;
  providerType?: string;
  providerId?: string;
};

export type ChatUiDataTypes = {
  'memory-retrieval': MemoryPartData;
  'skill-usage': SkillUsagePartData;
  'composer-invocation': ComposerInvocationPartData;
  'context-report': ContextReportPartData;
  'affect-signal': AffectSignalPartData;
  'token-usage': TokenUsagePartData;
};

export type ChatUiMessage = UIMessage<unknown, ChatUiDataTypes>;
export type ChatUiMessageChunk = UIMessageChunk<unknown, ChatUiDataTypes>;
export type UiMessagePart = ChatUiMessage['parts'][number];
export type TextPart = Extract<UiMessagePart, { type: 'text' }>;
export type MemoryPart = Extract<UiMessagePart, { type: 'data-memory-retrieval' }>;
export type SkillUsagePart = Extract<UiMessagePart, { type: 'data-skill-usage' }>;
export type ComposerInvocationPart = Extract<UiMessagePart, { type: 'data-composer-invocation' }>;
export type ContextReportPart = Extract<UiMessagePart, { type: 'data-context-report' }>;
export type AffectSignalPart = Extract<UiMessagePart, { type: 'data-affect-signal' }>;
export type TokenUsagePart = Extract<UiMessagePart, { type: 'data-token-usage' }>;
export type DynamicToolPart = Extract<UiMessagePart, { type: 'dynamic-tool' }>;

type LegacyMemoryPart = {
  type: 'memory-retrieval';
  query?: string;
  results?: MemoryResult[];
};

type LegacySkillUsagePart = {
  type: 'skill-usage';
  mode?: 'manual' | 'auto';
  skills?: SkillUsageEntry[];
};

type LegacyComposerInvocationPart = {
  type: 'composer-invocation';
  tokens?: ComposerInvocationToken[];
};

type LegacyContextReportPart = {
  type: 'context-report';
  totalEstimatedTokens?: number;
  retainedRecentMessages?: number;
  compactedMessages?: number;
  blocks?: ContextReportItem[];
};

type LegacyAffectSignalPart = {
  type: 'affect-signal';
  source?: AffectSignalSource;
  guardActive?: boolean;
  label?: AffectLabel;
  confidence?: number;
  valence?: number;
  arousal?: number;
  emotions?: AffectScore[];
  sampleCount?: number;
  windowSize?: number;
  startAt?: string;
  endAt?: string;
  ageMinutes?: number;
  windowMinutes?: number;
};

type LegacyTokenUsagePart = {
  type: 'token-usage';
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  estimatedCostUsd?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  model?: string;
  providerType?: string;
  providerId?: string;
};

type LegacyChatUiMetadataPart =
  | LegacyMemoryPart
  | LegacySkillUsagePart
  | LegacyComposerInvocationPart
  | LegacyContextReportPart
  | LegacyAffectSignalPart
  | LegacyTokenUsagePart;

export type ToolApproval = {
  id: string;
  approved?: boolean;
  reason?: string;
};

export type ToolCallRef = {
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  input?: unknown;
};

export type DynamicToolState =
  | 'input-streaming'
  | 'input-available'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-available'
  | 'output-error'
  | 'output-denied'
  | 'done';

export type ToolCallPart = {
  type: 'tool-call';
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  args?: unknown;
  toolCall?: ToolCallRef;
  state?: DynamicToolState | string;
};

export type ToolResultPart = {
  type: 'tool-result';
  toolCallId?: string;
  toolName?: string;
  output?: unknown;
  result?: unknown;
  state?: DynamicToolState | string;
};

export type ToolApprovalRequestPart = {
  type: 'tool-approval-request';
  approvalId?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  args?: unknown;
  toolCall?: ToolCallRef;
  approval?: ToolApproval;
  state?: DynamicToolState | string;
};

export type ToolApprovalResponsePart = {
  type: 'tool-approval-response';
  approvalId?: string;
  approved?: boolean;
  reason?: string;
  toolCallId?: string;
  toolName?: string;
  output?: unknown;
  result?: unknown;
  approval?: ToolApproval;
  state?: DynamicToolState | string;
};

export type ToolPart =
  | DynamicToolPart
  | ToolCallPart
  | ToolResultPart
  | ToolApprovalRequestPart
  | ToolApprovalResponsePart;

export type ChatUiMetadataPart =
  | MemoryPart
  | SkillUsagePart
  | ComposerInvocationPart
  | ContextReportPart
  | AffectSignalPart
  | TokenUsagePart;

type ChatUiMetadataPartType = ChatUiMetadataPart['type'];
type LegacyChatUiMetadataPartType = LegacyChatUiMetadataPart['type'];

const CHAT_UI_METADATA_PART_TYPES = new Set<ChatUiMetadataPartType>([
  'data-memory-retrieval',
  'data-skill-usage',
  'data-composer-invocation',
  'data-context-report',
  'data-affect-signal',
  'data-token-usage',
]);

const LEGACY_CHAT_UI_METADATA_PART_TYPES = new Set<LegacyChatUiMetadataPartType>([
  'memory-retrieval',
  'skill-usage',
  'composer-invocation',
  'context-report',
  'affect-signal',
  'token-usage',
]);

export const createMemoryPart = (data: MemoryPartData): MemoryPart => ({
  type: 'data-memory-retrieval',
  data,
});

export const createSkillUsagePart = (data: SkillUsagePartData): SkillUsagePart => ({
  type: 'data-skill-usage',
  data,
});

export const createComposerInvocationPart = (
  data: ComposerInvocationPartData
): ComposerInvocationPart => ({
  type: 'data-composer-invocation',
  data,
});

export const createContextReportPart = (data: ContextReportPartData): ContextReportPart => ({
  type: 'data-context-report',
  data,
});

export const createAffectSignalPart = (data: AffectSignalPartData): AffectSignalPart => ({
  type: 'data-affect-signal',
  data,
});

export const createTokenUsagePart = (data: TokenUsagePartData): TokenUsagePart => ({
  type: 'data-token-usage',
  data,
});

export const isTextPart = (part: unknown): part is TextPart =>
  isObjectRecord(part) && part.type === 'text' && typeof part.text === 'string';

export const isDataPart = (part: unknown): boolean =>
  isObjectRecord(part) && typeof part.type === 'string' && part.type.startsWith('data-');

export const isMemoryPart = (part: unknown): part is MemoryPart =>
  isObjectRecord(part) && part.type === 'data-memory-retrieval';

export const isSkillUsagePart = (part: unknown): part is SkillUsagePart =>
  isObjectRecord(part) && part.type === 'data-skill-usage';

export const isComposerInvocationPart = (part: unknown): part is ComposerInvocationPart =>
  isObjectRecord(part) && part.type === 'data-composer-invocation';

export const isContextReportPart = (part: unknown): part is ContextReportPart =>
  isObjectRecord(part) && part.type === 'data-context-report';

export const isAffectSignalPart = (part: unknown): part is AffectSignalPart =>
  isObjectRecord(part) && part.type === 'data-affect-signal';

export const isTokenUsagePart = (part: unknown): part is TokenUsagePart =>
  isObjectRecord(part) && part.type === 'data-token-usage';

export const isDynamicToolPart = (part: unknown): part is DynamicToolPart =>
  isObjectRecord(part) &&
  part.type === 'dynamic-tool' &&
  typeof part.toolCallId === 'string' &&
  typeof part.toolName === 'string';

export const isChatUiMetadataPart = (part: unknown): part is ChatUiMetadataPart =>
  isObjectRecord(part) &&
  typeof part.type === 'string' &&
  CHAT_UI_METADATA_PART_TYPES.has(part.type as ChatUiMetadataPartType);

export const extractTextFromMessageParts = (parts: unknown): string => {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter(isTextPart)
    .map(part => part.text)
    .join('');
};

export const getMemoryPartData = (part: unknown): MemoryPartData | null => {
  if (!isMemoryPart(part)) return null;
  return isObjectRecord(part.data) ? (part.data as MemoryPartData) : {};
};

export const getSkillUsagePartData = (part: unknown): SkillUsagePartData | null => {
  if (!isSkillUsagePart(part)) return null;
  return isObjectRecord(part.data) ? (part.data as SkillUsagePartData) : {};
};

export const getComposerInvocationPartData = (part: unknown): ComposerInvocationPartData | null => {
  if (!isComposerInvocationPart(part)) return null;
  return isObjectRecord(part.data) ? (part.data as ComposerInvocationPartData) : {};
};

export const getContextReportPartData = (part: unknown): ContextReportPartData | null => {
  if (!isContextReportPart(part)) return null;
  return isObjectRecord(part.data) ? (part.data as ContextReportPartData) : {};
};

export const getAffectSignalPartData = (part: unknown): AffectSignalPartData | null => {
  if (!isAffectSignalPart(part)) return null;
  return isObjectRecord(part.data) ? (part.data as AffectSignalPartData) : {};
};

export const getTokenUsagePartData = (part: unknown): TokenUsagePartData | null => {
  if (!isTokenUsagePart(part)) return null;
  return isObjectRecord(part.data) ? (part.data as TokenUsagePartData) : {};
};

export const normalizeChatUiMetadataPart = (part: unknown): ChatUiMetadataPart | null => {
  if (isMemoryPart(part)) {
    return createMemoryPart(getMemoryPartData(part) ?? {});
  }

  if (isSkillUsagePart(part)) {
    return createSkillUsagePart(getSkillUsagePartData(part) ?? {});
  }

  if (isComposerInvocationPart(part)) {
    return createComposerInvocationPart(getComposerInvocationPartData(part) ?? {});
  }

  if (isContextReportPart(part)) {
    return createContextReportPart(getContextReportPartData(part) ?? {});
  }

  if (isAffectSignalPart(part)) {
    return createAffectSignalPart(getAffectSignalPartData(part) ?? {});
  }

  if (isTokenUsagePart(part)) {
    return createTokenUsagePart(getTokenUsagePartData(part) ?? {});
  }

  if (
    isObjectRecord(part) &&
    typeof part.type === 'string' &&
    LEGACY_CHAT_UI_METADATA_PART_TYPES.has(part.type as LegacyChatUiMetadataPartType)
  ) {
    if (part.type === 'memory-retrieval') {
      return createMemoryPart({
        ...(typeof part.query === 'string' ? { query: part.query } : {}),
        ...(Array.isArray(part.results) ? { results: part.results } : {}),
      });
    }

    if (part.type === 'skill-usage') {
      return createSkillUsagePart({
        ...(part.mode === 'auto' || part.mode === 'manual' ? { mode: part.mode } : {}),
        ...(Array.isArray(part.skills) ? { skills: part.skills } : {}),
      });
    }

    if (part.type === 'composer-invocation') {
      return createComposerInvocationPart({
        ...(Array.isArray(part.tokens) ? { tokens: part.tokens } : {}),
      });
    }

    if (part.type === 'context-report') {
      return createContextReportPart({
        ...(typeof part.totalEstimatedTokens === 'number'
          ? { totalEstimatedTokens: part.totalEstimatedTokens }
          : {}),
        ...(typeof part.retainedRecentMessages === 'number'
          ? { retainedRecentMessages: part.retainedRecentMessages }
          : {}),
        ...(typeof part.compactedMessages === 'number'
          ? { compactedMessages: part.compactedMessages }
          : {}),
        ...(Array.isArray(part.blocks) ? { blocks: part.blocks } : {}),
      });
    }

    if (part.type === 'affect-signal') {
      return createAffectSignalPart({
        ...(part.source === 'history' || part.source === 'realtime' ? { source: part.source } : {}),
        ...(typeof part.guardActive === 'boolean' ? { guardActive: part.guardActive } : {}),
        ...(isAffectLabel(part.label) ? { label: part.label } : {}),
        ...(typeof part.confidence === 'number' ? { confidence: part.confidence } : {}),
        ...(typeof part.valence === 'number' ? { valence: part.valence } : {}),
        ...(typeof part.arousal === 'number' ? { arousal: part.arousal } : {}),
        ...(Array.isArray(part.emotions) ? { emotions: part.emotions } : {}),
        ...(typeof part.sampleCount === 'number' ? { sampleCount: part.sampleCount } : {}),
        ...(typeof part.windowSize === 'number' ? { windowSize: part.windowSize } : {}),
        ...(typeof part.startAt === 'string' ? { startAt: part.startAt } : {}),
        ...(typeof part.endAt === 'string' ? { endAt: part.endAt } : {}),
        ...(typeof part.ageMinutes === 'number' ? { ageMinutes: part.ageMinutes } : {}),
        ...(typeof part.windowMinutes === 'number' ? { windowMinutes: part.windowMinutes } : {}),
      });
    }

    if (part.type === 'token-usage') {
      return createTokenUsagePart({
        ...(typeof part.inputTokens === 'number' ? { inputTokens: part.inputTokens } : {}),
        ...(typeof part.outputTokens === 'number' ? { outputTokens: part.outputTokens } : {}),
        ...(typeof part.totalTokens === 'number' ? { totalTokens: part.totalTokens } : {}),
        ...(typeof part.cacheReadTokens === 'number'
          ? { cacheReadTokens: part.cacheReadTokens }
          : {}),
        ...(typeof part.cacheWriteTokens === 'number'
          ? { cacheWriteTokens: part.cacheWriteTokens }
          : {}),
        ...(typeof part.reasoningTokens === 'number'
          ? { reasoningTokens: part.reasoningTokens }
          : {}),
        ...(typeof part.estimatedCostUsd === 'number'
          ? { estimatedCostUsd: part.estimatedCostUsd }
          : {}),
        ...(typeof part.maxInputTokens === 'number' ? { maxInputTokens: part.maxInputTokens } : {}),
        ...(typeof part.maxOutputTokens === 'number'
          ? { maxOutputTokens: part.maxOutputTokens }
          : {}),
        ...(typeof part.model === 'string' ? { model: part.model } : {}),
        ...(typeof part.providerType === 'string' ? { providerType: part.providerType } : {}),
        ...(typeof part.providerId === 'string' ? { providerId: part.providerId } : {}),
      });
    }
  }

  return null;
};
