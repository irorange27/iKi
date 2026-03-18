import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/db/database', () => ({
  getDb: vi.fn(),
}));

vi.mock('../../../src/core/config', () => ({
  getAppConfig: vi.fn(() => ({ memory: { enabled: true } })),
}));

import { getDb } from '../../../src/core/db/database';
import { deleteLongMemory, updateLongMemory } from '../../../src/core/db/memory';

const getDbMock = vi.mocked(getDb);

const setupDb = () => {
  const runMock = vi.fn((params?: unknown) => params ?? { changes: 1 });
  const prepareMock = vi.fn(() => ({ run: runMock }));
  getDbMock.mockReturnValue({ prepare: prepareMock } as unknown as ReturnType<typeof getDb>);
  return { runMock, prepareMock };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('updateLongMemory', () => {
  it('returns null when id is missing', () => {
    const result = updateLongMemory('', { summary: 'User likes tea.' });

    expect(result).toBeNull();
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it('returns null when there are no updatable fields', () => {
    const { prepareMock } = setupDb();

    const result = updateLongMemory('mem_1', { id: 'mem_1' } as any);

    expect(result).toBeNull();
    expect(prepareMock).not.toHaveBeenCalled();
  });

  it('recomputes embedding when summary changes', () => {
    const { runMock } = setupDb();

    updateLongMemory('mem_2', { summary: 'User prefers green tea.' });

    const params = runMock.mock.calls[0][0] as {
      summary: string;
      embedding: string;
      id: string;
      updated_at: string;
    };
    expect(params.summary).toBe('User prefers green tea.');
    expect(params.id).toBe('mem_2');
    expect(typeof params.updated_at).toBe('string');
    expect(typeof params.embedding).toBe('string');

    const embedding = JSON.parse(params.embedding);
    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding).toHaveLength(128);
    expect(embedding.some((value: number) => value !== 0)).toBe(true);
  });

  it('does not update embedding when summary is absent', () => {
    const { runMock } = setupDb();

    updateLongMemory('mem_3', { tags: '["preference"]' } as any);

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
