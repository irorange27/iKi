import db, { getConfig } from './database';
import type { AppConfig } from '../../shared/types/config';

export type ShortMemoryEntry = {
  id: string;
  thread_id: string;
  message_id: string;
  role: string;
  content: string;
  emotion: string | null;
  importance: number;
  created_at: string;
  updated_at: string;
};

export type LongMemoryEntry = {
  id: string;
  thread_id: string;
  summary: string;
  embedding: string;
  source_message_ids: string | null;
  emotion: string | null;
  tags: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
};

export type LongMemorySearchResult = LongMemoryEntry & { score: number };

const EMBEDDING_DIM = 128;
const SHORT_MEMORY_LIMIT = 200;

const nowIso = () => new Date().toISOString();

const isMemoryEnabled = (): boolean => {
  const appConfig = getConfig('app_config') as AppConfig | null;
  return Boolean(appConfig?.memory?.enabled);
};

const tokenize = (text: string): string[] => {
  const matches = text.toLowerCase().match(/[a-z0-9]+/g);
  return matches ? matches : [];
};

const hashToken = (token: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const normalizeVector = (vector: number[]): number[] => {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) return vector;
  return vector.map(value => value / norm);
};

const textToEmbedding = (text: string): number[] => {
  const vector = new Array(EMBEDDING_DIM).fill(0);
  for (const token of tokenize(text)) {
    const hash = hashToken(token);
    const index = hash % EMBEDDING_DIM;
    const sign = hash & 1 ? 1 : -1;
    vector[index] += sign;
  }
  return normalizeVector(vector);
};

const parseEmbedding = (raw: string): number[] => {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map(value => (typeof value === 'number' ? value : 0));
    }
  } catch {
    // Ignore parse failures.
  }
  return new Array(EMBEDDING_DIM).fill(0);
};

const cosineSimilarity = (a: number[], b: number[]): number => {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i += 1) {
    dot += (a[i] || 0) * (b[i] || 0);
  }
  return dot;
};

const extractTextFromMessageJson = (
  messageJson: string
): { role: string; content: string } | null => {
  try {
    const parsed = JSON.parse(messageJson) as {
      role?: string;
      parts?: Array<{ type?: string; text?: string }>;
      content?: string;
    };

    if (!parsed || typeof parsed !== 'object' || typeof parsed.role !== 'string') return null;

    if (Array.isArray(parsed.parts)) {
      const content = parsed.parts
        .filter(part => part && part.type === 'text' && typeof part.text === 'string')
        .map(part => part.text as string)
        .join('');
      return { role: parsed.role, content };
    }

    if (typeof parsed.content === 'string') {
      return { role: parsed.role, content: parsed.content };
    }
  } catch {
    return null;
  }

  return null;
};

