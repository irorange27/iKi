import type { ComposerInvocationToken } from './message_parts';
import type { PromptApp } from '../types/chat';
import type { SkillSummary } from '../types/skill';

export type PromptAppSlashCommand = {
  id: string;
  name: string;
  description?: string;
  shortcut: string;
  promptTemplate: string;
};

export type SkillSlashCommand = {
  id: `skill:${string}`;
  name: string;
  description: string;
  shortcut: string;
  path?: string;
  skillId: string;
};

export type ParsedSlashCommandDraft = {
  leadingWhitespace: string;
  rawToken: string;
  query: string;
  argumentSeparator: string;
  argumentText: string;
  hasArgumentSeparator: boolean;
};

export type ResolvedPromptAppSlashCommand = {
  command: PromptAppSlashCommand;
  content: string;
  argumentText: string;
};

export type ResolvedSkillSlashCommand = {
  command: SkillSlashCommand;
  argumentText: string;
};

const INPUT_PLACEHOLDER_PATTERN = /\{\{\s*input\s*\}\}/gi;

export const normalizeSlashCommandShortcut = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const withoutLeadingSlash = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  if (!withoutLeadingSlash || /[/\s]/.test(withoutLeadingSlash)) {
    return null;
  }

  return withoutLeadingSlash.toLowerCase();
};

export const parseIncognitoArgument = (value: string): boolean | 'toggle' | null => {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'toggle') return 'toggle';
  if (['on', 'enable', 'enabled', 'true', '1'].includes(normalized)) return true;
  if (['off', 'disable', 'disabled', 'false', '0'].includes(normalized)) return false;
  return null;
};

export const extractPromptAppSlashCommands = (
  promptApps: readonly PromptApp[]
): PromptAppSlashCommand[] => {
  const commands: PromptAppSlashCommand[] = [];
  const seenShortcuts = new Set<string>();

  for (const promptApp of promptApps) {
    if (!promptApp || promptApp.enabled === 0) continue;

    const shortcut = normalizeSlashCommandShortcut(promptApp.shortcut);
    if (!shortcut || seenShortcuts.has(shortcut)) continue;

    const promptTemplate =
      typeof promptApp.prompt_template === 'string' ? promptApp.prompt_template.trim() : '';
    if (!promptTemplate) continue;

    commands.push({
      id: promptApp.id,
      name: promptApp.name,
      description: promptApp.description,
      shortcut,
      promptTemplate,
    });
    seenShortcuts.add(shortcut);
  }

  return commands;
};

export const extractSkillSlashCommands = (skills: readonly SkillSummary[]): SkillSlashCommand[] => {
  const commands: SkillSlashCommand[] = [];
  const seenShortcuts = new Set<string>();

  for (const skill of skills) {
    if (!skill || typeof skill.id !== 'string' || typeof skill.name !== 'string') continue;

    const nameShortcut = normalizeSlashCommandShortcut(skill.name);
    const pathSegment = skill.id.split(':').at(-1) ?? skill.id;
    const normalizedSegment = pathSegment
      .split('/')
      .filter(Boolean)
      .at(-1)
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_ ]+/g, '')
      .replace(/\s+/g, '-');
    const shortcut = nameShortcut || normalizeSlashCommandShortcut(normalizedSegment);

    if (!shortcut || seenShortcuts.has(shortcut)) continue;

    commands.push({
      id: `skill:${skill.id}`,
      name: skill.name,
      description: skill.description,
      shortcut,
      path: skill.path,
      skillId: skill.id,
    });
    seenShortcuts.add(shortcut);
  }

  return commands;
};

export const toPromptAppComposerInvocationToken = (
  command: PromptAppSlashCommand
): ComposerInvocationToken => ({
  id: command.id,
  kind: 'prompt-app',
  prefix: '',
  label: command.shortcut,
  title: command.description || command.name,
});

export const toSkillComposerInvocationToken = (
  command: SkillSlashCommand
): ComposerInvocationToken => ({
  id: command.id,
  kind: 'skill',
  prefix: '$',
  label: command.name,
  title: command.description || command.path || command.name,
});

