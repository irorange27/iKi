import { getSessionEvents } from '@iki/session/session_events';
import * as chatThreadDb from '@iki/store/chat_thread';
import type { ThreadContentMatch } from '@iki/core/types/chat';
import { INPUT_ACCEPTED, MODEL_OUTPUT_COMMITTED } from '@iki/core/types/session_events';
import { extractTextFromMessageParts, isObjectRecord } from '@iki/llm/message/message_parts';

const MESSAGE_EVENT_TYPES_FOR_SEARCH = [INPUT_ACCEPTED, MODEL_OUTPUT_COMMITTED];

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

const messageSearchableText = (message: unknown): { role: string; text: string } | null => {
  if (!isObjectRecord(message) || typeof message.role !== 'string') return null;
  const text = extractTextFromMessageParts(message.parts).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return { role: message.role, text };
};

type SearchRow = { threadId: string; messageId: string; updatedAt: string };

export const searchThreadContent = (rawQuery: string, limit = 12): ThreadContentMatch[] => {
  const query = rawQuery.trim();
  if (!query) return [];
  const lowered = query.toLowerCase();

  // Match the text the user can actually see. Scanning the serialized payload
  // instead would hit message ids, roles, tool arguments and run ids, and would
  // re-parse every message event of every thread on every keystroke.
  const candidates: { row: SearchRow; parsed: { role: string; text: string } }[] = [];
  for (const thread of chatThreadDb.getChatThreads()) {
    for (const event of getSessionEvents(thread.id, MESSAGE_EVENT_TYPES_FOR_SEARCH)) {
      const payload = event.payload as { message?: { id?: unknown } };
      const parsed = messageSearchableText(payload.message);
      if (!parsed || !parsed.text.toLowerCase().includes(lowered)) continue;
      candidates.push({
        row: {
          threadId: thread.id,
          messageId: typeof payload.message?.id === 'string' ? payload.message.id : '',
          updatedAt: event.createdAt,
        },
        parsed,
      });
      if (candidates.length >= limit * 4) break;
    }
    if (candidates.length >= limit * 4) break;
  }

  const seen = new Set<string>();
  const matches: ThreadContentMatch[] = [];
  for (const { row, parsed } of candidates) {
    if (seen.has(row.threadId)) continue;
    seen.add(row.threadId);

    const thread = chatThreadDb.getChatThread(row.threadId);
    matches.push({
      threadId: row.threadId,
      threadTitle: thread?.title || row.threadId,
      messageId: row.messageId,
      role: parsed.role,
      snippet: buildSnippet(parsed.text, query),
      updatedAt: row.updatedAt,
    });
    if (matches.length >= limit) break;
  }
  return matches;
};
