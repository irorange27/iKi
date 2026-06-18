import { countTokens, decode, encode } from 'gpt-tokenizer';
import type { ModelMessage } from 'ai';

import { extractTextFromModelMessageContent } from '@iki/core/agent/model_messages';

const MESSAGE_OVERHEAD_TOKENS = 4;
const TOOL_MESSAGE_OVERHEAD_TOKENS = 8;
const TRUNCATION_SUFFIX = '...';

const getMessageText = (message: ModelMessage): string => {
  if (message.role === 'tool') {
    return JSON.stringify(message.content ?? {});
  }

  if (typeof message.content === 'string') return message.content;
  return extractTextFromModelMessageContent(message.content);
};

export const estimateTextTokens = (value: string): number => {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return countTokens(trimmed);
};

export const estimateMessageTokens = (message: ModelMessage): number => {
  const text = getMessageText(message);
  if (!text) return 0;

  const tokens = countTokens(text);
  if (message.role === 'tool') {
    return tokens + TOOL_MESSAGE_OVERHEAD_TOKENS;
  }
  return tokens > 0 ? tokens + MESSAGE_OVERHEAD_TOKENS : 0;
};

export const clipTextToTokenBudget = (
  value: string,
  maxTokens: number
): { text: string; truncated: boolean } => {
  const trimmed = value.trim();
  if (!trimmed) return { text: '', truncated: false };
  if (maxTokens <= 0) return { text: '', truncated: true };

  const encoded = encode(trimmed);
  if (encoded.length <= maxTokens) return { text: value, truncated: false };

  const suffixTokens = countTokens(TRUNCATION_SUFFIX);
  const availableTokens = Math.max(0, maxTokens - suffixTokens);
  if (availableTokens <= 0) return { text: '', truncated: true };

  const truncated = decode(encoded.slice(0, availableTokens));
  return { text: `${truncated}${TRUNCATION_SUFFIX}`, truncated: true };
};
