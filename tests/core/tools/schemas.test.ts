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
    const source = readFileSync(new URL('../../../packages/backend/src/tools/schemas.ts', import.meta.url), 'utf8');
    const importSpecifiers = Array.from(source.matchAll(/from ['"]([^'"]+)['"]/g), match => match[1]);

    expect(importSpecifiers.length).toBeGreaterThan(0);
    expect(
      importSpecifiers.every(
        specifier =>
          specifier === 'zod' ||
          specifier === '@iki/backend/tools/schemas' ||
          specifier.startsWith('../types/')
      )
    ).toBe(true);
  });

  it('preserves tool-call description across built-in tools', () => {
    expect(
      WebToolInputSchema.parse({
        query: 'latest news',
        description: 'Search for current updates.',
      }).description
    ).toBe('Search for current updates.');
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
