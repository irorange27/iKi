import { extractTextFromMessageParts, isObjectRecord } from './message_parts';

/**
 * User-readable thread export (Codex-style share/export): the conversation as
 * plain markdown. Tool internals are intentionally omitted — only the visible
 * user/assistant text is exported.
 */

export type ThreadMarkdownExportMessage = {
  role: string;
  parts: unknown;
  createdAt?: string;
};

export type ThreadMarkdownExportInput = {
  title: string;
  model?: string;
  exportedAt: string;
  messages: ThreadMarkdownExportMessage[];
};

const ROLE_LABELS: Record<string, string> = {
  user: 'User',
  assistant: 'Assistant',
};

export const buildThreadMarkdown = (input: ThreadMarkdownExportInput): string => {
  const lines: string[] = [`# ${input.title || 'iKi conversation'}`, ''];
  lines.push(`- Exported: ${input.exportedAt}`);
  if (input.model) lines.push(`- Model: ${input.model}`);
  lines.push('');

  let exportedCount = 0;
  for (const message of input.messages) {
    if (!isObjectRecord(message)) continue;
    const role = typeof message.role === 'string' ? message.role : '';
    const label = ROLE_LABELS[role];
    if (!label) continue;

    const text = extractTextFromMessageParts(message.parts).trim();
    if (!text) continue;

    lines.push('---', '', `## ${label}`, '', text, '');
    exportedCount += 1;
  }

  if (exportedCount === 0) {
    lines.push('---', '', '_This conversation has no exportable messages._', '');
  }

  return lines.join('\n');
};

/** Parse a persisted chat_messages row (`message` JSON column) for export. */
export const parseStoredMessageForExport = (messageJson: unknown): ThreadMarkdownExportMessage | null => {
  if (typeof messageJson !== 'string' || !messageJson.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(messageJson);
    if (!isObjectRecord(parsed) || typeof parsed.role !== 'string') return null;
    return {
      role: parsed.role,
      parts: parsed.parts,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : undefined,
    };
  } catch {
    return null;
  }
};
