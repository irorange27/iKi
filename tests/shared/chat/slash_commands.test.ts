import { describe, expect, it } from 'vitest';

import {
  applyPromptAppSlashCommandTemplate,
  applySlashCommandSelection,
  extractPromptAppSlashCommands,
  parseSlashCommandDraft,
  resolvePromptAppSlashCommand,
} from '../../../src/shared/chat/slash_commands';
import type { PromptApp } from '../../../src/shared/types/chat';

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

  it('parses leading slash-command drafts while ignoring path-like input', () => {
    expect(parseSlashCommandDraft('/summarize release notes')).toEqual({
      leadingWhitespace: '',
      rawToken: 'summarize',
      query: 'summarize',
      argumentSeparator: ' release notes',
      argumentText: 'release notes',
      hasArgumentSeparator: true,
    });

    expect(parseSlashCommandDraft('/Users/nina/project')).toBeNull();
    expect(parseSlashCommandDraft('Need /summarize help')).toBeNull();
  });

  it('applies prompt templates with and without an explicit {{input}} placeholder', () => {
    expect(
      applyPromptAppSlashCommandTemplate('Summarize the following:\n{{input}}', 'Release notes')
    ).toBe('Summarize the following:\nRelease notes');

    expect(applyPromptAppSlashCommandTemplate('Translate to Chinese', 'Hello world')).toBe(
      'Translate to Chinese\n\nHello world'
    );
  });

  it('resolves exact slash commands into prompt-app content', () => {
    const commands = extractPromptAppSlashCommands([
      buildPromptApp({
        id: 'prompt_1',
        name: 'Summarize',
        shortcut: 'summarize',
        prompt_template: 'Summarize carefully:\n{{ input }}',
      }),
    ]);

    expect(resolvePromptAppSlashCommand('/summarize Incident report', commands)).toEqual({
      command: commands[0],
      content: 'Summarize carefully:\nIncident report',
      argumentText: 'Incident report',
    });

    expect(resolvePromptAppSlashCommand('/sum Incident report', commands)).toBeNull();
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
