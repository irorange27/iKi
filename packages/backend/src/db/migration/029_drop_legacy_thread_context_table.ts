import type { Migration } from './runner';
import { getDb } from '../database';

export const migration: Migration = {
  name: '029_drop_legacy_thread_context_table',
  up: () => {
    getDb().exec(`
      DROP INDEX IF EXISTS idx_relationship_states_recent;
      DROP INDEX IF EXISTS idx_relationship_states_scope;
      DROP TABLE IF EXISTS relationship_states;
    `);
  },
  down: () => {
    getDb().exec('SELECT 1;');
  },
};
