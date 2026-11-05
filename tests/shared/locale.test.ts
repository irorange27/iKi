import { describe, expect, it } from 'vitest';

import { normalizeAppLocale } from '@iki/core/i18n/locale';

describe('normalizeAppLocale', () => {
  it('normalizes Chinese variants to zh-CN', () => {
    expect(normalizeAppLocale('zh')).toBe('zh-CN');
    expect(normalizeAppLocale('zh-Hans')).toBe('zh-CN');
    expect(normalizeAppLocale('zh_CN')).toBe('zh-CN');
  });

  it('falls back to English for unsupported locales', () => {
    expect(normalizeAppLocale('en-US')).toBe('en');
    expect(normalizeAppLocale('fr-FR')).toBe('en');
    expect(normalizeAppLocale(undefined)).toBe('en');
  });
});
