import type { SkillSource } from '@iki/backend/types/skill';
import type { ContextCompositionSummary } from '@iki/backend/types/context_composition';
import { isObjectRecord } from '@iki/backend/utils/guards';

export { isObjectRecord };

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
  kind?: 'recent-history' | 'identity' | 'thread-summary' | 'skills';
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

export type TokenUsagePartData = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  estimatedCostUsd?: number;
  /** Billed input of the final SDK step — the real context size the model last saw (absent on legacy messages). */
  lastStepInputTokens?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  model?: string;
  providerType?: string;
  providerId?: string;
  /** Turn perf metrics (undefined on messages produced before instrumentation). */
  llmMs?: number;
  toolMs?: number;
  firstTokenMs?: number;
  firstTokenSamples?: number;
  steps?: number;
  toolCalls?: number;
  /** Estimated per-category context assembly breakdown (absent on legacy messages). */
  contextComposition?: ContextCompositionSummary;
};

const isContextCompositionSummary = (value: unknown): value is ContextCompositionSummary => {
  if (!isObjectRecord(value) || !isObjectRecord(value.categories)) return false;
  return typeof value.estimatedTotalTokens === 'number';
};

export type ChatUiDataTypes = {
  'skill-usage': SkillUsagePartData;
  'composer-invocation': ComposerInvocationPartData;
  'context-report': ContextReportPartData;
  'token-usage': TokenUsagePartData;
};

// These used to be AI SDK generic instantiations (`UIMessage`,
// `UIMessageChunk`), which made that package the type authority for iKi's own
// persisted format (ADR 009). They now come from the protocol module.
import type {
  UiDataPart,
  UiGenericDataPart,
  ChatUiChunk,
  ChatUiMessage,
  ChatUiPart,
} from './ui_protocol';

export type { ChatUiMessage };
export type ChatUiMessageChunk = ChatUiChunk;

/**
 * The data-part members of a message's parts, one per entry in
 * `ChatUiDataTypes`.
 *
 * Generated from the map so the `type` literal of each member is exact — the
 * nine `Extract<UiMessagePart, { type: 'data-…' }>` aliases below depend on it.
 */
type ChatUiDataPart = {
  [K in keyof ChatUiDataTypes]: UiDataPart<K & string, ChatUiDataTypes[K]>;
}[keyof ChatUiDataTypes];

export type UiMessagePart =
  | Exclude<ChatUiPart, { type: `data-${string}` }>
  | ChatUiDataPart
  // An unknown `data-*` key still produces a valid part at runtime (the
  // renderer switches on the prefix); typing it away would force every generic
  // producer to invent a key.
  | UiGenericDataPart;
export type TextPart = Extract<UiMessagePart, { type: 'text' }>;
export type ReasoningPart = Extract<UiMessagePart, { type: 'reasoning' }>;
export type SkillUsagePart = Extract<UiMessagePart, { type: 'data-skill-usage' }>;
export type ComposerInvocationPart = Extract<UiMessagePart, { type: 'data-composer-invocation' }>;
export type ContextReportPart = Extract<UiMessagePart, { type: 'data-context-report' }>;
export type TokenUsagePart = Extract<UiMessagePart, { type: 'data-token-usage' }>;
export type DynamicToolPart = Extract<UiMessagePart, { type: 'dynamic-tool' }>;

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
  llmMs?: number;
  toolMs?: number;
  firstTokenMs?: number;
  firstTokenSamples?: number;
  steps?: number;
  toolCalls?: number;
};

type LegacyChatUiMetadataPart =
  | LegacySkillUsagePart
  | LegacyComposerInvocationPart
  | LegacyContextReportPart
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
  | SkillUsagePart
  | ComposerInvocationPart
  | ContextReportPart
  | TokenUsagePart;

type ChatUiMetadataPartType = ChatUiMetadataPart['type'];
type LegacyChatUiMetadataPartType = LegacyChatUiMetadataPart['type'];

const CHAT_UI_METADATA_PART_TYPES = new Set<ChatUiMetadataPartType>([
  'data-skill-usage',
  'data-composer-invocation',
  'data-context-report',
  'data-token-usage',
]);

const LEGACY_CHAT_UI_METADATA_PART_TYPES = new Set<LegacyChatUiMetadataPartType>([
  'skill-usage',
  'composer-invocation',
  'context-report',
  'token-usage',
]);

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

export const createTokenUsagePart = (data: TokenUsagePartData): TokenUsagePart => ({
  type: 'data-token-usage',
  data,
});

export const isTextPart = (part: unknown): part is TextPart =>
  isObjectRecord(part) && part.type === 'text' && typeof part.text === 'string';

export const isReasoningPart = (part: unknown): part is ReasoningPart =>
  isObjectRecord(part) && part.type === 'reasoning' && typeof part.text === 'string';

export const isDataPart = (part: unknown): boolean =>
  isObjectRecord(part) && typeof part.type === 'string' && part.type.startsWith('data-');

export const isSkillUsagePart = (part: unknown): part is SkillUsagePart =>
  isObjectRecord(part) && part.type === 'data-skill-usage';

export const isComposerInvocationPart = (part: unknown): part is ComposerInvocationPart =>
  isObjectRecord(part) && part.type === 'data-composer-invocation';

export const isContextReportPart = (part: unknown): part is ContextReportPart =>
  isObjectRecord(part) && part.type === 'data-context-report';

export const isTokenUsagePart = (part: unknown): part is TokenUsagePart =>
  isObjectRecord(part) && part.type === 'data-token-usage';

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

/**
 * Project a stored message JSON blob into `{ role, content }`.
 *
 * Moved here from the removed memory module: continuity capture needs the plain
 * text of a persisted message and has nothing to do with memory retrieval.
 */
export const extractTextFromMessageJson = (
  messageJson: string
): { role: string; content: string } | null => {
  try {
    const parsed = JSON.parse(messageJson) as {
      role?: string;
      parts?: unknown[];
      content?: string;
    };

    if (!parsed || typeof parsed !== 'object' || typeof parsed.role !== 'string') return null;

    if (Array.isArray(parsed.parts)) {
      return { role: parsed.role, content: extractTextFromMessageParts(parsed.parts) };
    }

    if (typeof parsed.content === 'string') {
      return { role: parsed.role, content: parsed.content };
    }
  } catch {
    return null;
  }

  return null;
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

export const getTokenUsagePartData = (part: unknown): TokenUsagePartData | null => {
  if (!isTokenUsagePart(part)) return null;
  return isObjectRecord(part.data) ? (part.data as TokenUsagePartData) : {};
};

export const normalizeChatUiMetadataPart = (part: unknown): ChatUiMetadataPart | null => {
  if (isSkillUsagePart(part)) {
    return createSkillUsagePart(getSkillUsagePartData(part) ?? {});
  }

  if (isComposerInvocationPart(part)) {
    return createComposerInvocationPart(getComposerInvocationPartData(part) ?? {});
  }

  if (isContextReportPart(part)) {
    return createContextReportPart(getContextReportPartData(part) ?? {});
  }

  if (isTokenUsagePart(part)) {
    return createTokenUsagePart(getTokenUsagePartData(part) ?? {});
  }

  if (
    isObjectRecord(part) &&
    typeof part.type === 'string' &&
    LEGACY_CHAT_UI_METADATA_PART_TYPES.has(part.type as LegacyChatUiMetadataPartType)
  ) {
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
        ...(isContextCompositionSummary(part.contextComposition)
          ? { contextComposition: part.contextComposition }
          : {}),
      });
    }
  }

  return null;
};
