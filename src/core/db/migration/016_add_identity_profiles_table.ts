import { getDb } from '../database';
import { Migration } from './runner';

export const migration: Migration = {
  name: '016_add_identity_profiles_table',
  up: () => {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS identity_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        self_description TEXT NOT NULL DEFAULT '',
        owner_name TEXT NOT NULL DEFAULT '',
        relationship_to_owner TEXT NOT NULL DEFAULT '',
        core_values TEXT,
        boundaries TEXT,
        tone_guidance TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 0,
        metadata TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_identity_profiles_updated_at
        ON identity_profiles(updated_at DESC);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_profiles_single_active
        ON identity_profiles(active)
        WHERE active = 1;
    `);
  },
  down: () => {
    getDb().exec(`
      DROP INDEX IF EXISTS idx_identity_profiles_single_active;
      DROP INDEX IF EXISTS idx_identity_profiles_updated_at;
      DROP TABLE IF EXISTS identity_profiles;
    `);
  },
};

