import { beforeEach, describe, expect, it, vi } from 'vitest';

type ExecutedMigrationRow = {
  name: string;
  executed_at: string;
};

const { dbState, execMock, prepareMock } = vi.hoisted(() => {
  const state = {
    executedRows: [] as ExecutedMigrationRow[],
  };

  const execMock = vi.fn();
  const prepareMock = vi.fn((sql: string) => {
    if (sql.startsWith('SELECT name FROM migrations WHERE name IN (')) {
      return {
        all: (...names: string[]) =>
          state.executedRows
            .filter(row => names.includes(row.name))
            .map(row => ({ name: row.name })),
      };
    }

    if (sql === 'INSERT INTO migrations (name, executed_at) VALUES (?, ?)') {
      return {
        run: (name: string, executedAt: string) => {
          state.executedRows.push({
            name,
            executed_at: executedAt,
          });
        },
      };
    }

    if (sql === 'UPDATE migrations SET name = ? WHERE name = ?') {
      return {
        run: (toName: string, fromName: string) => {
          state.executedRows = state.executedRows.map(row =>
            row.name === fromName ? { ...row, name: toName } : row
          );
        },
      };
    }

    if (sql === 'SELECT name FROM migrations ORDER BY executed_at') {
      return {
        all: () => state.executedRows.map(row => ({ name: row.name })),
      };
    }

    throw new Error(`Unexpected SQL in migration runner test: ${sql}`);
  });

  return {
    dbState: state,
    execMock,
    prepareMock,
  };
});

vi.mock('../../../src/core/db/database', () => ({
  getDb: () => ({
    exec: execMock,
    prepare: prepareMock,
  }),
}));

import { getExecutedMigrations, runMigration } from '../../../src/core/db/migration/runner';

beforeEach(() => {
  dbState.executedRows = [];
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('migration runner', () => {
  it('normalizes a legacy alias to the canonical migration name without rerunning the migration', () => {
    dbState.executedRows = [
      {
        name: '009_add_mcp_servers_table',
        executed_at: '2026-03-22T00:00:00.000Z',
      },
    ];
    const up = vi.fn();

    runMigration({
      name: '010_add_mcp_servers_table',
      aliases: ['009_add_mcp_servers_table'],
      up,
    });

    expect(up).not.toHaveBeenCalled();
    expect(dbState.executedRows).toEqual([
      {
        name: '010_add_mcp_servers_table',
        executed_at: '2026-03-22T00:00:00.000Z',
      },
    ]);
    expect(getExecutedMigrations()).toEqual(['010_add_mcp_servers_table']);
  });

  it('records the canonical migration name when the migration executes for the first time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-22T03:40:00.000Z'));
    const up = vi.fn();

    runMigration({
      name: '011_add_proactive_tasks_cron',
      aliases: ['010_add_proactive_tasks_cron'],
      up,
    });

    expect(up).toHaveBeenCalledTimes(1);
    expect(dbState.executedRows).toEqual([
      {
        name: '011_add_proactive_tasks_cron',
        executed_at: '2026-03-22T03:40:00.000Z',
      },
    ]);
  });
});
