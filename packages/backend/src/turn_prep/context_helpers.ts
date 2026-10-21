import { extractTextFromModelMessageContent } from '@iki/backend/agent/model_messages';
import {
  clipTextToTokenBudget,
  estimateMessageTokens,
  estimateTextTokens,
} from '../agent/context_budget';
import { DEFAULT_APP_CONFIG } from '@iki/backend/config/defaults';
import type { AppConfig } from '@iki/backend/types/config';
import type { ChatInputMessage } from '@iki/backend/message/chat_message_types';
import type {
  AssembleChatContextResult,
  ContextBlockKind,
  ContextConfig,
  ContextReport,
  ContextReportBlock,
} from './context_types';
import type {
  ContextCompositionCategory,
  ContextCompositionSummary,
} from '@iki/backend/types/context_composition';

export const getContextConfig = (configured?: AppConfig['context'] | null): ContextConfig => ({
  ...DEFAULT_APP_CONFIG.context,
  ...(configured ?? {}),
});

export const countMessageTokens = (message: ChatInputMessage, _modelCapability?: unknown): number =>
  estimateMessageTokens(message);

export const buildMessagePreview = (message: ChatInputMessage): string => {
  if (typeof message.content === 'string') return message.content;
  if (message.role === 'tool') return JSON.stringify(message.content ?? {});
  return extractTextFromModelMessageContent(message.content);
};

export const insertSystemMessages = (
  messages: ChatInputMessage[],
  additions: string[]
): ChatInputMessage[] => {
  const nextSystemMessages = additions
    .map(content => content.trim())
    .filter(Boolean)
    .map(content => ({ role: 'system', content }) as ChatInputMessage);

  if (nextSystemMessages.length === 0) return messages;

  const insertIndex = messages.findIndex(message => message.role !== 'system');
  const headIndex = insertIndex === -1 ? messages.length : insertIndex;
  return [...messages.slice(0, headIndex), ...nextSystemMessages, ...messages.slice(headIndex)];
};

export const buildDroppedBlock = (kind: ContextBlockKind, reason: string): ContextReportBlock => ({
  kind,
  status: 'dropped',
  estimatedTokens: 0,
  charCount: 0,
  reason,
});

const CONTEXT_COMPOSITION_BLOCK_CATEGORIES: Record<ContextBlockKind, ContextCompositionCategory> = {
  'recent-history': 'messages',
  identity: 'systemPrompt',
  skills: 'skills',
  'thread-summary': 'other',
};

export const summarizeContextComposition = (params: {
  report: ContextReport;
  toolSchemaTokens?: { builtin: number; mcp: number } | null;
}): ContextCompositionSummary => {
  const categories: Partial<Record<ContextCompositionCategory, number>> = {};
  const add = (category: ContextCompositionCategory, tokens: number): void => {
    if (!Number.isFinite(tokens) || tokens <= 0) return;
    categories[category] = (categories[category] ?? 0) + Math.round(tokens);
  };

  for (const block of params.report.blocks) {
    add(CONTEXT_COMPOSITION_BLOCK_CATEGORIES[block.kind] ?? 'other', block.estimatedTokens);
  }
  add('tools', params.toolSchemaTokens?.builtin ?? 0);
  add('mcpTools', params.toolSchemaTokens?.mcp ?? 0);

  const estimatedTotalTokens = Object.values(categories).reduce(
    (sum, value) => sum + (value ?? 0),
    0
  );
  return { estimatedTotalTokens, categories };
};

export const buildAssembleResult = (params: {
  messages: ChatInputMessage[];
  usedSkills: AssembleChatContextResult['usedSkills'];
  skillMode: 'manual' | 'auto';
  retainedRecentMessages: number;
  compactedMessages: number;
  blocks: ContextReportBlock[];
  effectiveContextConfig: AssembleChatContextResult['effectiveContextConfig'];
}): AssembleChatContextResult => ({
  messages: params.messages,
  usedSkills: params.usedSkills,
  skillMode: params.skillMode,
  effectiveContextConfig: params.effectiveContextConfig,
  report: {
    totalEstimatedTokens: params.blocks.reduce((sum, block) => sum + block.estimatedTokens, 0),
    retainedRecentMessages: params.retainedRecentMessages,
    compactedMessages: params.compactedMessages,
    blocks: params.blocks,
  },
});

export { clipTextToTokenBudget, estimateTextTokens };
