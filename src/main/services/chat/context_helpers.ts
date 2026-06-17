import { getAppConfig } from '../../../core/config';
import {
  extractTextFromModelMessageContent,
} from '../../../core/agent/model_messages';
import {
  clipTextToTokenBudget,
  estimateMessageTokens,
  estimateTextTokens,
} from '../../../core/context/token_estimator';
import { DEFAULT_APP_CONFIG } from '../../../shared/config/defaults';
import type { ModelCapability } from '../../../shared/utils/provider_models';
import type { ChatInputMessage } from './types';
import type {
  AssembleChatContextResult,
  ContextBlockKind,
  ContextConfig,
  ContextReportBlock,
} from './context_types';

export const getContextConfig = (): ContextConfig => {
  const configured = getAppConfig()?.memory?.context;
  return {
    ...DEFAULT_APP_CONFIG.memory.context,
    ...(configured ?? {}),
  };
};

export const countMessageTokens = (
  message: ChatInputMessage,
  _modelCapability?: unknown
): number => estimateMessageTokens(message);

export const clipMessageToBudget = (
  message: ChatInputMessage,
  maxTokens: number,
  _modelCapability?: ModelCapability | null
): { message: ChatInputMessage; truncated: boolean } => {
  if (maxTokens <= 0) return { message, truncated: false };

  if (message.role === 'tool') {
    return { message, truncated: false };
  }

  if (typeof message.content === 'string') {
    const clipped = clipTextToTokenBudget(message.content, maxTokens);
    return clipped.truncated
      ? { message: { ...message, content: clipped.text }, truncated: true }
      : { message, truncated: false };
  }

  if (
    Array.isArray(message.content) &&
    message.content.every(
      part =>
        part &&
        typeof part === 'object' &&
        'type' in part &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string'
    )
  ) {
    const clipped = clipTextToTokenBudget(
      extractTextFromModelMessageContent(message.content),
      maxTokens
    );
    return clipped.truncated
      ? { message: { ...message, content: clipped.text }, truncated: true }
      : { message, truncated: false };
  }

  return { message, truncated: false };
};

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
