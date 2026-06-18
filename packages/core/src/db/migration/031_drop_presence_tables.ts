import type { Migration } from './runner';
import { getDb } from '../database';

export const migration: Migration = {
  name: '031_drop_presence_tables',
  up: () => {
    getDb().exec(`
      DROP TABLE IF EXISTS presence_reflections;
      DROP TABLE IF EXISTS presence_state;
      DROP TABLE IF EXISTS presence_episodes;
    `);
  },
  down: () => {
    // Presence was intentionally removed without replacement.
  },
};
