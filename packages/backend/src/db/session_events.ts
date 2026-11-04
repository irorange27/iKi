import { getDb } from './database';
import { INPUT_ACCEPTED, MODEL_OUTPUT_COMMITTED } from '@iki/backend/types/session_events';

const MESSAGE_EVENT_TYPES_SQL = `type IN ('${INPUT_ACCEPTED}','${MODEL_OUTPUT_COMMITTED}')`;

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

/**
 * Append observed facts at the current head. Unlike `appendSessionEvents` there is
 * no expected revision to lose against: an observed fact is recorded whatever else
 * happened to land first, so ordering is the only invariant and it holds.
 */
export const appendSessionFacts = (threadId: string, events: NewSessionEvent[]): number =>
  append(threadId, null, events) ?? getSessionEventRevision(threadId);

export const findMessageEvent = (
  messageId: string,
  threadId?: string
): { threadId: string; payload: unknown } | null => {
  const needle = messageId.trim();
  if (!needle) return null;
  // Ask SQLite for the payload's message id field. Matching the serialized blob
  // with LIKE would also hit ids that merely appear inside message text or tool
  // arguments, and a row limit could then drop the event that really carries it.
  // `$.messageId` is what writers stamp; `$.message.id` covers events recorded
  // before that field existed, so an old database still resolves.
  const matchId =
    "COALESCE(json_extract(payload, '$.messageId'), json_extract(payload, '$.message.id')) = ?";
  const sql = threadId
    ? `SELECT thread_id, payload FROM session_events
        WHERE thread_id = ? AND ${MESSAGE_EVENT_TYPES_SQL}
          AND ${matchId}
        ORDER BY revision DESC LIMIT 1`
    : `SELECT thread_id, payload FROM session_events
        WHERE ${MESSAGE_EVENT_TYPES_SQL}
          AND ${matchId}
        ORDER BY revision DESC LIMIT 1`;
  const row = (
    threadId ? getDb().prepare(sql).get(threadId, needle) : getDb().prepare(sql).get(needle)
  ) as { thread_id: string; payload: string } | undefined;
  if (!row) return null;
  try {
    return { threadId: row.thread_id, payload: JSON.parse(row.payload) as unknown };
  } catch {
    // Intentionally ignored: a payload that will not parse is not a message event.
    return null;
  }
};
