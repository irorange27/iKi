import { getDb } from '../database';
import { Migration } from './runner';

const columnExists = (tableName: string, columnName: string): boolean => {
  const rows = getDb().prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  return rows.some(row => row.name === columnName);
};

export const migration: Migration = {
  name: '034_add_chat_tool_approval_max_input_tokens',
  up: () => {
    if (!columnExists('chat_tool_approval_sessions', 'max_input_tokens')) {
      getDb().exec(
        'ALTER TABLE chat_tool_approval_sessions ADD COLUMN max_input_tokens INTEGER DEFAULT NULL;'
      );
    }
  },
  down: () => {
    // SQLite does not support DROP COLUMN; keep max_input_tokens if it exists.
  },
};
