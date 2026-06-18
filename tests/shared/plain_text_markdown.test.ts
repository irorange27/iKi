import { describe, expect, it } from 'vitest';

import { renderMarkdownToPlainText } from '@iki/core/utils/plain_text_markdown';

describe('renderMarkdownToPlainText', () => {
  it('converts common markdown constructs into readable plain text', () => {
    const result = renderMarkdownToPlainText(
      [
        '# Daily Brief',
        '',
        '- **BBC**',
        '- [OpenAI](https://openai.com)',
        '',
        '| Site | Status |',
        '| --- | --- |',
        '| BBC | Live |',
        '',
        '`done`',
        '',
        '```ts',
        'const value = 1;',
        '```',
      ].join('\n')
    );

    expect(result).toBe(
      [
        'Daily Brief',
        '',
        '• BBC',
        '• OpenAI (https://openai.com)',
        '',
        'Site | Status',
        'BBC | Live',
        '',
        'done',
        '',
        'Code (ts):',
        'const value = 1;',
      ].join('\n')
    );
  });
});