export const parseSlashCommandDraft = (draft: string): ParsedSlashCommandDraft | null => {
  if (typeof draft !== 'string') return null;

  const leadingWhitespace = draft.match(/^\s*/)?.[0] ?? '';
  const withoutLeadingWhitespace = draft.slice(leadingWhitespace.length);
  if (!withoutLeadingWhitespace.startsWith('/')) return null;

  const afterSlash = withoutLeadingWhitespace.slice(1);
  if (!afterSlash) {
    return {
      leadingWhitespace,
      rawToken: '',
      query: '',
      argumentSeparator: '',
      argumentText: '',
      hasArgumentSeparator: false,
    };
  }

  const separatorIndex = afterSlash.search(/\s/);
  if (separatorIndex === -1) {
    const query = normalizeSlashCommandShortcut(afterSlash);
    if (!query) return null;

    return {
      leadingWhitespace,
      rawToken: afterSlash,
      query,
      argumentSeparator: '',
      argumentText: '',
      hasArgumentSeparator: false,
    };
  }

  if (separatorIndex === 0) {
    return {
      leadingWhitespace,
      rawToken: '',
      query: '',
      argumentSeparator: afterSlash,
      argumentText: '',
      hasArgumentSeparator: true,
    };
  }

  const rawToken = afterSlash.slice(0, separatorIndex);
  const query = normalizeSlashCommandShortcut(rawToken);
  if (!query) return null;

  const argumentSeparator = afterSlash.slice(separatorIndex);

  return {
    leadingWhitespace,
    rawToken,
    query,
    argumentSeparator,
    argumentText: argumentSeparator.replace(/^\s+/, ''),
    hasArgumentSeparator: argumentSeparator.length > 0,
  };
};

export const filterPromptAppSlashCommands = <
  T extends {
    shortcut: string;
    name: string;
  },
>(
  commands: readonly T[],
  query: string
): T[] => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [...commands];

  return commands.filter(command => {
    const normalizedName = command.name.trim().toLowerCase();
    return (
      command.shortcut.startsWith(normalizedQuery) ||
      normalizedName.startsWith(normalizedQuery) ||
      normalizedName.includes(normalizedQuery)
    );
  });
};

export const applyPromptAppSlashCommandTemplate = (
  promptTemplate: string,
  argumentText: string
): string => {
  const normalizedTemplate = promptTemplate.trim();
  const normalizedArguments = argumentText.trimEnd();

  if (/\{\{\s*input\s*\}\}/i.test(normalizedTemplate)) {
    return normalizedTemplate.replace(INPUT_PLACEHOLDER_PATTERN, normalizedArguments).trim();
  }

  if (!normalizedArguments) {
    return normalizedTemplate;
  }

  if (!normalizedTemplate) {
    return normalizedArguments;
  }

  return `${normalizedTemplate}\n\n${normalizedArguments}`.trim();
};

export const resolvePromptAppSlashCommand = (
  draft: string,
  commands: readonly PromptAppSlashCommand[]
): ResolvedPromptAppSlashCommand | null => {
  const parsed = parseSlashCommandDraft(draft);
  if (!parsed || !parsed.query) return null;

  const command = commands.find(candidate => candidate.shortcut === parsed.query);
  if (!command) return null;

  return {
    command,
    content: applyPromptAppSlashCommandTemplate(command.promptTemplate, parsed.argumentText),
    argumentText: parsed.argumentText,
  };
};

export const resolveSkillSlashCommand = (
  draft: string,
  commands: readonly SkillSlashCommand[]
): ResolvedSkillSlashCommand | null => {
  const parsed = parseSlashCommandDraft(draft);
  if (!parsed || !parsed.query) return null;

  const command = commands.find(candidate => candidate.shortcut === parsed.query);
  if (!command) return null;

  return {
    command,
    argumentText: parsed.argumentText,
  };
};

export const applySlashCommandSelection = (
  draft: string,
  command: {
    shortcut: string;
  }
): string => {
  const parsed = parseSlashCommandDraft(draft);
  const leadingWhitespace = parsed?.leadingWhitespace ?? '';
  const suffix = parsed && parsed.hasArgumentSeparator ? parsed.argumentSeparator : ' ';

  return `${leadingWhitespace}/${command.shortcut}${suffix}`;
};
