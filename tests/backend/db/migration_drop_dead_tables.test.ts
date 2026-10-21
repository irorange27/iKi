import { describe, expect, it, vi } from 'vitest';

import { migration } from '@iki/backend/db/migration/007_drop_dead_tables';
import type { SqliteDatabase } from '@iki/backend/db/sqlite';

// `agent_run_checkpoints` and `tool_allowlist` lost their last owner: no
// production writer exists for either, so this migration is the data half of
// their removal. It must name exactly those two tables — a missing one leaves
// an orphan table that later `SELECT *` archaeology misreads as live state, and
// an extra one would drop durable state the harness still reads.
const makeFakeDb = () => {
  const exec = vi.fn();
  return { db: { exec } as unknown as SqliteDatabase, exec };
};

describe('007_drop_dead_tables', () => {
  it('drops every dead table', () => {
    const { db, exec } = makeFakeDb();

    migration.up(db);

    const statements = exec.mock.calls.map(call => String(call[0]));
    expect(statements).toEqual([
      'DROP TABLE IF EXISTS agent_run_checkpoints',
      'DROP TABLE IF EXISTS tool_allowlist',
    ]);
  });

  it('touches no durable table the harness still reads', () => {
    const { db, exec } = makeFakeDb();

    migration.up(db);

    const joined = exec.mock.calls.map(call => String(call[0])).join('\n');
    for (const durable of [
      'agent_runs',
      'agent_run_steps',
      'agent_run_eval_labels',
      'session_events',
      'chat_messages',
      'chat_threads',
      'chat_thread_todos',
      'mcp_servers',
      'proactive_tasks',
      'awaiters',
    ]) {
      expect(joined).not.toContain(durable);
    }
  });

  it('does not drop the MCP per-server tool_allowlist column', () => {
    const { db, exec } = makeFakeDb();

    migration.up(db);

    // `mcp_servers.tool_allowlist` is a live per-server tool filter with a
    // settings UI. Only the standalone learned-rule TABLE is dead; a migration
    // that also touched the column would silently widen every MCP server's
    // exposed tool set.
    const statements = exec.mock.calls.map(call => String(call[0])).join('\n');
    expect(statements).not.toContain('ALTER TABLE');
    expect(statements).not.toContain('mcp_servers');
  });

  it('is idempotent by statement form so a re-run cannot fail', () => {
    const { db, exec } = makeFakeDb();

    migration.up(db);

    for (const call of exec.mock.calls) {
      expect(String(call[0])).toContain('DROP TABLE IF EXISTS');
    }
  });
});
