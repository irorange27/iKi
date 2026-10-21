import { describe, expect, it } from 'vitest';

import { parseJsonStringArray, toStringArray } from '@iki/backend/utils/json';

describe('toStringArray', () => {
  it('keeps non-empty trimmed strings from an array', () => {
    expect(toStringArray(['a', ' b ', '', 3, null])).toEqual(['a', 'b']);
  });

  it('wraps a non-empty string and drops a blank one', () => {
    expect(toStringArray(' a ')).toEqual(['a']);
    expect(toStringArray('   ')).toEqual([]);
  });

  it('returns nothing for a non-string non-array', () => {
    expect(toStringArray(42)).toEqual([]);
    expect(toStringArray(null)).toEqual([]);
  });
});

describe('parseJsonStringArray', () => {
  it('decodes a JSON array', () => {
    expect(parseJsonStringArray('["a","b"]')).toEqual(['a', 'b']);
  });

  it('falls back to treating the raw value as one entry when it is not JSON', () => {
    expect(parseJsonStringArray('plain')).toEqual(['plain']);
  });

  it('returns nothing for a missing or blank column', () => {
    expect(parseJsonStringArray(null)).toEqual([]);
    expect(parseJsonStringArray('')).toEqual([]);
    expect(parseJsonStringArray('   ')).toEqual([]);
  });
});
