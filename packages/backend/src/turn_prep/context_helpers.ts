import {
  extractTextFromModelMessageContent,
} from '@iki/backend/agent/model_messages';
import {
  clipTextToTokenBudget,
  estimateMessageTokens,
  estimateTextTokens,
} from '../agent/context_budget';
import { DEFAULT_APP_CONFIG } from '@iki/backend/config/defaults';
import type { AppConfig } from '@iki/backend/types/config';
import type { ModelCapability } from '@iki/backend/utils/provider_models';
import type { ChatInputMessage } from '../thread_session/types';
import type {
  AssembleChatContextResult,
  ContextBlockKind,
  ContextConfig,
  ContextReportBlock,
} from './context_types';

export const getContextConfig = (
  configured?: AppConfig['memory']['context'] | null
): ContextConfig => ({
  ...DEFAULT_APP_CONFIG.memory.context,
  ...(configured ?? {}),
});

export const countMessageTokens = (
  message: ChatInputMessage,
  _modelCapability?: unknown
): number => estimateMessageTokens(message);


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
