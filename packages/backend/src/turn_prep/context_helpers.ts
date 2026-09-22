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

/**
 * Volatile per-turn context rides with the newest user message rather than the
 * system prefix. Prompt caching is a prefix: anything that changes ahead of the
 * transcript forces the whole history to be re-prefilled, so only stable
 * instruction blocks belong in front of it. The envelope keeps injected text
 * from being read as something the user actually said.
 */
const ENVELOPE_OPEN = '<system-reminder>';
const ENVELOPE_CLOSE = '</system-reminder>';

/** Inverse of the envelope: exports show what the user wrote, not what we injected. */
export const stripInjectedContext = (text: string): string =>
  text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();

export const appendContextToLastUserMessage = (
  messages: ChatInputMessage[],
  context: string
): ChatInputMessage[] => {
  const trimmed = context.trim();
  if (!trimmed) return messages;

  const envelope = `${ENVELOPE_OPEN}\n${trimmed}\n${ENVELOPE_CLOSE}`;
  const index = messages.findLastIndex(message => message.role === 'user');
  if (index === -1) {
    return [...messages, { role: 'user', content: envelope } as ChatInputMessage];
  }

  const target = messages[index];
  const enriched =
    typeof target.content === 'string'
      ? `${target.content}\n\n${envelope}`
      : [...(target.content ?? []), { type: 'text', text: `\n\n${envelope}` } as never];

  return [
    ...messages.slice(0, index),
    { ...target, content: enriched } as ChatInputMessage,
    ...messages.slice(index + 1),
  ];
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
