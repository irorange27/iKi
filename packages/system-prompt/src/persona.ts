import fs from 'node:fs';
import path from 'node:path';
import { getUserDataPath } from '@iki/core/platform';

export const PERSONA_FILENAME = 'PERSONA.md';
const DEFAULT_PERSONA_PLACEHOLDER = 'You are iKi.';

const stripHtmlComments = (value: string): string => value.replace(/<!--[\s\S]*?-->/g, '');

export const readPersonaMarkdown = (homeDir = getUserDataPath()): string => {
  const file = path.join(homeDir, PERSONA_FILENAME);
  try {
    if (!fs.existsSync(file)) return DEFAULT_PERSONA_PLACEHOLDER;
    const raw = fs.readFileSync(file, 'utf8');
    return stripHtmlComments(raw).trim();
  } catch {
    return DEFAULT_PERSONA_PLACEHOLDER;
  }
};

export const getPersonaPrompt = (options?: { homeDir?: string }): string => {
  const platform = process.platform;
  const osName = platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'Linux';

  const parts: string[] = [];
  const customPersona = readPersonaMarkdown(options?.homeDir);
  if (customPersona) {
    parts.push(customPersona);
  }
  // Keep the leading persona prompt invariant across days so provider KV cache holds.
  parts.push(`Running on ${osName}.`);
  return parts.join('\n\n');
};

export const getRuntimeReminderText = (options?: {
  now?: Date;
  workspaceText?: string;
}): string => {
  const now = options?.now ?? new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [
    `Current date: ${date} (timezone: ${timezone}).`,
    options?.workspaceText?.trim() ?? '',
  ]
    .filter(Boolean)
    .join('\n\n');
};
