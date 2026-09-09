import { z } from 'zod';

import * as chatMessageDb from '../db/chat_message';
import * as chatThreadDb from '../db/chat_thread';
import { extractTextFromMessageParts, isObjectRecord } from './message_parts';

/**
 * Content-level thread search (Codex-style ⌘K search): scans the persisted
 * message JSON for the query and returns per-thread best matches with a
 * plain-text snippet. Title matching stays a renderer concern.
 */

export type ThreadContentMatch = {
  threadId: string;
  threadTitle: string;
  messageId: string;
  /** Matched message role for context ('user' | 'assistant'). */
  role: string;
  snippet: string;
  updatedAt: string;
};

const SNIPPET_CONTEXT = 48;
const SNIPPET_MAX = 180;

export const threadContentSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(200),
  limit: z.number().int().positive().max(50).optional(),
});

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

/** Extract searchable plain text from a persisted message row. */
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

  // JSON LIKE prefilter narrows the scan; exact per-message matching happens
  // on the extracted plain text so markup never surfaces in snippets.
  const like = `%${query.replace(/[%_]/g, ch => `\\${ch}`)}%`;
  const rows = chatMessageDb
    .searchMessageRows(like, limit * 4)
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
