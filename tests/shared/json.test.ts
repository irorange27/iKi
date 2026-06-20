import { describe, expect, it } from 'vitest';

import { parseJsonObjectRecord, parseJsonStringArray } from '@iki/backend/utils/json';

describe('json utils', () => {
  it('parses object records with invalid input fallback', () => {
    expect(parseJsonObjectRecord('{"a":1,"b":"x"}')).toEqual({ a: 1, b: 'x' });
    expect(parseJsonObjectRecord('["not","object"]')).toEqual({});
    expect(parseJsonObjectRecord('bad json')).toEqual({});
  });

  it('parses string arrays while filtering non-string entries', () => {
    expect(parseJsonStringArray('["a",1,"b",null]')).toEqual(['a', 'b']);
    expect(parseJsonStringArray('{"not":"array"}')).toEqual([]);
    expect(parseJsonStringArray('')).toEqual([]);
  });
});
