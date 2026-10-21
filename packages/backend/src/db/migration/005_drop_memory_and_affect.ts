import type { SqliteDatabase } from '../sqlite';
import type { Migration } from './runner';

// The memory and affect/emotion subsystems are gone: their tables have no
// reader, no writer and no UI surface left. Dropping them here is the data
// half of that removal — leaving them behind would keep a schema that no
// owner claims, and a later `SELECT *` archaeology would misread them as live
// state.
//
// What is NOT dropped:
// - `chat_thread_context` (thread summary projection) is unrelated to memory.
// - `chat_messages` / `session_events` / `agent_runs` are the durable record.
//
// Idempotent by construction: `DROP TABLE IF EXISTS` is a no-op on a database
// that already ran this migration, and the runner records the name so a
// second run never reaches it anyway.
const MEMORY_TABLES = ['memory_short', 'memory_long', 'emotion_events', 'affect_states'];

const migration: Migration = {
  name: '005_drop_memory_and_affect',
  up: (db: SqliteDatabase) => {
    for (const table of MEMORY_TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${table}`);
    }
  },
};

export { migration };
