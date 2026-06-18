import type { Migration } from './runner';
import { getDb } from '../database';

export const migration: Migration = {
  name: '020_legacy_thread_context_schema',
  aliases: ['019_add_relationship_states_table', '020_add_relationship_states_table'],
  up: () => {
    // Reserved for migration-name normalization only. The legacy table is explicitly removed later.
    getDb().exec('SELECT 1;');
  },
  down: () => {
    getDb().exec('SELECT 1;');
  },
};
