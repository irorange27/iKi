import { getDb } from '../database';
import { Migration } from './runner';

const columnExists = (tableName: string, columnName: string): boolean => {
  const rows = getDb().prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  return rows.some(row => row.name === columnName);
};

export const migration: Migration = {
  name: '020_add_chat_tool_approval_skill_ids',
  up: () => {
    if (!columnExists('chat_tool_approval_sessions', 'available_skill_ids')) {
      getDb().exec(
        "ALTER TABLE chat_tool_approval_sessions ADD COLUMN available_skill_ids TEXT NOT NULL DEFAULT '[]';"
      );
    }

    getDb().exec(`
      UPDATE chat_tool_approval_sessions
      SET available_skill_ids = '[]'
      WHERE available_skill_ids IS NULL OR TRIM(available_skill_ids) = '';
    `);
  },
  down: () => {
    // SQLite does not support DROP COLUMN; keep available_skill_ids if it exists.
  },
};
