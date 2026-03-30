import { getDb } from '../database';
import { Migration } from './runner';

const columnExists = (tableName: string, columnName: string): boolean => {
  const rows = getDb().prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  return rows.some(row => row.name === columnName);
};

export const migration: Migration = {
  name: '026_add_chat_tool_approval_max_iterations',
  up: () => {
    if (!columnExists('chat_tool_approval_sessions', 'max_iterations')) {
      getDb().exec(
        'ALTER TABLE chat_tool_approval_sessions ADD COLUMN max_iterations INTEGER DEFAULT NULL;'
      );
    }
  },
  down: () => {
    // SQLite does not support DROP COLUMN; keep max_iterations if it exists.
  },
};
