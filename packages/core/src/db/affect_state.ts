import { getDb } from './database';
import { toIsoNow } from '../utils/text';

export type AffectStateEntry = {
  thread_id: string;
  state: string;
  created_at: string;
  updated_at: string;
};

const serializeState = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
};

export const upsertAffectState = (threadId: string, state: unknown) => {
  if (!threadId) return null;
  const serialized = serializeState(state);
  if (!serialized) return null;

  const now = toIsoNow();
  const stmt = getDb().prepare(`
    INSERT INTO affect_states (
      thread_id, state, created_at, updated_at
    ) VALUES (
      @thread_id, @state, @created_at, @updated_at
    )
    ON CONFLICT(thread_id) DO UPDATE SET
      state = excluded.state,
      updated_at = excluded.updated_at
  `);

  return stmt.run({
    thread_id: threadId,
    state: serialized,
    created_at: now,
    updated_at: now,
  });
};

export const getAffectState = (threadId: string): AffectStateEntry | null => {
  if (!threadId) return null;
  const row = getDb()
    .prepare('SELECT * FROM affect_states WHERE thread_id = ?')
    .get(threadId) as AffectStateEntry | undefined;
  return row ?? null;
};

export const deleteAffectState = (threadId: string) => {
  if (!threadId) return null;
  return getDb().prepare('DELETE FROM affect_states WHERE thread_id = ?').run(threadId);
};
