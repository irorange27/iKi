import { describe, expect, it } from 'vitest';

import {
  DeleteFileInputSchema,
  FetchToolInputSchema,
  ListDirInputSchema,
  ReadFileInputSchema,
  ShellToolInputSchema,
  WebToolInputSchema,
  WriteFileInputSchema,
} from '../../../src/core/tools/schemas';

describe('tool input schemas', () => {
  it('preserves tool-call description across built-in tools', () => {
    expect(
      WebToolInputSchema.parse({
        query: 'latest news',
        description: 'Search for current updates.',
      }).description
    ).toBe('Search for current updates.');

    expect(
      FetchToolInputSchema.parse({
        url: 'https://example.com',
        description: 'Fetch page details for summarization.',
      }).description
    ).toBe('Fetch page details for summarization.');

    expect(
      ShellToolInputSchema.parse({
        command: 'pwd',
        description: 'Check current working directory.',
      }).description
    ).toBe('Check current working directory.');

    expect(
      ReadFileInputSchema.parse({
        path: 'README.md',
        description: 'Read project overview.',
      }).description
    ).toBe('Read project overview.');

    expect(
      WriteFileInputSchema.parse({
        path: 'notes.txt',
        content: 'hello',
        description: 'Write generated notes to disk.',
      }).description
    ).toBe('Write generated notes to disk.');

    expect(
      ListDirInputSchema.parse({
        path: '.',
        description: 'Inspect directory contents.',
      }).description
    ).toBe('Inspect directory contents.');

    expect(
      DeleteFileInputSchema.parse({
        path: 'tmp.txt',
        description: 'Remove temporary artifact file.',
      }).description
    ).toBe('Remove temporary artifact file.');
  });
});
