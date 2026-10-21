import { describe, expect, it, vi } from 'vitest';

import { migration } from '@iki/backend/db/migration/005_drop_memory_and_affect';
import type { SqliteDatabase } from '@iki/backend/db/sqlite';

// The memory + affect/emotion subsystems are gone; this migration is the data
// half of that removal. It must name exactly the four orphaned tables — a
// missing one leaves a table no owner claims, and an extra one would drop
// durable state (chat_messages, session_events, chat_thread_context) that the
// harness still reads.
const makeFakeDb = () => {
  const exec = vi.fn();
  return { db: { exec } as unknown as SqliteDatabase, exec };
};

describe('005_drop_memory_and_affect', () => {
  it('drops every memory and affect table', () => {
    const { db, exec } = makeFakeDb();

    migration.up(db);

    const statements = exec.mock.calls.map(call => String(call[0]));
    expect(statements).toEqual([
      'DROP TABLE IF EXISTS memory_short',
      'DROP TABLE IF EXISTS memory_long',
      'DROP TABLE IF EXISTS emotion_events',
      'DROP TABLE IF EXISTS affect_states',
    ]);
  });

  it('touches no durable table the harness still reads', () => {
    const { db, exec } = makeFakeDb();

    migration.up(db);

    const joined = exec.mock.calls.map(call => String(call[0])).join('\n');
    for (const durable of [
      'chat_messages',
      'chat_threads',
      'session_events',
      'agent_runs',
      'chat_thread_context',
    ]) {
      expect(joined).not.toContain(durable);
    }
  });

  it('is idempotent by statement form so a re-run cannot fail', () => {
    const { db, exec } = makeFakeDb();

    migration.up(db);

    for (const call of exec.mock.calls) {
      expect(String(call[0])).toContain('DROP TABLE IF EXISTS');
    }
  });
});
