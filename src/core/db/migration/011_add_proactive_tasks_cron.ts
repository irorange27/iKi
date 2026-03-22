import { getDb } from '../database';
import { Migration } from './runner';

const columnExists = (table: string, column: string): boolean => {
  const rows = getDb()
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name?: string }>;
  return rows.some(row => row.name === column);
};

export const migration: Migration = {
  name: '011_add_proactive_tasks_cron',
  aliases: ['010_add_proactive_tasks_cron'],
  up: () => {
    if (!columnExists('proactive_tasks', 'cron_expression')) {
      getDb().exec('ALTER TABLE proactive_tasks ADD COLUMN cron_expression TEXT;');
    }
    if (!columnExists('proactive_tasks', 'schedule_timezone')) {
      getDb().exec('ALTER TABLE proactive_tasks ADD COLUMN schedule_timezone TEXT;');
    }
  },
  down: () => {
    // SQLite does not support DROP COLUMN; keep cron_expression/schedule_timezone if they exist.
  },
};
