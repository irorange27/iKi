import { getDb } from '../database';
import { Migration } from './runner';

const columnExists = (tableName: string, columnName: string): boolean => {
  const rows = getDb().prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  return rows.some(row => row.name === columnName);
};

export const migration: Migration = {
  name: '036_add_chat_tool_approval_run_id',
  up: () => {
    if (!columnExists('chat_tool_approval_sessions', 'run_id')) {
      getDb().exec('ALTER TABLE chat_tool_approval_sessions ADD COLUMN run_id TEXT DEFAULT NULL;');
    }

    getDb().exec(`
      CREATE INDEX IF NOT EXISTS idx_chat_tool_approval_sessions_run_id
      ON chat_tool_approval_sessions(run_id);
    `);
  },
  down: () => {
    // SQLite does not support DROP COLUMN; keep run_id if it exists.
  },
};
