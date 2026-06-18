import { getDb } from '../database';
import { Migration } from './runner';

export const migration: Migration = {
  name: '037_add_proactive_task_provider_id',
  up: () => {
    const columns = getDb()
      .prepare("PRAGMA table_info('proactive_tasks')")
      .all() as Array<{ name?: string }>;
    const hasProviderId = columns.some(column => column.name === 'provider_id');

    if (!hasProviderId) {
      getDb().exec('ALTER TABLE proactive_tasks ADD COLUMN provider_id TEXT;');
    }
  },
  down: () => {
    // SQLite does not support DROP COLUMN. Keep provider_id if it exists.
  },
};
