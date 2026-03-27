import { describe, expect, it } from 'vitest';

import {
  normalizeOptionalWhitespace,
  normalizeWhitespace,
  toIsoNow,
} from '../../src/shared/utils/text';

describe('text utils', () => {
  it('normalizes whitespace-only string inputs consistently', () => {
    expect(normalizeWhitespace('  hello   world \n\n again  ')).toBe('hello world again');
    expect(normalizeWhitespace(42)).toBe('');
    expect(normalizeOptionalWhitespace('   ')).toBeNull();
  });

  it('formats the provided date as an ISO timestamp', () => {
    expect(toIsoNow(new Date('2026-03-28T10:20:30.000Z'))).toBe('2026-03-28T10:20:30.000Z');
  });
});
