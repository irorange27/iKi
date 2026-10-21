import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  AgentToolInputSchema,
  DeleteFileInputSchema,
  EditFileInputSchema,
  FetchToolInputSchema,
  ListDirInputSchema,
  ReadFileInputSchema,
  ShellToolInputSchema,
  WebToolInputSchema,
  WriteFileInputSchema,
  DeleteAwaiterInputSchema,
  DeletePersonalSkillInputSchema,
  DeleteProactiveTaskInputSchema,
  ListAwaitersInputSchema,
  ListPersonalSkillsInputSchema,
  ListProactiveTasksInputSchema,
  ReadAwaiterInputSchema,
  ReadPersonalSkillInputSchema,
  ReadProactiveTaskInputSchema,
  WriteAwaiterInputSchema,
  WritePersonalSkillInputSchema,
  WriteProactiveTaskInputSchema,
} from '@iki/backend/tools/schemas';

describe('tool input schemas', () => {
  it('keeps tool schemas browser-safe for renderer payload parsing', () => {
    const schemasDir = new URL('../../../packages/backend/src/tools/schemas/', import.meta.url);
    const files = [
      '../tools/schemas.ts',
      ...readdirSync(schemasDir)
        .filter(file => file.endsWith('.ts'))
        .map(file => `schemas/${file}`),
    ];
    const importSpecifiers = files.flatMap(file =>
      Array.from(
        readFileSync(new URL(`../../../packages/backend/src/tools/${file}`, import.meta.url), 'utf8').matchAll(
          /from ['"]([^'"]+)['"]/g
        ),
        match => match[1]
      )
    );

    expect(importSpecifiers.length).toBeGreaterThan(0);
    expect(
      importSpecifiers.every(
        specifier =>
          specifier === 'zod' ||
          specifier === '@iki/backend/tools/schemas' ||
          specifier.startsWith('./') ||
          specifier.startsWith('../../types/')
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

});
