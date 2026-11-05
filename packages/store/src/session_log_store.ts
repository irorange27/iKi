/**
 * A pluggable append-only log for one conversation.
 *
 * Why this exists: every read of the session log is "give me the whole stream for
 * one thread, in order", and every write is "append these facts". There are no
 * cross-thread content queries, no joins and no content indexes. That is the shape
 * of a file, not a query engine. pi (earendil-works/pi) stores its interactive
 * sessions as one JSONL file per session, loaded whole at open
 * (coding-agent/src/core/session-manager.ts), and ships a JsonlStorage backend
 * against the same Storage contract as a SQL backend.
 *
 * This is the only storage backend for the session log: the SQL implementation and
 * its migrations were deleted with the rest of the prototype's database layer.
 */

import fs from 'node:fs';
import path from 'node:path';

export type StoredSessionEvent = {
  revision: number;
  type: string;
  version: number;
  payload: unknown;
  createdAt: string;
};

export type NewSessionEvent = {
  type: string;
  version: number;
  payload: unknown;
};

export type SessionEventMatch = { path: string; value: string };

/** Read a `$.a.b` path out of a payload (the only shape callers use). */
export const payloadValueAt = (payload: unknown, query: string): unknown => {
  let current: unknown = payload;
  for (const key of query.replace(/^\$\.?/, '').split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
};

/**
 * The whole contract. Five operations, all scoped to a thread except findMessage
 * (which exists for resume-by-id and, like pi's session picker, is a file scan).
 * `append` returns null when the caller's expected revision lost a race — the same
 * optimistic-concurrency rule the caller relies on (a stale writer is refused).
 */
export interface SessionLogStore {
  append(threadId: string, expectedRevision: number | null, events: NewSessionEvent[]): number | null;
  readThread(threadId: string, types?: readonly string[], match?: SessionEventMatch): StoredSessionEvent[];
  headRevision(threadId: string): number;
  deleteThread(threadId: string): void;
  findMessage(messageId: string, threadId?: string): { threadId: string; payload: unknown } | null;
}

const HEADER_VERSION = 1;

type HeaderLine = { kind: 'header'; version: number; threadId: string };

/**
 * One line = one append call = one atomic commit. The whole batch is a single JSON
 * line, so a crash
 * mid-write leaves one torn line that is discarded whole — the batch either landed
 * completely or not at all, never half of it.
 */
type BatchLine = {
  kind: 'batch';
  firstRevision: number;
  events: Array<{ type: string; version: number; payload: unknown; createdAt: string }>;
};

type JsonlLine = HeaderLine | BatchLine;

const fileFor = (rootDir: string, threadId: string): string =>
  path.join(rootDir, `${encodeURIComponent(threadId)}.jsonl`);

/**
 * Drop a torn final line before the next append. A crash can leave a partial line
 * with no trailing newline; appending straight after it would glue the new event
 * onto the broken text and lose both. Truncating to the last complete line is the
 * write-side half of torn-line repair (the read side tolerates it too).
 */
const repairTornTail = (file: string): void => {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (!text || text.endsWith('\n')) return;
  const lastNewline = text.lastIndexOf('\n');
  fs.truncateSync(file, lastNewline + 1);
};

/**
 * Parse a file, tolerating a torn tail. A crash mid-append leaves at most one
 * incomplete final line; every earlier line is a committed fact and stays. This is
 * pi's "torn-line repair" (durable/docs/spec.md:5177-5185) in its simplest form.
 */
const readEvents = (file: string): StoredSessionEvent[] => {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const out: StoredSessionEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let parsed: JsonlLine;
    try {
      parsed = JSON.parse(line) as JsonlLine;
    } catch {
      // Torn tail: stop here. Every earlier line is a complete, committed batch.
      break;
    }
    if (parsed.kind === 'header') {
      if (parsed.version !== HEADER_VERSION) {
        throw new Error(`Unsupported session log version ${parsed.version} in ${file}`);
      }
      continue;
    }
    for (const [index, event] of parsed.events.entries()) {
      out.push({ revision: parsed.firstRevision + index, ...event });
    }
  }
  return out;
};

const isMessageEvent = (type: string): boolean =>
  type === 'input_accepted' || type === 'model_output_committed';

const messageIdOf = (payload: unknown): string | undefined => {
  const direct = payloadValueAt(payload, '$.messageId');
  if (typeof direct === 'string') return direct;
  const nested = payloadValueAt(payload, '$.message.id');
  return typeof nested === 'string' ? nested : undefined;
};

/** One JSONL file per thread, appended synchronously. Single-process by contract. */
export const createJsonlSessionLogStore = (rootDir: string): SessionLogStore => {
  fs.mkdirSync(rootDir, { recursive: true });

  const eventsOf = (threadId: string): StoredSessionEvent[] =>
    readEvents(fileFor(rootDir, threadId));

  const headRevision = (threadId: string): number => {
    const events = eventsOf(threadId);
    return events.length > 0 ? events[events.length - 1]!.revision : 0;
  };

  const ensureHeader = (threadId: string, file: string): void => {
    if (fs.existsSync(file)) return;
    const header: JsonlLine = { kind: 'header', version: HEADER_VERSION, threadId };
    fs.appendFileSync(file, `${JSON.stringify(header)}\n`);
  };

  return {
    append(threadId, expectedRevision, events) {
      if (events.length === 0) return headRevision(threadId);
      const file = fileFor(rootDir, threadId);
      const current = headRevision(threadId);
      if (expectedRevision !== null && current !== expectedRevision) return null;

      fs.mkdirSync(path.dirname(file), { recursive: true });
      ensureHeader(threadId, file);
      repairTornTail(file);
      const now = new Date().toISOString();
      const batch: BatchLine = {
        kind: 'batch',
        firstRevision: current + 1,
        events: events.map(event => ({ ...event, createdAt: now })),
      };
      fs.appendFileSync(file, `${JSON.stringify(batch)}\n`);
      return current + events.length;
    },

    readThread(threadId, types, match) {
      const typeSet = types?.length ? new Set(types) : null;
      return eventsOf(threadId).filter(event => {
        if (typeSet && !typeSet.has(event.type)) return false;
        if (match && payloadValueAt(event.payload, match.path) !== match.value) return false;
        return true;
      });
    },

    headRevision,

    deleteThread(threadId) {
      try {
        fs.unlinkSync(fileFor(rootDir, threadId));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    },

    findMessage(messageId, threadId) {
      const needle = messageId.trim();
      if (!needle) return null;
      const files = threadId
        ? [fileFor(rootDir, threadId)]
        : fs
            .readdirSync(rootDir)
            .filter(name => name.endsWith('.jsonl'))
            .map(name => path.join(rootDir, name));
      let best: { revision: number; threadId: string; payload: unknown } | null = null;
      for (const file of files) {
        const owner = decodeURIComponent(path.basename(file, '.jsonl'));
        for (const line of readEvents(file)) {
          if (!isMessageEvent(line.type)) continue;
          if (messageIdOf(line.payload) !== needle) continue;
          if (!best || line.revision >= best.revision) {
            best = { revision: line.revision, threadId: owner, payload: line.payload };
          }
        }
      }
      return best ? { threadId: best.threadId, payload: best.payload } : null;
    },
  };
};
