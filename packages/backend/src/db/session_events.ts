import { getDb } from './database';

/**
 * The Session log's storage: one append-only event stream per conversation
 * (thread). Events are business facts — what was accepted, what was decided,
 * how a turn started and ended — written once with a per-stream revision and
 * never updated. Rebuildable projections (chat history, run audit) derive
 * from this stream; they are not independent authorities.
 *
 * Concurrency: appendSessionEvents checks the stream's current revision
 * against the caller's expectation inside the insert transaction. Two
 * writers basing decisions on the same revision cannot both commit — the
 * loser gets null and must re-read the stream before judging again.
 */

export type StoredSessionEvent = {
  revision: number;
  type: string;
  version: number;
  payload: unknown;
  createdAt: string;
};

type SessionEventRow = {
  revision: number;
  type: string;
  version: number;
  payload: string;
  created_at: string;
};

export const getSessionEvents = (
  threadId: string,
  types?: readonly string[],
  match?: {
    path: string;
    value: string;
  }
): StoredSessionEvent[] => {
  const typeFilter = types?.length ? ` AND type IN (${types.map(() => '?').join(', ')})` : '';
  const payloadFilter = match ? ' AND json_extract(payload, ?) = ?' : '';
  const rows = getDb()
    .prepare(
      `SELECT revision, type, version, payload, created_at FROM session_events WHERE thread_id = ?${typeFilter}${payloadFilter} ORDER BY revision ASC`
    )
    .all(
      threadId,
      ...(types ?? []),
      ...(match ? [match.path, match.value] : [])
    ) as SessionEventRow[];
  return rows.map(row => ({
    revision: row.revision,
    type: row.type,
    version: row.version,
    payload: JSON.parse(row.payload) as unknown,
    createdAt: row.created_at,
  }));
};

/** Remove a thread's stream — conversation deletion must take its log with
 *  it (the table has no FK cascade; payloads are plaintext). */
export const deleteSessionEvents = (threadId: string): void => {
  getDb().prepare('DELETE FROM session_events WHERE thread_id = ?').run(threadId);
};

export const getSessionEventRevision = (threadId: string): number => {
  const row = getDb()
    .prepare('SELECT MAX(revision) AS revision FROM session_events WHERE thread_id = ?')
    .get(threadId) as { revision: number | null };
  return row.revision ?? 0;
};

export type NewSessionEvent = {
  type: string;
  version: number;
  payload: unknown;
};

/**
 * Assign consecutive revisions at the current head and insert. NOT its own
 * transaction: a caller that must land the append together with another write
 * (history truncation deletes rows in the SAME transaction) calls this inside
 * its own `db.transaction(...)` — an append that could commit on its own
 * would let one side of a boundary land without the other. The head read and
 * the inserts run on the caller's connection, so the enclosing transaction is
 * what makes them atomic; BEGIN IMMEDIATE in the wrapper already holds the
 * write lock.
 */
export const insertSessionEventsAtHead = (
  threadId: string,
  events: NewSessionEvent[]
): number => {
  if (events.length === 0) return getSessionEventRevision(threadId);

  const db = getDb();
  const now = new Date().toISOString();
  const insert = db.prepare(
    'INSERT INTO session_events (thread_id, revision, type, version, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );

  let revision = getSessionEventRevision(threadId);
  for (const event of events) {
    revision += 1;
    insert.run(threadId, revision, event.type, event.version, JSON.stringify(event.payload), now);
  }
  return revision;
};

/**
 * Append events to a thread's stream. `expectedRevision` is the revision the
 * caller based its decision on (0 for an empty stream); the write commits
 * only while that still holds, assigning consecutive revisions inside one
 * transaction. Returns the new head revision, or null when another writer
 * moved the stream first — nothing is written on conflict.
 */
const append = (
  threadId: string,
  expectedRevision: number | null,
  events: NewSessionEvent[]
): number | null => {
  if (events.length === 0) return getSessionEventRevision(threadId);

  const transaction = getDb().transaction((): number | null => {
    const current = getSessionEventRevision(threadId);
    if (expectedRevision !== null && current !== expectedRevision) return null;
    return insertSessionEventsAtHead(threadId, events);
  });

  return transaction();
};

export const appendSessionEvents = (
  threadId: string,
  expectedRevision: number,
  events: NewSessionEvent[]
) => append(threadId, expectedRevision, events);

/** Observations already happened: append at the current head atomically.
 * Only decisions derived from a read snapshot need expected-revision CAS. */
export const appendSessionFacts = (threadId: string, events: NewSessionEvent[]): number =>
  append(threadId, null, events)!;

/**
 * Find the newest message fact carrying `messageId`, across every thread.
 *
 * Messages are events (ADR 011), so a lookup by message id is a scan over the
 * two event types that carry one. There is no `(payload->message->id)` index:
 * the column is a JSON TEXT blob and SQLite would need a generated column to
 * index it, which is a schema change this removal does not need yet.
 *
 * The `LIKE` prefilter narrows the scan before any JSON is parsed; it is a
 * superset match (`%id%`), so the caller still confirms the id. Callers that
 * already hold the thread should pass it — the per-thread form uses the
 * `(thread_id, revision)` index and does not scan the whole log.
 */
export const findMessageEvent = (
  messageId: string,
  threadId?: string
): { threadId: string; payload: unknown } | null => {
  const needle = messageId.trim();
  if (!needle) return null;
  const like = `%${needle.replace(/[%_]/g, ch => `\\${ch}`)}%`;
  const sql = threadId
    ? `SELECT thread_id, payload FROM session_events
        WHERE thread_id = ? AND type IN ('input_accepted','model_output_committed')
          AND payload LIKE ? ORDER BY revision DESC LIMIT 20`
    : `SELECT thread_id, payload FROM session_events
        WHERE type IN ('input_accepted','model_output_committed')
          AND payload LIKE ? ORDER BY revision DESC LIMIT 20`;
  const rows = (
    threadId
      ? getDb().prepare(sql).all(threadId, like)
      : getDb().prepare(sql).all(like)
  ) as Array<{ thread_id: string; payload: string }>;

  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload) as { message?: { id?: unknown } };
      if (payload?.message?.id === needle) {
        return { threadId: row.thread_id, payload };
      }
    } catch {
      // A malformed row cannot match; keep scanning rather than failing the
      // caller over one bad record.
    }
  }
  return null;
};

/**
 * The event types that carry a message payload, and the payload schema
 * version they are written with.
 *
 * These are PERSISTED PROTOCOL, not an implementation detail: a value here is
 * written into rows that outlive the code. They live in the db layer because
 * `turn_prep` writes them and may not import `thread_session` (R5); the
 * reducer in `thread_session/session_log.ts` reads the same strings. Changing
 * a value means migrating the stored rows, not editing a constant.
 */
export const MESSAGE_EVENT_TYPES = {
  INPUT_ACCEPTED: 'input_accepted',
  MODEL_OUTPUT_COMMITTED: 'model_output_committed',
} as const;

export const SESSION_EVENT_VERSION = 1;
