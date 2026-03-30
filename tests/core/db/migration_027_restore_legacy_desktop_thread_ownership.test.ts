import { beforeEach, describe, expect, it, vi } from 'vitest';

type AppClientRow = {
  id: string;
  created_at: string;
};

type ChatThreadRow = {
  id: string;
  client_id: string | null;
  created_at: string;
};

const { state, getDbMock } = vi.hoisted(() => ({
  state: {
    clients: [] as AppClientRow[],
    threads: [] as ChatThreadRow[],
  },
  getDbMock: vi.fn(),
}));

vi.mock('../../../src/core/db/database', () => ({
  getDb: getDbMock,
}));

describe('027_restore_legacy_desktop_thread_ownership migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    state.clients = [
      {
        id: 'client_napcat',
        created_at: '2026-03-19T11:40:44.361Z',
      },
      {
        id: 'client_benchmark',
        created_at: '2026-03-30T06:53:00.820Z',
      },
    ];

    state.threads = [
      {
        id: 'thread_legacy_1',
        client_id: 'client_benchmark',
        created_at: '2026-03-28T00:00:00.000Z',
      },
      {
        id: 'thread_legacy_2',
        client_id: 'client_benchmark',
        created_at: '2026-03-30T06:53:00.819Z',
      },
      {
        id: 'thread_external_owned',
        client_id: 'client_benchmark',
        created_at: '2026-03-30T06:53:00.821Z',
      },
      {
        id: 'thread_desktop_null',
        client_id: null,
        created_at: '2026-03-30T08:00:00.000Z',
      },
      {
        id: 'thread_napcat',
        client_id: 'client_napcat',
        created_at: '2026-03-30T08:01:00.000Z',
      },
    ];

    const prepareMock = vi.fn((sql: string) => {
      if (
        sql ===
        'SELECT id, created_at FROM app_clients WHERE id <> ? ORDER BY created_at ASC, id ASC LIMIT 1'
      ) {
        return {
          get: (excludedId: string) =>
            state.clients
              .filter(client => client.id !== excludedId)
              .sort((left, right) =>
                left.created_at === right.created_at
                  ? left.id.localeCompare(right.id)
                  : left.created_at.localeCompare(right.created_at)
              )[0] ?? undefined,
        };
      }

      if (sql === 'UPDATE chat_threads SET client_id = NULL WHERE client_id = ? AND created_at < ?') {
        return {
          run: (clientId: string, cutoff: string) => {
            state.threads = state.threads.map(thread =>
              thread.client_id === clientId && thread.created_at < cutoff
                ? { ...thread, client_id: null }
                : thread
            );
          },
        };
      }

      throw new Error(`Unexpected SQL in 027 migration test: ${sql}`);
    });

    getDbMock.mockReturnValue({
      prepare: prepareMock,
    });
  });

  it('restores pre-registration legacy desktop threads to null ownership without touching newer external threads', async () => {
    const { migration } = await import(
      '../../../src/core/db/migration/027_restore_legacy_desktop_thread_ownership'
    );

    migration.up();

    expect(state.threads).toEqual([
      {
        id: 'thread_legacy_1',
        client_id: null,
        created_at: '2026-03-28T00:00:00.000Z',
      },
      {
        id: 'thread_legacy_2',
        client_id: null,
        created_at: '2026-03-30T06:53:00.819Z',
      },
      {
        id: 'thread_external_owned',
        client_id: 'client_benchmark',
        created_at: '2026-03-30T06:53:00.821Z',
      },
      {
        id: 'thread_desktop_null',
        client_id: null,
        created_at: '2026-03-30T08:00:00.000Z',
      },
      {
        id: 'thread_napcat',
        client_id: 'client_napcat',
        created_at: '2026-03-30T08:01:00.000Z',
      },
    ]);
  });

  it('is a no-op when no non-system client has ever been registered', async () => {
    state.clients = [
      {
        id: 'client_napcat',
        created_at: '2026-03-19T11:40:44.361Z',
      },
    ];

    const { migration } = await import(
      '../../../src/core/db/migration/027_restore_legacy_desktop_thread_ownership'
    );

    migration.up();

    expect(state.threads).toEqual([
      {
        id: 'thread_legacy_1',
        client_id: 'client_benchmark',
        created_at: '2026-03-28T00:00:00.000Z',
      },
      {
        id: 'thread_legacy_2',
        client_id: 'client_benchmark',
        created_at: '2026-03-30T06:53:00.819Z',
      },
      {
        id: 'thread_external_owned',
        client_id: 'client_benchmark',
        created_at: '2026-03-30T06:53:00.821Z',
      },
      {
        id: 'thread_desktop_null',
        client_id: null,
        created_at: '2026-03-30T08:00:00.000Z',
      },
      {
        id: 'thread_napcat',
        client_id: 'client_napcat',
        created_at: '2026-03-30T08:01:00.000Z',
      },
    ]);
  });
});
