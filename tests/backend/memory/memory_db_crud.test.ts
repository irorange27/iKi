import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@iki/backend/db/database', () => ({
  getDb: vi.fn(),
}));

vi.mock('@iki/backend/config', () => ({
  getAppConfig: vi.fn(() => ({ memory: { enabled: true } })),
}));

vi.mock('@iki/backend/memory/embedding', () => ({
  embedTextsWithFallback: vi.fn(async (texts: string[]) => ({
    results: texts.map(() => ({
      vector: [0.25, 0.75],
      fingerprint: {
        strategy: 'provider',
        version: 1,
        dimensions: 2,
        providerType: 'openai',
        providerId: 'provider_openai',
        model: 'text-embedding-3-small',
      },
    })),
    degraded: false,
  })),
  HASH_EMBEDDING_DIM: 128,
  HASH_EMBEDDING_VERSION: 1,
  PROVIDER_EMBEDDING_VERSION: 1,
  createHashMemoryEmbeddingRuntime: vi.fn(),
  createPreferredMemoryEmbeddingRuntime: vi.fn(),
}));

import { getDb } from '@iki/backend/db/database';
import { deleteLongMemory, updateLongMemory } from '@iki/backend/db/memory';
import type { LongMemoryEntry } from '@iki/backend/db/memory';

const getDbMock = vi.mocked(getDb);
type LongMemoryUpdate = Partial<LongMemoryEntry>;

const setupDb = () => {
  const runMock = vi.fn((params?: unknown) => params ?? { changes: 1 });
  const getMock = vi.fn(() => ({ metadata: '{"source":"manual"}' }));
  const prepareMock = vi.fn(() => ({ run: runMock, get: getMock }));
  getDbMock.mockReturnValue({ prepare: prepareMock } as unknown as ReturnType<typeof getDb>);
  return { runMock, prepareMock, getMock };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('updateLongMemory', () => {
  it('returns null when id is missing', async () => {
    const result = await updateLongMemory('', { summary: 'User likes tea.' });

    expect(result).toBeNull();
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it('returns null when there are no updatable fields', async () => {
    const { prepareMock } = setupDb();

    const result = await updateLongMemory('mem_1', { id: 'mem_1' } as LongMemoryUpdate);

    expect(result).toBeNull();
    expect(prepareMock).not.toHaveBeenCalled();
  });

  it('recomputes embedding when summary changes', async () => {
    const { runMock } = setupDb();

    await updateLongMemory('mem_2', { summary: 'User prefers green tea.' });

    const params = runMock.mock.calls[0][0] as {
      summary: string;
      embedding: string;
      metadata: string;
      id: string;
      updated_at: string;
    };
    expect(params.summary).toBe('User prefers green tea.');
    expect(params.id).toBe('mem_2');
    expect(typeof params.updated_at).toBe('string');
    expect(typeof params.embedding).toBe('string');

    const embedding = JSON.parse(params.embedding);
    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding).toEqual([0.25, 0.75]);
    expect(JSON.parse(params.metadata)).toMatchObject({
      source: 'manual',
      embedding: {
        strategy: 'provider',
        model: 'text-embedding-3-small',
        dimensions: 2,
      },
    });
  });

  it('does not update embedding when summary is absent', async () => {
    const { runMock } = setupDb();

    await updateLongMemory('mem_3', { tags: '["preference"]' } as LongMemoryUpdate);

    const params = runMock.mock.calls[0][0] as Record<string, unknown>;
    expect(params.tags).toBe('["preference"]');
    expect('embedding' in params).toBe(false);
  });
});

describe('deleteLongMemory', () => {
  it('returns null when id is missing', () => {
    const result = deleteLongMemory('');

    expect(result).toBeNull();
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it('deletes by id', () => {
    const { prepareMock, runMock } = setupDb();

    deleteLongMemory('mem_4');

    expect(prepareMock).toHaveBeenCalledWith('DELETE FROM memory_long WHERE id = ?');
    expect(runMock).toHaveBeenCalledWith('mem_4');
  });
});
