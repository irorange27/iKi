import type { Migration } from './runner';
import { getDb } from '../database';

export const migration: Migration = {
  name: '028_add_continuity_tables',
  up: () => {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS assistant_profiles (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        role_summary TEXT NOT NULL DEFAULT '',
        owner_display_name TEXT NOT NULL DEFAULT '',
        tone_guidance TEXT NOT NULL DEFAULT '',
        hard_boundaries_json TEXT,
        collaboration_style_json TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (profile_id) REFERENCES identity_profiles(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_assistant_profiles_updated
        ON assistant_profiles(updated_at DESC);

      CREATE TABLE IF NOT EXISTS continuity_items (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'candidate',
        confidence REAL NOT NULL DEFAULT 0,
        priority REAL NOT NULL DEFAULT 0,
        scope TEXT NOT NULL DEFAULT 'global',
        subject_key TEXT,
        source_kind TEXT NOT NULL DEFAULT 'manual',
        source_ref TEXT,
        first_seen_at TEXT,
        last_confirmed_at TEXT,
        last_used_at TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (profile_id) REFERENCES identity_profiles(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_continuity_items_profile_status
        ON continuity_items(profile_id, status, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_continuity_items_kind
        ON continuity_items(profile_id, kind, updated_at DESC);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_continuity_items_source_ref
        ON continuity_items(profile_id, source_ref)
        WHERE source_ref IS NOT NULL;

      CREATE TABLE IF NOT EXISTS continuity_evidence (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        thread_id TEXT,
        message_id TEXT,
        excerpt TEXT NOT NULL,
        extractor_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (item_id) REFERENCES continuity_items(id) ON DELETE CASCADE,
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE SET NULL,
        FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_continuity_evidence_item
        ON continuity_evidence(item_id, created_at DESC);
    `);
  },
  down: () => {
    getDb().exec(`
      DROP INDEX IF EXISTS idx_continuity_evidence_item;
      DROP TABLE IF EXISTS continuity_evidence;
      DROP INDEX IF EXISTS idx_continuity_items_source_ref;
      DROP INDEX IF EXISTS idx_continuity_items_kind;
      DROP INDEX IF EXISTS idx_continuity_items_profile_status;
      DROP TABLE IF EXISTS continuity_items;
      DROP INDEX IF EXISTS idx_assistant_profiles_updated;
      DROP TABLE IF EXISTS assistant_profiles;
    `);
  },
};
