import { describe, expect, it } from 'vitest';

import {
  AgentToolInputSchema,
  DeletePersonalSkillInputSchema,
  TodoToolInputSchema,
  DeleteTodoListInputSchema,
  DeleteFileInputSchema,
  EditFileInputSchema,
  FetchToolInputSchema,
  ListPersonalSkillsInputSchema,
  ListTodoListsInputSchema,
  ListDirInputSchema,
  ReadPersonalSkillInputSchema,
  ReadTodoListInputSchema,
  ReadFileInputSchema,
  ShellToolInputSchema,
  WebToolInputSchema,
  WritePersonalSkillInputSchema,
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
      EditFileInputSchema.parse({
        path: 'notes.txt',
        edits: [{ oldText: 'hello', newText: 'hi' }],
        description: 'Patch the existing file without rewriting everything.',
      }).description
    ).toBe('Patch the existing file without rewriting everything.');

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
      ListPersonalSkillsInputSchema.parse({
        query: 'planner',
        description: 'Find the personal skill to update.',
      }).description
    ).toBe('Find the personal skill to update.');

    expect(
      ReadPersonalSkillInputSchema.parse({
        id: 'user:planner',
        description: 'Inspect the current personal skill before editing it.',
      }).description
    ).toBe('Inspect the current personal skill before editing it.');

    expect(
      WritePersonalSkillInputSchema.parse({
        id: 'user:planner',
        instructions: '# Planner\n\nStep 1.',
        description: 'Write the revised personal skill definition.',
      }).description
    ).toBe('Write the revised personal skill definition.');

    expect(
      DeletePersonalSkillInputSchema.parse({
        id: 'user:old-skill',
        description: 'Remove a stale personal skill the user no longer wants.',
      }).description
    ).toBe('Remove a stale personal skill the user no longer wants.');

    expect(
      TodoToolInputSchema.parse({
        items: [{ id: '1', text: 'Inspect current code', status: 'in_progress' }],
        description: 'Track the multi-step execution plan.',
      }).description
    ).toBe('Track the multi-step execution plan.');

    expect(
      AgentToolInputSchema.parse({
        task: 'Inspect the repo and summarize the module boundaries.',
        description: 'Delegate focused architecture inspection to a subagent.',
      }).description
    ).toBe('Delegate focused architecture inspection to a subagent.');

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

  it('caps execution todo plans at five broad steps', () => {
    expect(() =>
      TodoToolInputSchema.parse({
        items: Array.from({ length: 6 }, (_value, index) => ({
          id: String(index + 1),
          text: `Task ${index + 1}`,
        })),
        description: 'Track an overlong execution plan.',
      })
    ).toThrow(/<=5 items/i);
  });
});
