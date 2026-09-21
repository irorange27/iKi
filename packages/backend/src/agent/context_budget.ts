import { countTokens, decode, encode } from 'gpt-tokenizer';
import type { ModelMessage } from 'ai';


const MESSAGE_OVERHEAD_TOKENS = 4;
const TOOL_MESSAGE_OVERHEAD_TOKENS = 8;
const TRUNCATION_SUFFIX = '...';

const getMessageText = (message: ModelMessage): string =>
  typeof message.content === 'string' ? message.content : JSON.stringify(message.content);

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

/** Plan a prefix replacement at complete tool-exchange boundaries; the caller must summarize omitted messages. */
export const autoCompactHistory = (params: {
  history: ModelMessage[];
  maxInputTokens?: number;
  threshold?: number;
  keepRatio?: number;
}): { history: ModelMessage[]; omitted: ModelMessage[]; compacted: boolean; droppedCount: number } => {
  const { history, maxInputTokens, threshold = AUTO_COMPACT_THRESHOLD, keepRatio = AUTO_COMPACT_KEEP_RATIO } = params;
  const unchanged = { history, omitted: [] as ModelMessage[], compacted: false, droppedCount: 0 };
  if (!maxInputTokens || !Number.isFinite(maxInputTokens) || maxInputTokens <= 0) return unchanged;
  const total = history.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  if (total <= maxInputTokens * threshold) return unchanged;
  const systems = history.filter(message => message.role === 'system');
  const conversation = history.filter(message => message.role !== 'system');
  const lastUser = conversation.findLastIndex(message => message.role === 'user');
  const boundaries = conversation.flatMap((message, index) => message.role !== 'tool' ? [index] : []);
  if (boundaries.length < 2 || lastUser < 0) return unchanged;
  let start = boundaries.at(-1)!;
  const protectedUser = start > lastUser ? [conversation[lastUser]] : [];
  let tokens = [...systems, ...protectedUser, ...conversation.slice(start)].reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  for (let i = boundaries.length - 2; i >= 0; i--) {
    const next = boundaries[i];
    const added = conversation.slice(next, start).filter(message => !protectedUser.includes(message))
      .reduce((sum, message) => sum + estimateMessageTokens(message), 0);
    if (tokens + added > maxInputTokens * keepRatio) break;
    tokens += added;
    start = next;
  }
  const omitted = conversation.slice(0, start).filter((_, index) => index !== lastUser);
  if (!omitted.length) return unchanged;
  return {
    history: [...systems, ...(start > lastUser ? [conversation[lastUser]] : []), ...conversation.slice(start)],
    omitted, compacted: true, droppedCount: omitted.length,
  };

};
