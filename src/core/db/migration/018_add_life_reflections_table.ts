import type { Migration } from './runner';
import { getDb } from '../database';

export const migration: Migration = {
  name: '018_add_life_reflections_table',
  up: () => {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS life_reflections (
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

      CREATE UNIQUE INDEX IF NOT EXISTS idx_life_reflections_window
        ON life_reflections(profile_id, period_type, period_start);

      CREATE INDEX IF NOT EXISTS idx_life_reflections_recent
        ON life_reflections(profile_id, period_end DESC);
    `);
  },
  down: () => {
    getDb().exec('DROP TABLE IF EXISTS life_reflections;');
  },
};
