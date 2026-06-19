import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@iki/backend/db/database', () => ({
  getDb: vi.fn(),
}));

vi.mock('@iki/backend/config', () => ({
  getAppConfig: vi.fn(() => ({ memory: { enabled: true } })),
}));

vi.mock('@iki/core/logger', () => ({
  createLogger: vi.fn(() => ({ event: vi.fn() })),
}));

vi.mock('@iki/backend/memory/embedding', () => ({
  embedTextsWithFallback: vi.fn(),
  HASH_EMBEDDING_DIM: 128,
  HASH_EMBEDDING_VERSION: 1,
  PROVIDER_EMBEDDING_VERSION: 1,
  createHashMemoryEmbeddingRuntime: vi.fn(),
  createPreferredMemoryEmbeddingRuntime: vi.fn(),
}));

import { getDb } from '@iki/backend/db/database';
import {
  createHashMemoryEmbeddingRuntime,
  createPreferredMemoryEmbeddingRuntime,
} from '@iki/backend/memory/embedding';
import { searchLongMemory, type LongMemoryEntry } from '@iki/backend/db/memory';

const getDbMock = vi.mocked(getDb);

const providerFingerprint = {
  strategy: 'provider' as const,
  version: 1,
  dimensions: 2,
  providerType: 'openai',
  providerId: 'provider_openai',
  model: 'text-embedding-3-small',
};

const hashFingerprint = {
  strategy: 'hash' as const,
  version: 1,
  dimensions: 128,
};

const buildLongMemoryRow = (overrides: Partial<LongMemoryEntry>): LongMemoryEntry => ({
  id: 'mem_1',
  thread_id: 'thread_1',
  summary: 'memory summary',
  embedding: '[]',
  source_message_ids: null,
  emotion: null,
  tags: null,
  metadata: null,
  created_at: '2026-03-30T00:00:00.000Z',
  updated_at: '2026-03-30T00:00:00.000Z',
  ...overrides,
});

const basisVector = (index: number, dimensions: number): number[] => {
  const vector = new Array(dimensions).fill(0);
  vector[index] = 1;
  return vector;
};

const setupSearchDb = (rows: LongMemoryEntry[]) => {
  const selectAllMock = vi.fn(() => rows);
  const updateRunMock = vi.fn();
  const transactionMock = vi.fn((fn: (entries: Array<{ id: string; embedding: string; metadata: string | null }>) => void) => {
    return (entries: Array<{ id: string; embedding: string; metadata: string | null }>) => fn(entries);
  });
  const prepareMock = vi.fn((sql: string) => {
    if (sql.includes('SELECT * FROM memory_long WHERE thread_id = ? ORDER BY updated_at DESC')) {
      return { all: selectAllMock };
    }
    if (sql === 'UPDATE memory_long SET embedding = @embedding, metadata = @metadata WHERE id = @id') {
      return { run: updateRunMock };
    }
    throw new Error(`Unexpected SQL in test: ${sql}`);
  });

  getDbMock.mockReturnValue({
    prepare: prepareMock,
    transaction: transactionMock,
  } as unknown as ReturnType<typeof getDb>);

  return { prepareMock, selectAllMock, updateRunMock, transactionMock };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createPreferredMemoryEmbeddingRuntime).mockReturnValue({
    fingerprint: {
      strategy: 'provider',
      version: 1,
      dimensions: 0,
      providerType: 'openai',
      providerId: 'provider_openai',
      model: 'text-embedding-3-small',
    },
    embed: vi.fn(async texts =>
      texts.map(() => ({
        vector: [1, 0],
        fingerprint: providerFingerprint,
      }))
    ),
  });
  vi.mocked(createHashMemoryEmbeddingRuntime).mockReturnValue({
    fingerprint: hashFingerprint,
    embed: vi.fn(async texts =>
      texts.map(() => ({
        vector: basisVector(0, 128),
        fingerprint: hashFingerprint,
      }))
    ),
  });
});

