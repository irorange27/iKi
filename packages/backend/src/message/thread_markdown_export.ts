import { extractTextFromMessageParts, isObjectRecord } from './message_parts';

type ThreadMarkdownExportMessage = {
  role: string;
  parts: unknown;
  createdAt?: string;
};

type ThreadMarkdownExportInput = {
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
