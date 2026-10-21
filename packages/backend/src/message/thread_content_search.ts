import { getSessionEvents } from '../db/session_events';
import { getChatThreads } from '../db/chat_thread';
import * as chatThreadDb from '../db/chat_thread';
import { extractTextFromMessageParts, isObjectRecord } from './message_parts';

export type ThreadContentMatch = {
  threadId: string;
  threadTitle: string;
  messageId: string;

  role: string;
  snippet: string;
  updatedAt: string;
};

const SNIPPET_CONTEXT = 48;
const SNIPPET_MAX = 180;

const buildSnippet = (text: string, query: string): string => {
  const lowered = text.toLowerCase();
  const at = lowered.indexOf(query.toLowerCase());
  if (at < 0) return text.slice(0, SNIPPET_MAX) + (text.length > SNIPPET_MAX ? '…' : '');
  const start = Math.max(0, at - SNIPPET_CONTEXT);
  const end = Math.min(text.length, at + query.length + SNIPPET_CONTEXT * 2);
  return (
    (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '')
  );
};

const messageSearchableText = (messageJson: string): { role: string; text: string } | null => {
  try {
    const parsed: unknown = JSON.parse(messageJson);
    if (!isObjectRecord(parsed) || typeof parsed.role !== 'string') return null;
    const text = extractTextFromMessageParts(parsed.parts).replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return { role: parsed.role, text };
  } catch {
    return null;
  }
};

export const searchThreadContent = (rawQuery: string, limit = 12): ThreadContentMatch[] => {
  const query = rawQuery.trim();
  if (!query) return [];

  const like = `%${query.replace(/[%_]/g, ch => `\\${ch}`)}%`;

  const rows = getChatThreads()
    .flatMap(thread =>
      getSessionEvents(thread.id, ['input_accepted', 'model_output_committed'])
        .filter(event => JSON.stringify(event.payload).includes(query))
        .map(event => {
          const message = (event.payload as { message?: { id?: unknown } }).message;
          return {
            id: typeof message?.id === 'string' ? message.id : '',
            thread_id: thread.id,
            message: JSON.stringify(message ?? {}),
            updated_at: event.createdAt,
          };
        })
    )
    .slice(0, limit * 4)
    .map(row => {
      const parsed = messageSearchableText(row.message);
      return parsed ? { row, parsed } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> =>
      Boolean(entry && entry.parsed.text.toLowerCase().includes(query.toLowerCase()))
    );

  const seen = new Set<string>();
  const matches: ThreadContentMatch[] = [];
  for (const { row, parsed } of rows) {
    if (seen.has(row.thread_id)) continue;
    seen.add(row.thread_id);

    const thread = chatThreadDb.getChatThread(row.thread_id);
    matches.push({
      threadId: row.thread_id,
      threadTitle: thread?.title || row.thread_id,
      messageId: row.id,
      role: parsed.role,
      snippet: buildSnippet(parsed.text, query),
      updatedAt: row.updated_at,
    });
    if (matches.length >= limit) break;
  }
  return matches;
};
