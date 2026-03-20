import { getDb } from '../database';
import { Migration } from './runner';

const columnExists = (tableName: string, columnName: string): boolean => {
  const rows = getDb().prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  return rows.some(row => row.name === columnName);
};

export const migration: Migration = {
  name: '014_add_proactive_task_tool_mode',
  up: () => {
    if (!columnExists('proactive_tasks', 'tool_mode')) {
      getDb().exec(
        "ALTER TABLE proactive_tasks ADD COLUMN tool_mode TEXT NOT NULL DEFAULT 'auto';"
      );
    }

    getDb().exec(`
      UPDATE proactive_tasks
      SET tool_mode = CASE
        WHEN tools IS NOT NULL AND TRIM(tools) != '' AND TRIM(tools) != '[]' THEN 'manual'
        ELSE 'auto'
      END
      WHERE tool_mode IS NULL
         OR TRIM(tool_mode) = ''
         OR tool_mode NOT IN ('auto', 'manual', 'disabled');
    `);
  },
  down: () => {
    // SQLite does not support DROP COLUMN; keep tool_mode if it exists.
  },
};
