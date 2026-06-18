import { describe, expect, it } from 'vitest';

import {
  clipTextToTokenBudget,
  estimateMessageTokens,
  estimateTextTokens,
} from '@iki/core/chat_service/token_estimator';

describe('token_estimator', () => {
  it('counts tokens with BPE tokenizer (gpt-tokenizer)', () => {
    expect(estimateTextTokens('abcdefgh')).toBe(1);
    expect(estimateTextTokens('hello world')).toBe(2);
    expect(estimateTextTokens('你好你好你好你好')).toBe(4);
  });

  it('adds message overhead on top of estimated content tokens', () => {
    expect(
      estimateMessageTokens({
        role: 'user',
        content: 'abcdefgh',
      })
    ).toBe(5);
  });

  it('clips text against the requested token budget', () => {
    expect(clipTextToTokenBudget('hello world this is a test of clipping', 4)).toEqual({
      text: 'hello world this...',
      truncated: true,
    });
  });

  it('does not truncate when text fits within token budget', () => {
    expect(clipTextToTokenBudget('hello world', 3)).toEqual({
      text: 'hello world',
      truncated: false,
    });
  });

  it('returns an empty clipped payload when the budget cannot fit anything', () => {
    expect(clipTextToTokenBudget('abcdef', 0)).toEqual({
      text: '',
      truncated: true,
    });
  });
});
