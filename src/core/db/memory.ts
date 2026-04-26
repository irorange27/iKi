import { getDb } from './database';
import { getAppConfig } from '../config';
import { createLogger } from '../logger';
import { buildSetClause } from './utils';
import {
  createHashMemoryEmbeddingRuntime,
  createPreferredMemoryEmbeddingRuntime,
  embedTextsWithFallback,
  HASH_EMBEDDING_DIM,
  HASH_EMBEDDING_VERSION,
  PROVIDER_EMBEDDING_VERSION,
  type MemoryEmbeddingFingerprint,
  type MemoryEmbeddingRuntime,
} from '../memory/embedding';
import { extractTextFromMessageParts } from '../../shared/chat/message_parts';
import { createPrefixedId } from '../../shared/utils/id';
import { toIsoNow } from '../../shared/utils/text';

const memoryLogger = createLogger({ module: 'memory_db' });

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

const SHORT_MEMORY_LIMIT = 200;

const isMemoryEnabled = (): boolean => {
  const appConfig = getAppConfig();
  return Boolean(appConfig?.memory?.enabled);
};

const parseEmbedding = (raw: string): number[] => {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map(value => (typeof value === 'number' && Number.isFinite(value) ? value : 0));
    }
  } catch {
    // Ignore parse failures.
  }
  return [];
};

const cosineSimilarity = (a: number[], b: number[]): number => {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i += 1) {
    dot += (a[i] || 0) * (b[i] || 0);
  }
  return dot;
};

const parseMetadataRecord = (raw: unknown): Record<string, unknown> => {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? ({ ...(raw as Record<string, unknown>) } as Record<string, unknown>)
    : {};
};

const toStoredMetadata = (metadata: Record<string, unknown>): string | null =>
  Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null;

const normalizeFingerprint = (
  value: unknown,
  fallbackDimensions: number
): MemoryEmbeddingFingerprint | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const strategy = record.strategy === 'provider' || record.strategy === 'hash' ? record.strategy : null;
  const version =
    typeof record.version === 'number' && Number.isFinite(record.version)
      ? Math.trunc(record.version)
      : strategy === 'provider'
        ? PROVIDER_EMBEDDING_VERSION
        : HASH_EMBEDDING_VERSION;
  const dimensions =
    typeof record.dimensions === 'number' && Number.isFinite(record.dimensions)
      ? Math.trunc(record.dimensions)
      : fallbackDimensions;

  if (!strategy || dimensions <= 0) return null;

  const providerType = typeof record.providerType === 'string' ? record.providerType.trim() : '';
  const providerId = typeof record.providerId === 'string' ? record.providerId.trim() : '';
  const model = typeof record.model === 'string' ? record.model.trim() : '';

  if (strategy === 'provider') {
    if (!providerType || !model) return null;
    return {
      strategy,
      version,
      dimensions,
      providerType,
      ...(providerId ? { providerId } : {}),
      model,
    };
  }

  return {
    strategy,
    version,
    dimensions,
  };
};

const extractStoredFingerprint = (
  metadataRaw: string | null,
  embeddingVector: number[]
): MemoryEmbeddingFingerprint | null => {
  const metadata = parseMetadataRecord(metadataRaw);
  const normalized = normalizeFingerprint(metadata.embedding, embeddingVector.length);
  if (normalized) return normalized;

  if (embeddingVector.length === HASH_EMBEDDING_DIM) {
    return {
      strategy: 'hash',
      version: HASH_EMBEDDING_VERSION,
      dimensions: HASH_EMBEDDING_DIM,
    };
  }

  return null;
};

const withEmbeddingFingerprint = (
  metadataRaw: unknown,
  fingerprint: MemoryEmbeddingFingerprint
): string | null => {
  const metadata = parseMetadataRecord(metadataRaw);
  metadata.embedding = {
    strategy: fingerprint.strategy,
    version: fingerprint.version,
    dimensions: fingerprint.dimensions,
    ...(fingerprint.providerType ? { providerType: fingerprint.providerType } : {}),
    ...(fingerprint.providerId ? { providerId: fingerprint.providerId } : {}),
    ...(fingerprint.model ? { model: fingerprint.model } : {}),
  };
  return toStoredMetadata(metadata);
};

