import { getDb } from '../database';
import type { Migration } from './runner';

// Tool calls are no longer a chat-scoped concept (programmatic tool calling),
// so the approval tables drop the chat_ prefix. Fresh databases already get
// the new names from the 001 baseline; this migration only renames the tables
// and indexes of databases created before the rename. ALTER TABLE keeps all
// rows; SQLite rewrites the renamed indexes' table references automatically,
// so the old-named indexes are recreated under their new names.
const migration: Migration = {
  name: '002_rename_chat_tool_approvals',
  up: () => {
    const tableExists = (name: string): boolean =>
      Boolean(
        getDb()
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
          )
          .get(name)
      );

    if (tableExists('chat_tool_approval_sessions')) {
      if (tableExists('tool_call_approval_sessions')) {
        throw new Error(
          'Migration 002: both chat_tool_approval_sessions and tool_call_approval_sessions exist'
        );
      }
      getDb().exec(
        'ALTER TABLE chat_tool_approval_sessions RENAME TO tool_call_approval_sessions'
      );
    }
    if (tableExists('chat_tool_approvals')) {
      if (tableExists('tool_call_approvals')) {
        throw new Error(
          'Migration 002: both chat_tool_approvals and tool_call_approvals exist'
        );
      }
      getDb().exec('ALTER TABLE chat_tool_approvals RENAME TO tool_call_approvals');
    }

    getDb().exec(`
      DROP INDEX IF EXISTS idx_chat_tool_approval_sessions_run_id;
      DROP INDEX IF EXISTS idx_chat_tool_approval_sessions_thread_id;
      DROP INDEX IF EXISTS idx_chat_tool_approvals_session_id;
      DROP INDEX IF EXISTS idx_chat_tool_approvals_state;
      CREATE INDEX IF NOT EXISTS idx_tool_call_approval_sessions_run_id
          ON tool_call_approval_sessions(run_id);
      CREATE INDEX IF NOT EXISTS idx_tool_call_approval_sessions_thread_id
          ON tool_call_approval_sessions(thread_id);
      CREATE INDEX IF NOT EXISTS idx_tool_call_approvals_session_id
          ON tool_call_approvals(session_id);
      CREATE INDEX IF NOT EXISTS idx_tool_call_approvals_state
          ON tool_call_approvals(state);
    `);
  },
};

export { migration };
