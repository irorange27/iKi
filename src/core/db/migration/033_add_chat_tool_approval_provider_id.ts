import { getDb } from '../database';
import { Migration } from './runner';

const columnExists = (tableName: string, columnName: string): boolean => {
  const rows = getDb().prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  return rows.some(row => row.name === columnName);
};

export const migration: Migration = {
  name: '033_add_chat_tool_approval_provider_id',
  up: () => {
    if (!columnExists('chat_tool_approval_sessions', 'provider_id')) {
      getDb().exec(
        'ALTER TABLE chat_tool_approval_sessions ADD COLUMN provider_id TEXT DEFAULT NULL;'
      );
    }
  },
  down: () => {
    // SQLite does not support DROP COLUMN; keep provider_id if it exists.
  },
};
