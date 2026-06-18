import { getDb } from '../database';
import { Migration } from './runner';

const columnExists = (tableName: string, columnName: string): boolean => {
  const rows = getDb().prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  return rows.some(row => row.name === columnName);
};

export const migration: Migration = {
  name: '022_add_chat_tool_approval_max_output_tokens',
  up: () => {
    if (!columnExists('chat_tool_approval_sessions', 'max_output_tokens')) {
      getDb().exec(
        'ALTER TABLE chat_tool_approval_sessions ADD COLUMN max_output_tokens INTEGER DEFAULT NULL;'
      );
    }
  },
  down: () => {
    // SQLite does not support DROP COLUMN; keep max_output_tokens if it exists.
  },
};
