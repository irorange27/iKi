import { getDb } from './database';

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

export const appendSessionFacts = (threadId: string, events: NewSessionEvent[]): number =>
  append(threadId, null, events)!;

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
    // Intentionally ignored: the caller cannot act on it.
  }
  }
  return null;
};

export const MESSAGE_EVENT_TYPES = {
  INPUT_ACCEPTED: 'input_accepted',
  MODEL_OUTPUT_COMMITTED: 'model_output_committed',
} as const;

export const SESSION_EVENT_VERSION = 1;
