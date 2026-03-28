import { describe, expect, it } from 'vitest';

import { getErrorMessage } from '../../src/shared/utils/errors';

describe('error utils', () => {
  it('prefers Error messages', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('normalizes nullish values to a stable fallback', () => {
    expect(getErrorMessage(null)).toBe('Unknown error');
    expect(getErrorMessage(undefined)).toBe('Unknown error');
  });

  it('stringifies other values', () => {
    expect(getErrorMessage(42)).toBe('42');
  });
});
