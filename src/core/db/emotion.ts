import { getDb } from './database';
import { createPrefixedId } from '../../shared/utils/id';
import { toIsoNow } from '../../shared/utils/text';

export type EmotionEventEntry = {
  id: string;
  thread_id: string;
  message_id: string;
  role: string;
  emotion: string;
  created_at: string;
  updated_at: string;
};

const EMOTION_EVENT_LIMIT = 200;

const serializeEmotion = (value: unknown): string | null => {
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

export const addEmotionEvent = (entry: {
  id?: string;
  thread_id: string;
  message_id: string;
  role: string;
  emotion: unknown;
}) => {
  if (!entry.thread_id || !entry.message_id) return null;
  const emotion = serializeEmotion(entry.emotion);
  if (!emotion) return null;

  const now = toIsoNow();
  const stmt = getDb().prepare(`
    INSERT INTO emotion_events (
      id, thread_id, message_id, role, emotion, created_at, updated_at
    ) VALUES (
      @id, @thread_id, @message_id, @role, @emotion, @created_at, @updated_at
    )
    ON CONFLICT(message_id) DO UPDATE SET
      role = excluded.role,
      emotion = excluded.emotion,
      updated_at = excluded.updated_at
  `);

  const data = {
    id: entry.id || createPrefixedId('emoe'),
    thread_id: entry.thread_id,
    message_id: entry.message_id,
    role: entry.role,
    emotion,
    created_at: now,
    updated_at: now,
  };

  return stmt.run(data);
};

export const listEmotionEvents = (threadId: string, limit?: number): EmotionEventEntry[] => {
  const safeLimit = typeof limit === 'number' ? limit : 50;
  const rows = getDb()
    .prepare(
      'SELECT * FROM emotion_events WHERE thread_id = ? ORDER BY updated_at DESC LIMIT ?'
    )
    .all(threadId, safeLimit) as EmotionEventEntry[];

  return rows;
};

export const pruneEmotionEvents = (threadId: string, maxCount = EMOTION_EVENT_LIMIT) => {
  if (!threadId || maxCount <= 0) return null;
  return getDb()
    .prepare(
      `
      DELETE FROM emotion_events
      WHERE id IN (
        SELECT id FROM emotion_events
        WHERE thread_id = ?
        ORDER BY updated_at DESC
        LIMIT -1 OFFSET ?
      )
    `
    )
    .run(threadId, maxCount);
};