export const addShortMemory = (
  entry: {
    id?: string;
    thread_id: string;
    message_id: string;
    role: string;
    content: string;
    emotion?: unknown;
    importance?: number;
  },
  options?: { force?: boolean }
) => {
  if (!entry.thread_id || !entry.message_id) return null;
  if (!entry.content || !entry.content.trim()) return null;
  if (!isMemoryEnabled() && !options?.force) return null;

  const now = nowIso();
  const stmt = db.prepare(`
    INSERT INTO memory_short (
      id, thread_id, message_id, role, content, emotion, importance, created_at, updated_at
    ) VALUES (
      @id, @thread_id, @message_id, @role, @content, @emotion, @importance, @created_at, @updated_at
    )
    ON CONFLICT(message_id) DO UPDATE SET
      role = excluded.role,
      content = excluded.content,
      emotion = excluded.emotion,
      importance = excluded.importance,
      updated_at = excluded.updated_at
  `);

  const data = {
    id: entry.id || `mems_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    thread_id: entry.thread_id,
    message_id: entry.message_id,
    role: entry.role,
    content: entry.content,
    emotion: entry.emotion ? JSON.stringify(entry.emotion) : null,
    importance: entry.importance ?? 0,
    created_at: now,
    updated_at: now,
  };

  return stmt.run(data);
};

export const addShortMemoryFromChatMessage = (
  params: {
    thread_id: string;
    message_id: string;
    message_json: string;
  },
  options?: { force?: boolean }
) => {
  const extracted = extractTextFromMessageJson(params.message_json);
  if (!extracted) return null;
  const role = extracted.role;
  if (role !== 'user' && role !== 'assistant') return null;
  if (!extracted.content || !extracted.content.trim()) return null;

  return addShortMemory(
    {
      thread_id: params.thread_id,
      message_id: params.message_id,
      role,
      content: extracted.content,
    },
    options
  );
};

export const listShortMemory = (threadId: string, limit?: number): ShortMemoryEntry[] => {
  const safeLimit = typeof limit === 'number' ? limit : 50;
  const rows = db
    .prepare(
      'SELECT * FROM memory_short WHERE thread_id = ? ORDER BY updated_at DESC LIMIT ?'
    )
    .all(threadId, safeLimit) as ShortMemoryEntry[];

  return rows.map(row => ({
    ...row,
    importance: typeof row.importance === 'number' ? row.importance : Number(row.importance || 0),
  }));
};

export const pruneShortMemory = (threadId: string, maxCount = SHORT_MEMORY_LIMIT) => {
  if (!threadId || maxCount <= 0) return null;
  return db
    .prepare(
      `
      DELETE FROM memory_short
      WHERE id IN (
        SELECT id FROM memory_short
        WHERE thread_id = ?
        ORDER BY updated_at DESC
        LIMIT -1 OFFSET ?
      )
    `
    )
    .run(threadId, maxCount);
};

export const addLongMemory = (
  entry: {
    id?: string;
    thread_id: string;
    summary: string;
    source_message_ids?: string[];
    emotion?: unknown;
    tags?: string[];
    metadata?: unknown;
  },
  options?: { force?: boolean }
) => {
  if (!entry.thread_id || !entry.summary || !entry.summary.trim()) return null;
  if (!isMemoryEnabled() && !options?.force) return null;

  const now = nowIso();
  const embedding = JSON.stringify(textToEmbedding(entry.summary));
  const stmt = db.prepare(`
    INSERT INTO memory_long (
      id, thread_id, summary, embedding, source_message_ids, emotion, tags, metadata, created_at, updated_at
    ) VALUES (
      @id, @thread_id, @summary, @embedding, @source_message_ids, @emotion, @tags, @metadata, @created_at, @updated_at
    )
  `);

  const data = {
    id: entry.id || `meml_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    thread_id: entry.thread_id,
    summary: entry.summary,
    embedding,
    source_message_ids: entry.source_message_ids
      ? JSON.stringify(entry.source_message_ids)
      : null,
    emotion: entry.emotion ? JSON.stringify(entry.emotion) : null,
    tags: entry.tags ? JSON.stringify(entry.tags) : null,
    metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
    created_at: now,
    updated_at: now,
  };

  return stmt.run(data);
};

export const updateLongMemory = (id: string, updates: Partial<LongMemoryEntry>) => {
  if (!id) return null;
  const now = nowIso();
  const fields = Object.keys(updates)
    .filter(key => key !== 'id' && key !== 'created_at')
    .map(key => `${key} = @${key}`)
    .join(', ');

  if (!fields) return null;

  const stmt = db.prepare(`
    UPDATE memory_long
    SET ${fields}, updated_at = @updated_at
    WHERE id = @id
  `);

  const params: Record<string, unknown> = {
    ...updates,
    id,
    updated_at: now,
  };

  if (typeof updates.summary === 'string') {
    params.embedding = JSON.stringify(textToEmbedding(updates.summary));
  }

  return stmt.run(params);
};

export const searchLongMemory = (
  threadId: string,
  query: string,
  options?: { limit?: number; threshold?: number; force?: boolean }
): LongMemorySearchResult[] => {
  if (!threadId || !query.trim()) return [];
  if (!isMemoryEnabled() && !options?.force) return [];

  const rows = db
    .prepare('SELECT * FROM memory_long WHERE thread_id = ? ORDER BY updated_at DESC')
    .all(threadId) as LongMemoryEntry[];

  const queryEmbedding = textToEmbedding(query);
  const threshold = options?.threshold ?? 0.1;
  const limit = options?.limit ?? 5;

  const scored = rows
    .map(row => {
      const embedding = parseEmbedding(row.embedding);
      const score = cosineSimilarity(queryEmbedding, embedding);
      return { ...row, score };
    })
    .filter(row => row.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
};
