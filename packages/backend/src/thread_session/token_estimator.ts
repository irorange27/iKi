import { countTokens, decode, encode } from 'gpt-tokenizer';
import type { ModelMessage } from 'ai';

import { extractTextFromModelMessageContent } from '@iki/backend/agent/model_messages';

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

export const AUTO_COMPACT_THRESHOLD = 0.8;
export const AUTO_COMPACT_KEEP_RATIO = 0.5;

/**
 * Auto-compact a growing stream history before the next model call: keep the
 * most recent messages that fit the keep budget and prepend a marker noting
 * what was dropped. The full history remains persisted on the run record —
 * only the next call's trajectory is trimmed.
 */
export const autoCompactHistory = (params: {
  history: ModelMessage[];
  maxInputTokens?: number;
  threshold?: number;
  keepRatio?: number;
}): { history: ModelMessage[]; compacted: boolean; droppedCount: number } => {
  const {
    history,
    maxInputTokens,
    threshold = AUTO_COMPACT_THRESHOLD,
    keepRatio = AUTO_COMPACT_KEEP_RATIO,
  } = params;

  if (!maxInputTokens || maxInputTokens <= 0 || history.length === 0) {
    return { history, compacted: false, droppedCount: 0 };
  }

  const totalTokens = history.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  if (totalTokens <= maxInputTokens * threshold) {
    return { history, compacted: false, droppedCount: 0 };
  }

  const keepBudget = maxInputTokens * keepRatio;
  const kept: ModelMessage[] = [];
  let keptTokens = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    const tokens = estimateMessageTokens(message);
    if (kept.length > 0 && keptTokens + tokens > keepBudget) break;
    kept.unshift(message);
    keptTokens += tokens;
  }

  const droppedCount = history.length - kept.length;
  if (droppedCount === 0) {
    return { history, compacted: false, droppedCount: 0 };
  }

  return {
    history: [
      {
        role: 'system',
        content: `[AUTO COMPACT] ${droppedCount} earlier message(s) were omitted to stay within the model context budget. The full history remains persisted on the run record; re-read any needed detail via tools if required.`,
      } as ModelMessage,
      ...kept,
    ],
    compacted: true,
    droppedCount,
  };
};