const fingerprintsMatch = (
  stored: MemoryEmbeddingFingerprint | null,
  active: MemoryEmbeddingFingerprint
): boolean => {
  if (!stored) return false;
  if (stored.strategy !== active.strategy) return false;
  if (stored.dimensions !== active.dimensions) return false;
  if (stored.version !== active.version) return false;
  if (stored.strategy === 'provider') {
    return (
      stored.providerType === active.providerType &&
      stored.providerId === active.providerId &&
      stored.model === active.model
    );
  }
  return true;
};

const persistEmbeddingBackfill = (
  entries: Array<{ id: string; embedding: string; metadata: string | null }>
) => {
  if (entries.length === 0) return;
  const stmt = getDb().prepare(
    'UPDATE memory_long SET embedding = @embedding, metadata = @metadata WHERE id = @id'
  );
  const transaction = getDb().transaction((rows: Array<{ id: string; embedding: string; metadata: string | null }>) => {
    for (const row of rows) {
      stmt.run(row);
    }
  });
  transaction(entries);
};

const scoreLongMemoryRowsWithRuntime = async (
  rows: LongMemoryEntry[],
  query: string,
  runtime: MemoryEmbeddingRuntime,
  options?: Pick<LongMemorySearchOptions, 'limit' | 'threshold'> & { persistBackfill?: boolean }
): Promise<LongMemorySearchResult[]> => {
  const threshold = options?.threshold ?? 0.1;
  const limit = options?.limit ?? 5;
  const persistBackfill = options?.persistBackfill === true;

  const [queryEmbeddingResult] = await runtime.embed([query]);
  if (!queryEmbeddingResult) return [];

  const activeFingerprint = queryEmbeddingResult.fingerprint;
  const compatibleRows: LongMemoryEntry[] = [];
  const rowsNeedingBackfill: LongMemoryEntry[] = [];

  for (const row of rows) {
    const embedding = parseEmbedding(row.embedding);
    const fingerprint = extractStoredFingerprint(row.metadata, embedding);
    if (embedding.length > 0 && fingerprintsMatch(fingerprint, activeFingerprint)) {
      compatibleRows.push(row);
      continue;
    }
    if (row.summary && row.summary.trim()) {
      rowsNeedingBackfill.push(row);
    }
  }

  if (rowsNeedingBackfill.length > 0) {
    const backfilled = await runtime.embed(rowsNeedingBackfill.map(row => row.summary));
    const persistedRows: Array<{ id: string; embedding: string; metadata: string | null }> = [];

    for (let index = 0; index < rowsNeedingBackfill.length; index += 1) {
      const row = rowsNeedingBackfill[index];
      const nextEmbedding = backfilled[index];
      if (!row || !nextEmbedding) continue;

      const rawEmbedding = JSON.stringify(nextEmbedding.vector);
      const rawMetadata = withEmbeddingFingerprint(row.metadata, nextEmbedding.fingerprint);
      compatibleRows.push({
        ...row,
        embedding: rawEmbedding,
        metadata: rawMetadata,
      });

      if (persistBackfill) {
        persistedRows.push({
          id: row.id,
          embedding: rawEmbedding,
          metadata: rawMetadata,
        });
      }
    }

    if (persistedRows.length > 0) {
      persistEmbeddingBackfill(persistedRows);
    }
  }

  return compatibleRows
    .map(row => {
      const embedding = parseEmbedding(row.embedding);
      if (embedding.length !== queryEmbeddingResult.vector.length) {
        return { ...row, score: Number.NEGATIVE_INFINITY };
      }
      const score = cosineSimilarity(queryEmbeddingResult.vector, embedding);
      return { ...row, score };
    })
    .filter(row => row.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};

const searchLongMemoryRows = async (
  rows: LongMemoryEntry[],
  query: string,
  options?: Pick<LongMemorySearchOptions, 'limit' | 'threshold'>
): Promise<LongMemorySearchResult[]> => {
  const runtime = createPreferredMemoryEmbeddingRuntime();

  try {
    return await scoreLongMemoryRowsWithRuntime(rows, query, runtime, {
      ...options,
      persistBackfill: runtime.fingerprint.strategy === 'provider',
    });
  } catch (error) {
    if (runtime.fingerprint.strategy !== 'provider') {
      throw error;
    }

    memoryLogger.event({
      level: 'warn',
      event: 'memory.search.embedding_fallback',
      outcome: 'degraded',
      error,
      fallback_applied: true,
      data: {
        provider_type: runtime.fingerprint.providerType || null,
        provider_id: runtime.fingerprint.providerId || null,
        model: runtime.fingerprint.model || null,
        row_count: rows.length,
      },
    });

    return await scoreLongMemoryRowsWithRuntime(rows, query, createHashMemoryEmbeddingRuntime(), {
      ...options,
      persistBackfill: false,
    });
  }
};

export const extractTextFromMessageJson = (
  messageJson: string
): { role: string; content: string } | null => {
  try {
    const parsed = JSON.parse(messageJson) as {
      role?: string;
      parts?: unknown[];
      content?: string;
    };

    if (!parsed || typeof parsed !== 'object' || typeof parsed.role !== 'string') return null;

    if (Array.isArray(parsed.parts)) {
      const content = extractTextFromMessageParts(parsed.parts);
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

  const now = toIsoNow();
  const stmt = getDb().prepare(`
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
    id: entry.id || createPrefixedId('mems'),
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
  const rows = getDb()
    .prepare('SELECT * FROM memory_short WHERE thread_id = ? ORDER BY updated_at DESC LIMIT ?')
    .all(threadId, safeLimit) as ShortMemoryEntry[];

  return rows.map(row => ({
    ...row,
    importance: typeof row.importance === 'number' ? row.importance : Number(row.importance || 0),
  }));
};

export const listShortMemoryAcrossThreads = (
  limit?: number,
  options?: { includeIncognito?: boolean; clientId?: string }
): ShortMemoryEntry[] => {
  const safeLimit = typeof limit === 'number' ? limit : 50;
  const includeIncognito = Boolean(options?.includeIncognito);
  const filters: string[] = [];
  const params: unknown[] = [];

  if (!includeIncognito) {
    filters.push('chat_threads.is_incognito = 0');
  }

  if (options?.clientId) {
    filters.push('chat_threads.client_id = ?');
    params.push(options.clientId);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(
      `
      SELECT memory_short.*
      FROM memory_short
      INNER JOIN chat_threads ON chat_threads.id = memory_short.thread_id
      ${whereClause}
      ORDER BY memory_short.updated_at DESC
      LIMIT ?
    `
    )
    .all(...params, safeLimit) as ShortMemoryEntry[];

  return rows.map(row => ({
    ...row,
    importance: typeof row.importance === 'number' ? row.importance : Number(row.importance || 0),
  }));
};

export const pruneShortMemory = (threadId: string, maxCount = SHORT_MEMORY_LIMIT) => {
  if (!threadId || maxCount <= 0) return null;
  return getDb()
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

export const addLongMemory = async (
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

  const now = toIsoNow();
  const embeddingResult = await embedTextsWithFallback([entry.summary]);
  const firstEmbedding = embeddingResult.results[0];
  if (!firstEmbedding) return null;

  const stmt = getDb().prepare(`
    INSERT INTO memory_long (
      id, thread_id, summary, embedding, source_message_ids, emotion, tags, metadata, created_at, updated_at
    ) VALUES (
      @id, @thread_id, @summary, @embedding, @source_message_ids, @emotion, @tags, @metadata, @created_at, @updated_at
    )
  `);

  const data = {
    id: entry.id || createPrefixedId('meml'),
    thread_id: entry.thread_id,
    summary: entry.summary,
    embedding: JSON.stringify(firstEmbedding.vector),
    source_message_ids: entry.source_message_ids ? JSON.stringify(entry.source_message_ids) : null,
    emotion: entry.emotion ? JSON.stringify(entry.emotion) : null,
    tags: entry.tags ? JSON.stringify(entry.tags) : null,
    metadata: withEmbeddingFingerprint(entry.metadata, firstEmbedding.fingerprint),
    created_at: now,
    updated_at: now,
  };

  return stmt.run(data);
};

export const listLongMemory = (threadId: string, limit?: number): LongMemoryEntry[] => {
  const safeLimit = typeof limit === 'number' ? limit : 50;
  return getDb()
    .prepare('SELECT * FROM memory_long WHERE thread_id = ? ORDER BY updated_at DESC LIMIT ?')
    .all(threadId, safeLimit) as LongMemoryEntry[];
};

export const listLongMemoryAcrossThreads = (
  limit?: number,
  options?: { includeIncognito?: boolean; clientId?: string }
): LongMemoryEntry[] => {
  const safeLimit = typeof limit === 'number' ? limit : 50;
  const includeIncognito = Boolean(options?.includeIncognito);
  const filters: string[] = [];
  const params: unknown[] = [];

  if (!includeIncognito) {
    filters.push('chat_threads.is_incognito = 0');
  }

  if (options?.clientId) {
    filters.push('chat_threads.client_id = ?');
    params.push(options.clientId);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  return getDb()
    .prepare(
      `
      SELECT memory_long.*
      FROM memory_long
      INNER JOIN chat_threads ON chat_threads.id = memory_long.thread_id
      ${whereClause}
      ORDER BY memory_long.updated_at DESC
      LIMIT ?
    `
    )
    .all(...params, safeLimit) as LongMemoryEntry[];
};

export const updateLongMemory = async (id: string, updates: Partial<LongMemoryEntry>) => {
  if (!id) return null;
  const now = toIsoNow();
  const ALLOWED_MEMORY_LONG_COLUMNS = new Set([
    'thread_id', 'summary', 'embedding', 'source_message_ids', 'emotion',
    'tags', 'metadata',
  ]);
  const fieldNames = new Set(
    Object.keys(updates)
    .filter(key => key !== 'id' && key !== 'created_at')
  );
  if (typeof updates.summary === 'string') {
    fieldNames.add('embedding');
    fieldNames.add('metadata');
  }
  const fields = Array.from(fieldNames)
    .filter(key => ALLOWED_MEMORY_LONG_COLUMNS.has(key))
    .map(key => `${key} = @${key}`)
    .join(', ');

  if (!fields) return null;

  const stmt = getDb().prepare(`
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
    const existingMetadata =
      typeof updates.metadata === 'string'
        ? updates.metadata
        : ((getDb()
            .prepare('SELECT metadata FROM memory_long WHERE id = ?')
            .get(id) as { metadata?: string | null } | undefined)?.metadata ?? null);
    const embeddingResult = await embedTextsWithFallback([updates.summary]);
    const firstEmbedding = embeddingResult.results[0];
    if (firstEmbedding) {
      params.embedding = JSON.stringify(firstEmbedding.vector);
      params.metadata = withEmbeddingFingerprint(existingMetadata, firstEmbedding.fingerprint);
    }
  }

  return stmt.run(params);
};

export const deleteLongMemory = (id: string) => {
  if (!id) return null;
  return getDb().prepare('DELETE FROM memory_long WHERE id = ?').run(id);
};

type LongMemorySearchOptions = {
  limit?: number;
  threshold?: number;
  force?: boolean;
  includeIncognito?: boolean;
  clientId?: string;
};

export const searchLongMemory = async (
  threadId: string,
  query: string,
  options?: LongMemorySearchOptions
): Promise<LongMemorySearchResult[]> => {
  if (!threadId || !query.trim()) return [];
  if (!isMemoryEnabled() && !options?.force) return [];

  const rows = getDb()
    .prepare('SELECT * FROM memory_long WHERE thread_id = ? ORDER BY updated_at DESC')
    .all(threadId) as LongMemoryEntry[];

  return await searchLongMemoryRows(rows, query, options);
};

export const searchLongMemoryAcrossThreads = async (
  query: string,
  options?: LongMemorySearchOptions
): Promise<LongMemorySearchResult[]> => {
  if (!query.trim()) return [];
  if (!isMemoryEnabled() && !options?.force) return [];

  const includeIncognito = Boolean(options?.includeIncognito);
  const filters: string[] = [];
  const params: unknown[] = [];

  if (!includeIncognito) {
    filters.push('chat_threads.is_incognito = 0');
  }

  if (options?.clientId) {
    filters.push('chat_threads.client_id = ?');
    params.push(options.clientId);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(
      `
      SELECT memory_long.*
      FROM memory_long
      INNER JOIN chat_threads ON chat_threads.id = memory_long.thread_id
      ${whereClause}
      ORDER BY memory_long.updated_at DESC
    `
    )
    .all(...params) as LongMemoryEntry[];

  return await searchLongMemoryRows(rows, query, options);
};
