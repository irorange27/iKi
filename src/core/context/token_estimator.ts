import type { ModelMessage } from 'ai';

import { extractTextFromModelMessageContent } from '../agent/model_messages';
import type { ModelCapability } from '../../shared/utils/provider_models';

type TokenEstimatorProfile = {
  latinCharsPerToken: number;
  digitCharsPerToken: number;
  punctuationCharsPerToken: number;
  otherCharsPerToken: number;
  cjkTokensPerChar: number;
  symbolTokensPerChar: number;
  messageOverheadTokens: number;
  toolPayloadOverheadTokens: number;
};

const DEFAULT_PROFILE: TokenEstimatorProfile = {
  latinCharsPerToken: 4,
  digitCharsPerToken: 3,
  punctuationCharsPerToken: 3,
  otherCharsPerToken: 2,
  cjkTokensPerChar: 1,
  symbolTokensPerChar: 1,
  messageOverheadTokens: 4,
  toolPayloadOverheadTokens: 8,
};

const PROVIDER_PROFILES: Partial<Record<string, Partial<TokenEstimatorProfile>>> = {
  openai: {
    latinCharsPerToken: 4,
    digitCharsPerToken: 3,
    punctuationCharsPerToken: 3,
    otherCharsPerToken: 2,
    cjkTokensPerChar: 1,
  },
  deepseek: {
    latinCharsPerToken: 4,
    digitCharsPerToken: 3,
    punctuationCharsPerToken: 3,
    otherCharsPerToken: 2,
    cjkTokensPerChar: 1,
  },
  moonshotai: {
    latinCharsPerToken: 4,
    digitCharsPerToken: 3,
    punctuationCharsPerToken: 3,
    otherCharsPerToken: 2,
    cjkTokensPerChar: 1,
  },
  zhipuai: {
    latinCharsPerToken: 4,
    digitCharsPerToken: 3,
    punctuationCharsPerToken: 3,
    otherCharsPerToken: 2,
    cjkTokensPerChar: 1,
  },
  'minimax-cn': {
    latinCharsPerToken: 4,
    digitCharsPerToken: 3,
    punctuationCharsPerToken: 3,
    otherCharsPerToken: 2,
    cjkTokensPerChar: 1,
  },
};

const ASCII_LETTER = /^[A-Za-z]$/;
const ASCII_DIGIT = /^[0-9]$/;
const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/;
const CJK_OR_SIMILAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const LETTER_OR_MARK = /[\p{Letter}\p{Mark}]/u;
const SYMBOL_OR_EMOJI = /[\p{Extended_Pictographic}\p{Symbol}]/u;

type RunType = 'latin' | 'digit' | 'punctuation' | 'other';

const mergeProfile = (capability?: ModelCapability | null): TokenEstimatorProfile => {
  const providerKey = capability?.providerKey ?? capability?.providerType ?? '';
  return {
    ...DEFAULT_PROFILE,
    ...(providerKey ? (PROVIDER_PROFILES[providerKey] ?? {}) : {}),
  };
};

const finalizeRun = (runLength: number, charsPerToken: number): number => {
  if (runLength <= 0) return 0;
  return Math.max(1, Math.ceil(runLength / Math.max(1, charsPerToken)));
};

const flushRun = (
  runType: RunType | null,
  runLength: number,
  profile: TokenEstimatorProfile
): number => {
  if (!runType || runLength <= 0) return 0;

  if (runType === 'latin') {
    return finalizeRun(runLength, profile.latinCharsPerToken);
  }
  if (runType === 'digit') {
    return finalizeRun(runLength, profile.digitCharsPerToken);
  }
  if (runType === 'punctuation') {
    return finalizeRun(runLength, profile.punctuationCharsPerToken);
  }
  return finalizeRun(runLength, profile.otherCharsPerToken);
};

const classifyRunType = (char: string): RunType | null => {
  if (ASCII_LETTER.test(char)) return 'latin';
  if (ASCII_DIGIT.test(char)) return 'digit';
  if (ASCII_PUNCTUATION.test(char)) return 'punctuation';
  if (LETTER_OR_MARK.test(char)) return 'other';
  return null;
};

const estimateTextBodyTokens = (value: string, profile: TokenEstimatorProfile): number => {
  let currentRunType: RunType | null = null;
  let currentRunLength = 0;
  let tokens = 0;

  const flushCurrentRun = () => {
    tokens += flushRun(currentRunType, currentRunLength, profile);
    currentRunType = null;
    currentRunLength = 0;
  };

  for (const char of value) {
    if (!char.trim()) {
      if (currentRunType && currentRunType !== 'punctuation') {
        currentRunLength += 1;
      } else {
        flushCurrentRun();
      }
      continue;
    }

    if (CJK_OR_SIMILAR.test(char)) {
      flushCurrentRun();
      tokens += profile.cjkTokensPerChar;
      continue;
    }

    if (SYMBOL_OR_EMOJI.test(char)) {
      flushCurrentRun();
      tokens += profile.symbolTokensPerChar;
      continue;
    }

    const nextRunType = classifyRunType(char);
    if (!nextRunType) {
      flushCurrentRun();
      tokens += profile.symbolTokensPerChar;
      continue;
    }

    if (currentRunType === nextRunType) {
      currentRunLength += 1;
      continue;
    }

    flushCurrentRun();
    currentRunType = nextRunType;
    currentRunLength = 1;
  }

  flushCurrentRun();
  return Math.max(0, Math.ceil(tokens));
};

const normalizeText = (value: string): string => value.replace(/\r/g, '').trim();

export const estimateTextTokens = (value: string, capability?: ModelCapability | null): number => {
  const normalized = normalizeText(value);
  if (!normalized) return 0;
  return Math.max(1, estimateTextBodyTokens(normalized, mergeProfile(capability)));
};

export const estimateMessageTokens = (
  message: ModelMessage,
  capability?: ModelCapability | null
): number => {
  const profile = mergeProfile(capability);

  if (message.role === 'tool') {
    const payload = JSON.stringify(message.content ?? {});
    return estimateTextBodyTokens(payload, profile) + profile.toolPayloadOverheadTokens;
  }

  const text =
    typeof message.content === 'string'
      ? message.content
      : extractTextFromModelMessageContent(message.content);
  const estimated = estimateTextBodyTokens(text, profile);
  return estimated > 0 ? estimated + profile.messageOverheadTokens : 0;
};

export const clipTextToTokenBudget = (
  value: string,
  maxTokens: number,
  capability?: ModelCapability | null
): { text: string; truncated: boolean } => {
  const normalized = value.trim();
  if (!normalized) return { text: '', truncated: false };
  if (maxTokens <= 0) return { text: '', truncated: true };

  if (estimateTextTokens(normalized, capability) <= maxTokens) {
    return { text: value, truncated: false };
  }

  const suffix = '...';
  const suffixTokens = estimateTextTokens(suffix, capability);
  const availableTokens = Math.max(0, maxTokens - suffixTokens);
  if (availableTokens <= 0) {
    return { text: '', truncated: true };
  }

  const chars = Array.from(value);
  let low = 0;
  let high = chars.length;
  let best = '';

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = chars.slice(0, mid).join('').trimEnd();
    const estimated = estimateTextTokens(candidate, capability);

    if (estimated <= availableTokens) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best ? { text: `${best}${suffix}`, truncated: true } : { text: '', truncated: true };
};
