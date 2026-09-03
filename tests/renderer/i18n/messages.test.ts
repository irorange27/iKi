import { describe, expect, it } from 'vitest';

import { messages, type TranslationKey } from '../../../packages/desktop/src/renderer/i18n/messages';

const sortedKeys = (locale: keyof typeof messages): TranslationKey[] =>
  Object.keys(messages[locale]).sort() as TranslationKey[];

describe('renderer i18n messages', () => {
  it('keeps the same translation keys across locales', () => {
    expect(sortedKeys('zh-CN')).toEqual(sortedKeys('en'));
  });

});
