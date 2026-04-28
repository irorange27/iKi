/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it } from 'vitest';

import {
  applyPromptAppSlashCommandTemplate,
  applySlashCommandSelection,
  extractSkillSlashCommands,
  parseIncognitoArgument,
  extractPromptAppSlashCommands,
  parseSlashCommandDraft,
} from '../../../src/shared/chat/slash_commands';
import type { PromptApp } from '../../../src/shared/types/chat';
import type { SkillSummary } from '../../../src/shared/types/skill';

const buildPromptApp = (
  overrides: Partial<PromptApp> & Pick<PromptApp, 'id' | 'name' | 'prompt_template'>
): PromptApp => ({
  id: overrides.id,
  name: overrides.name,
  description: overrides.description,
  icon: overrides.icon,
  prompt_template: overrides.prompt_template,
  placeholders: overrides.placeholders ?? '[]',
  model: overrides.model,
  enabled: overrides.enabled ?? 1,
  sort_order: overrides.sort_order ?? 0,
  created_at: overrides.created_at ?? '2026-04-20T00:00:00.000Z',
  updated_at: overrides.updated_at ?? '2026-04-20T00:00:00.000Z',
  tools: overrides.tools,
  reasoning_effort: overrides.reasoning_effort,
  expects_image_result: overrides.expects_image_result ?? 0,
  is_incognito: overrides.is_incognito ?? 0,
  shortcut: overrides.shortcut,
  window_width: overrides.window_width,
  window_height: overrides.window_height,
  font_size: overrides.font_size,
});

describe('slash_commands', () => {
  it('extracts unique prompt-app slash commands from enabled prompt apps', () => {
    const commands = extractPromptAppSlashCommands([
      buildPromptApp({
        id: 'prompt_1',
        name: 'Summarize',
        shortcut: '/summarize',
        prompt_template: 'Summarize {{input}}',
      }),
      buildPromptApp({
        id: 'prompt_2',
        name: 'Duplicate',
        shortcut: 'summarize',
        prompt_template: 'Duplicate {{input}}',
      }),
      buildPromptApp({
        id: 'prompt_3',
        name: 'Disabled',
        shortcut: 'rewrite',
        prompt_template: 'Rewrite {{input}}',
        enabled: 0,
      }),
    ]);

    expect(commands).toEqual([
      {
        id: 'prompt_1',
        name: 'Summarize',
        description: undefined,
        shortcut: 'summarize',
        promptTemplate: 'Summarize {{input}}',
      },
    ]);
  });

  it('extracts unique skill slash commands from skill summaries', () => {
    const commands = extractSkillSlashCommands([
      {
        id: 'codex:frontend-dev',
        name: 'frontend-dev',
        description: 'Frontend work',
        source: 'codex',
        path: '/skills/frontend-dev/SKILL.md',
      },
      {
        id: 'user:frontend-dev',
        name: 'frontend-dev',
        description: 'Duplicate shortcut',
        source: 'user',
        path: '/skills/user-frontend/SKILL.md',
      },
      {
        id: 'codex:path/only',
        name: '%%%invalid%%%',
        description: 'Uses path fallback',
        source: 'codex',
        path: '/skills/path-only/SKILL.md',
      },
    ] satisfies SkillSummary[]);

    expect(commands).toEqual([
      {
        id: 'skill:codex:frontend-dev',
        name: 'frontend-dev',
        description: 'Frontend work',
        shortcut: 'frontend-dev',
        path: '/skills/frontend-dev/SKILL.md',
        skillId: 'codex:frontend-dev',
      },
      {
        id: 'skill:codex:path/only',
        name: '%%%invalid%%%',
        description: 'Uses path fallback',
        shortcut: '%%%invalid%%%',
        path: '/skills/path-only/SKILL.md',
        skillId: 'codex:path/only',
      },
    ]);
  });

  it('parses leading slash-command drafts while ignoring path-like input', () => {
    expect(parseSlashCommandDraft('/summarize release notes')).toEqual({
      leadingWhitespace: '',
      rawToken: 'summarize',
      query: 'summarize',
      argumentSeparator: ' release notes',
      argumentText: 'release notes',
      hasArgumentSeparator: true,
      subcommand: 'release',
    });

    expect(parseSlashCommandDraft('/Users/nina/project')).toBeNull();
    expect(parseSlashCommandDraft('Need /summarize help')).toBeNull();
  });

  it('extracts subcommand from slash command arguments', () => {
    expect(parseSlashCommandDraft('/incognito on')!.subcommand).toBe('on');
    expect(parseSlashCommandDraft('/incognito off')!.subcommand).toBe('off');
    expect(parseSlashCommandDraft('/summarize')!.subcommand).toBeNull();
    expect(parseSlashCommandDraft('/new ')!.subcommand).toBeNull();
  });

  it('applies prompt templates with and without an explicit {{input}} placeholder', () => {
    expect(
      applyPromptAppSlashCommandTemplate('Summarize the following:\n{{input}}', 'Release notes')
    ).toBe('Summarize the following:\nRelease notes');

    expect(applyPromptAppSlashCommandTemplate('Translate to Chinese', 'Hello world')).toBe(
      'Translate to Chinese\n\nHello world'
    );
  });

  it('parses incognito slash arguments consistently', () => {
    expect(parseIncognitoArgument('')).toBe('toggle');
    expect(parseIncognitoArgument('toggle')).toBe('toggle');
    expect(parseIncognitoArgument('on')).toBe(true);
    expect(parseIncognitoArgument('off')).toBe(false);
    expect(parseIncognitoArgument('maybe')).toBeNull();
  });

  it('replaces the current slash token with the canonical command while preserving arguments', () => {
    const [command] = extractPromptAppSlashCommands([
      buildPromptApp({
        id: 'prompt_1',
        name: 'Summarize',
        shortcut: 'summarize',
        prompt_template: 'Summarize {{input}}',
      }),
    ]);

    expect(applySlashCommandSelection('/sum', command)).toBe('/summarize ');
    expect(applySlashCommandSelection('/sum release notes', command)).toBe(
      '/summarize release notes'
    );
  });
});
