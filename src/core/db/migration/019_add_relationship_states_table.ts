import type { Migration } from './runner';
import { getDb } from '../database';

export const migration: Migration = {
  name: '019_add_relationship_states_table',
  up: () => {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS relationship_states (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        source_kind TEXT NOT NULL DEFAULT 'unknown-thread',
        subject_label TEXT NOT NULL DEFAULT '',
        relationship_summary TEXT NOT NULL DEFAULT '',
        preferred_address TEXT NOT NULL DEFAULT '',
        boundaries_json TEXT,
        notes_json TEXT,
        metadata TEXT,
        last_interaction_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (profile_id) REFERENCES identity_profiles(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_relationship_states_scope
        ON relationship_states(profile_id, scope_type, scope_id);

      CREATE INDEX IF NOT EXISTS idx_relationship_states_recent
        ON relationship_states(profile_id, last_interaction_at DESC, updated_at DESC);
    `);
  },
  down: () => {
    getDb().exec(`
      DROP INDEX IF EXISTS idx_relationship_states_recent;
      DROP INDEX IF EXISTS idx_relationship_states_scope;
      DROP TABLE IF EXISTS relationship_states;
    `);
  },
};
