import { describe, expect, it } from 'vitest';

import {
  DeleteTodoListInputSchema,
  DeleteFileInputSchema,
  FetchToolInputSchema,
  ListTodoListsInputSchema,
  ListDirInputSchema,
  ReadTodoListInputSchema,
  ReadFileInputSchema,
  ShellToolInputSchema,
  WebToolInputSchema,
  WriteTodoListInputSchema,
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

    expect(
      ListTodoListsInputSchema.parse({
        query: 'today',
        description: 'Find the right persistent checklist.',
      }).description
    ).toBe('Find the right persistent checklist.');

    expect(
      ReadTodoListInputSchema.parse({
        title: 'Today',
        description: 'Inspect the existing todo list before editing it.',
      }).description
    ).toBe('Inspect the existing todo list before editing it.');

    expect(
      WriteTodoListInputSchema.parse({
        title: 'Today',
        items: [{ content: 'Ship feature' }],
        description: 'Persist the new checklist for later use.',
      }).description
    ).toBe('Persist the new checklist for later use.');

    expect(
      DeleteTodoListInputSchema.parse({
        title: 'Old List',
        description: 'Remove a stale checklist the user no longer wants.',
      }).description
    ).toBe('Remove a stale checklist the user no longer wants.');
  });
});
