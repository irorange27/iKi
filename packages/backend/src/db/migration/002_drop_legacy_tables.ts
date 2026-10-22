import type { SqliteDatabase } from '../sqlite';
import type { Migration } from './runner';

// Tables that no code reads any more. Some were created by an earlier baseline,
// some by the pre-squash migration sequence; both kinds can survive in a database
// that predates this file, so drop them by name rather than assuming absence.
const LEGACY_TABLES = [
  'tool_call_approvals',
  'tool_call_approval_sessions',
  'chat_tool_approvals',
  'chat_tool_approval_sessions',
  'chat_messages',
  'chat_thread_todos',
  'chat_thread_context',
  'todo_items',
  'todo_lists',
  'continuity_evidence',
  'continuity_items',
  'identity_profiles',
  'assistant_profiles',
  'awaiter_wake_events',
  'agent_run_checkpoints',
  'tool_allowlist',
  'clipboard_snapshots',
  'memory_short',
  'memory_long',
  'emotion_events',
  'affect_states',
];

const migration: Migration = {
  name: '002_drop_legacy_tables',
  up: (db: SqliteDatabase) => {
    for (const table of LEGACY_TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${table}`);
    }
  },
};

export { migration };
