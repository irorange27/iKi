import { getDb } from '../database';
import { Migration } from './runner';

export const migration: Migration = {
  name: '012_add_chat_tool_approval_tables',
  aliases: ['011_add_chat_tool_approval_tables'],
  up: () => {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS chat_tool_approval_sessions (
        session_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        assistant_message_id TEXT NOT NULL,
        provider_type TEXT NOT NULL,
        model TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        enabled_tools TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chat_tool_approval_sessions_thread_id
      ON chat_tool_approval_sessions(thread_id);

      CREATE TABLE IF NOT EXISTS chat_tool_approvals (
        approval_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        tool_call_id TEXT,
        tool_name TEXT,
        tool_args TEXT,
        state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending', 'answered', 'consumed')),
        decision TEXT CHECK(decision IN ('approved', 'rejected')),
        decision_reason TEXT,
        responded_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES chat_tool_approval_sessions(session_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chat_tool_approvals_session_id
      ON chat_tool_approvals(session_id);

      CREATE INDEX IF NOT EXISTS idx_chat_tool_approvals_state
      ON chat_tool_approvals(state);
    `);
  },
  down: () => {
    getDb().exec(`
      DROP TABLE IF EXISTS chat_tool_approvals;
      DROP TABLE IF EXISTS chat_tool_approval_sessions;
    `);
  },
};
