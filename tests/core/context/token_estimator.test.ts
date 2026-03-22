import { describe, expect, it } from 'vitest';

import {
  clipTextToTokenBudget,
  estimateMessageTokens,
  estimateTextTokens,
} from '../../../src/core/context/token_estimator';

describe('token_estimator', () => {
  it('compresses latin and punctuation runs more than CJK characters', () => {
    expect(estimateTextTokens('abcdefgh')).toBe(2);
    expect(estimateTextTokens('...')).toBe(1);
    expect(estimateTextTokens('你好你好你好你好')).toBe(8);
  });

  it('adds message overhead on top of estimated content tokens', () => {
    expect(
      estimateMessageTokens({
        role: 'user',
        content: 'abcdefgh',
      })
    ).toBe(6);
  });

  it('clips text against the requested token budget using the shared estimator', () => {
    expect(clipTextToTokenBudget('abcdefghijklmnopqrstuvwx', 5)).toEqual({
      text: 'abcdefghijklmnop...',
      truncated: true,
    });
  });

  it('returns an empty clipped payload when the budget cannot fit even the truncation suffix', () => {
    expect(clipTextToTokenBudget('abcdef', 0)).toEqual({
      text: '',
      truncated: true,
    });
  });
});
