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

  const db = getDb();
  const now = new Date().toISOString();
  const insert = db.prepare(
    'INSERT INTO session_events (thread_id, revision, type, version, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const transaction = db.transaction((): number | null => {
    const current = getSessionEventRevision(threadId);
    if (expectedRevision !== null && current !== expectedRevision) return null;
    let revision = current;
    for (const event of events) {
      revision += 1;
      insert.run(threadId, revision, event.type, event.version, JSON.stringify(event.payload), now);
    }
    return revision;
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
