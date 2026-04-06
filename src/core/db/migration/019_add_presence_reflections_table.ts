import type { Migration } from './runner';
import { getDb } from '../database';

export const migration: Migration = {
  name: '019_add_presence_reflections_table',
  up: () => {
    getDb().exec(`
      DROP TABLE IF EXISTS life_reflections;

      CREATE TABLE IF NOT EXISTS presence_reflections (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        period_type TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        summary TEXT NOT NULL,
        insights_json TEXT,
        plan_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (profile_id) REFERENCES identity_profiles(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_presence_reflections_window
        ON presence_reflections(profile_id, period_type, period_start);

      CREATE INDEX IF NOT EXISTS idx_presence_reflections_recent
        ON presence_reflections(profile_id, period_end DESC);
    `);
  },
  down: () => {
    getDb().exec('DROP TABLE IF EXISTS presence_reflections;');
  },
};