describe('long-memory search embeddings', () => {
  it('retrieves Chinese memories with provider embeddings', async () => {
    const chineseMemory = buildLongMemoryRow({
      id: 'mem_cn',
      summary: '用户偏好简洁的项目计划。',
      embedding: JSON.stringify([1, 0]),
      metadata: JSON.stringify({ embedding: providerFingerprint }),
    });
    const unrelatedMemory = buildLongMemoryRow({
      id: 'mem_other',
      summary: 'User prefers weekly summaries.',
      embedding: JSON.stringify([0, 1]),
      metadata: JSON.stringify({ embedding: providerFingerprint }),
    });
    const { updateRunMock } = setupSearchDb([chineseMemory, unrelatedMemory]);
    const providerEmbedMock = vi.fn(async (texts: string[]) =>
      texts.map(text => ({
        vector: text === '项目偏好' ? [1, 0] : [0, 1],
        fingerprint: providerFingerprint,
      }))
    );

    vi.mocked(createPreferredMemoryEmbeddingRuntime).mockReturnValue({
      fingerprint: {
        strategy: 'provider',
        version: 1,
        dimensions: 0,
        providerType: 'openai',
        providerId: 'provider_openai',
        model: 'text-embedding-3-small',
      },
      embed: providerEmbedMock,
    });

    const results = await searchLongMemory('thread_1', '项目偏好', {
      limit: 5,
      threshold: 0.1,
    });

    expect(results.map(entry => entry.id)).toEqual(['mem_cn']);
    expect(providerEmbedMock).toHaveBeenCalledTimes(1);
    expect(providerEmbedMock).toHaveBeenCalledWith(['项目偏好']);
    expect(updateRunMock).not.toHaveBeenCalled();
  });

  it('backfills legacy hash embeddings during provider search and persists provenance', async () => {
    const legacyMemory = buildLongMemoryRow({
      id: 'mem_legacy',
      summary: '用户偏好简洁的项目计划。',
      embedding: JSON.stringify(basisVector(0, 128)),
      metadata: null,
    });
    const { updateRunMock, transactionMock } = setupSearchDb([legacyMemory]);
    const providerEmbedMock = vi.fn(async (texts: string[]) =>
      texts.map(text => ({
        vector: text === '项目偏好' || text === '用户偏好简洁的项目计划。' ? [1, 0] : [0, 1],
        fingerprint: providerFingerprint,
      }))
    );

    vi.mocked(createPreferredMemoryEmbeddingRuntime).mockReturnValue({
      fingerprint: {
        strategy: 'provider',
        version: 1,
        dimensions: 0,
        providerType: 'openai',
        providerId: 'provider_openai',
        model: 'text-embedding-3-small',
      },
      embed: providerEmbedMock,
    });

    const results = await searchLongMemory('thread_1', '项目偏好', {
      limit: 5,
      threshold: 0.1,
    });

    expect(results.map(entry => entry.id)).toEqual(['mem_legacy']);
    expect(providerEmbedMock).toHaveBeenNthCalledWith(1, ['项目偏好']);
    expect(providerEmbedMock).toHaveBeenNthCalledWith(2, ['用户偏好简洁的项目计划。']);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(updateRunMock).toHaveBeenCalledTimes(1);

    const persisted = updateRunMock.mock.calls[0][0] as {
      id: string;
      embedding: string;
      metadata: string;
    };
    expect(persisted.id).toBe('mem_legacy');
    expect(JSON.parse(persisted.embedding)).toEqual([1, 0]);
    expect(JSON.parse(persisted.metadata)).toEqual({
      embedding: providerFingerprint,
    });
  });

  it('falls back to hash search without persisting degraded backfills when the provider fails', async () => {
    const providerMemory = buildLongMemoryRow({
      id: 'mem_provider',
      summary: 'User prefers green tea.',
      embedding: JSON.stringify([1, 0]),
      metadata: JSON.stringify({ embedding: providerFingerprint }),
    });
    const { updateRunMock } = setupSearchDb([providerMemory]);
    const providerEmbedMock = vi.fn(async () => {
      throw new Error('provider unavailable');
    });
    const hashEmbedMock = vi.fn(async (texts: string[]) =>
      texts.map(text => ({
        vector:
          text === 'green tea' || text === 'User prefers green tea.'
            ? basisVector(0, 128)
            : basisVector(1, 128),
        fingerprint: hashFingerprint,
      }))
    );

    vi.mocked(createPreferredMemoryEmbeddingRuntime).mockReturnValue({
      fingerprint: {
        strategy: 'provider',
        version: 1,
        dimensions: 0,
        providerType: 'openai',
        providerId: 'provider_openai',
        model: 'text-embedding-3-small',
      },
      embed: providerEmbedMock,
    });
    vi.mocked(createHashMemoryEmbeddingRuntime).mockReturnValue({
      fingerprint: hashFingerprint,
      embed: hashEmbedMock,
    });

    const results = await searchLongMemory('thread_1', 'green tea', {
      limit: 5,
      threshold: 0.1,
    });

    expect(results.map(entry => entry.id)).toEqual(['mem_provider']);
    expect(providerEmbedMock).toHaveBeenCalledTimes(1);
    expect(hashEmbedMock).toHaveBeenNthCalledWith(1, ['green tea']);
    expect(hashEmbedMock).toHaveBeenNthCalledWith(2, ['User prefers green tea.']);
    expect(updateRunMock).not.toHaveBeenCalled();
  });
});
