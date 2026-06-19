import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  AgentToolInputSchema,
  DeleteFileInputSchema,
  EditFileInputSchema,
  FetchToolInputSchema,
  ListDirInputSchema,
  ReadFileInputSchema,
  ShellToolInputSchema,
  TodoToolInputSchema,
  WebToolInputSchema,
  WriteFileInputSchema,
} from '@iki/core/tools/schemas';
import {
  DeleteAwaiterInputSchema,
  DeletePersonalSkillInputSchema,
  DeleteProactiveTaskInputSchema,
  DeleteTodoListInputSchema,
  ListAwaitersInputSchema,
  ListPersonalSkillsInputSchema,
  ListProactiveTasksInputSchema,
  ListTodoListsInputSchema,
  ReadAwaiterInputSchema,
  ReadPersonalSkillInputSchema,
  ReadProactiveTaskInputSchema,
  ReadTodoListInputSchema,
  WriteAwaiterInputSchema,
  WritePersonalSkillInputSchema,
  WriteProactiveTaskInputSchema,
  WriteTodoListInputSchema,
} from '@iki/backend/tools/schemas';

describe('tool input schemas', () => {
  it('keeps tool schemas browser-safe for renderer payload parsing', () => {
    const source = readFileSync(new URL('../../../packages/core/src/tools/schemas.ts', import.meta.url), 'utf8');
    const importSpecifiers = Array.from(source.matchAll(/from ['"]([^'"]+)['"]/g), match => match[1]);

    expect(importSpecifiers.length).toBeGreaterThan(0);
    expect(importSpecifiers.every(specifier => specifier === 'zod' || specifier.startsWith('../'))).toBe(
      true
    );
  });

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
      ListAwaitersInputSchema.parse({
        query: 'draft',
        description: 'Find the deferred continuation for this draft.',
      }).description
    ).toBe('Find the deferred continuation for this draft.');

    expect(
      ReadAwaiterInputSchema.parse({
        title: 'Resume Draft',
        description: 'Inspect the current awaiter before rescheduling it.',
      }).description
    ).toBe('Inspect the current awaiter before rescheduling it.');

    expect(
      WriteAwaiterInputSchema.parse({
        action: 'create',
        title: 'Resume Draft',
        instruction: 'Continue the draft tomorrow morning.',
        trigger: {
          kind: 'time_after',
          delayMinutes: 45,
        },
        description: 'Create a one-shot continue-later wake.',
      }).description
    ).toBe('Create a one-shot continue-later wake.');

    expect(
      DeleteAwaiterInputSchema.parse({
        title: 'Resume Draft',
        description: 'Remove the deferred continuation if it is no longer needed.',
      }).description
    ).toBe('Remove the deferred continuation if it is no longer needed.');

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

    expect(
      ListProactiveTasksInputSchema.parse({
        query: 'gold',
        description: 'Find the recurring market watchers.',
      }).description
    ).toBe('Find the recurring market watchers.');

    expect(
      ReadProactiveTaskInputSchema.parse({
        name: 'Daily Gold',
        description: 'Inspect the current recurring task before updating it.',
      }).description
    ).toBe('Inspect the current recurring task before updating it.');

    expect(
      WriteProactiveTaskInputSchema.parse({
        action: 'create',
        name: 'Daily Gold',
        prompt: 'Summarize the latest gold price in USD.',
        schedule: {
          kind: 'daily',
          time: '09:00',
          timezone: 'Asia/Shanghai',
        },
        description: 'Create the recurring market update task.',
      }).description
    ).toBe('Create the recurring market update task.');

    expect(
      DeleteProactiveTaskInputSchema.parse({
        name: 'Daily Gold',
        description: 'Remove the obsolete recurring task.',
      }).description
    ).toBe('Remove the obsolete recurring task.');
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
