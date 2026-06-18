import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock('@iki/core/db/database', () => ({
  getDb: getDbMock,
}));

describe('thread_context db resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('retries after a missing chat_thread_context table and returns the row', async () => {
    const execMock = vi.fn();
    const getMock = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('no such table: chat_thread_context');
      })
      .mockReturnValue({
        thread_id: 'thread_1',
        summary: 'existing summary',
        covered_message_count: 3,
      });
    const prepareMock = vi.fn(() => ({
      get: getMock,
      run: vi.fn(),
    }));

    getDbMock.mockReturnValue({
      exec: execMock,
      prepare: prepareMock,
    });

    const { getThreadContext } = await import('@iki/core/db/thread_context');
    const result = getThreadContext('thread_1');

    expect(result).toEqual(
      expect.objectContaining({
        thread_id: 'thread_1',
        summary: 'existing summary',
        covered_message_count: 3,
      })
    );
    expect(execMock).toHaveBeenCalledTimes(2);
    expect(prepareMock).toHaveBeenCalledWith(
      'SELECT * FROM chat_thread_context WHERE thread_id = ?'
    );
  });

  it('creates the schema lazily before delete operations', async () => {
    const execMock = vi.fn();
    const runMock = vi.fn().mockReturnValue({ changes: 1 });
    const prepareMock = vi.fn(() => ({
      get: vi.fn(),
      run: runMock,
    }));

    getDbMock.mockReturnValue({
      exec: execMock,
      prepare: prepareMock,
    });

    const { deleteThreadContext } = await import('@iki/core/db/thread_context');
    const result = deleteThreadContext('thread_2');

    expect(result).toEqual({ changes: 1 });
    expect(execMock).toHaveBeenCalledTimes(1);
    expect(prepareMock).toHaveBeenCalledWith(
      'DELETE FROM chat_thread_context WHERE thread_id = ?'
    );
    expect(runMock).toHaveBeenCalledWith('thread_2');
  });
});
