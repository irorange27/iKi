import type Database from 'better-sqlite3';
import { getDb } from '../database';

const LEGACY_IDENTITY_TABLE = 'identity_profiles_legacy_030';
const ASSISTANT_PROFILES_LEGACY_TABLE = 'assistant_profiles_legacy_032';
const CONTINUITY_ITEMS_LEGACY_TABLE = 'continuity_items_legacy_032';
const CONTINUITY_EVIDENCE_LEGACY_TABLE = 'continuity_evidence_legacy_032';

const tableExists = (database: Database.Database, tableName: string): boolean =>
  Boolean(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName)
  );

const getForeignKeyTargets = (database: Database.Database, tableName: string): string[] => {
  if (!tableExists(database, tableName)) return [];

  return (
    database.prepare(`PRAGMA foreign_key_list(${tableName})`).all() as Array<{
      table?: string;
    }>
  )
    .map(row => (typeof row.table === 'string' ? row.table : ''))
    .filter(Boolean);
};

const createAssistantProfilesTable = (database: Database.Database) => {
  database.exec(`
    CREATE TABLE assistant_profiles (
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
  `);
};

const createContinuityItemsTable = (database: Database.Database) => {
  database.exec(`
    CREATE TABLE continuity_items (
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
  `);
};

const createContinuityEvidenceTable = (database: Database.Database) => {
  database.exec(`
    CREATE TABLE continuity_evidence (
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
};

const rebuildAssistantProfilesIfNeeded = (database: Database.Database) => {
  const assistantProfileTargets = getForeignKeyTargets(database, 'assistant_profiles');
  const needsRepair = assistantProfileTargets.includes(LEGACY_IDENTITY_TABLE);
  const hasLegacyTable = tableExists(database, ASSISTANT_PROFILES_LEGACY_TABLE);

  if (!needsRepair && !hasLegacyTable) return;

  if (!hasLegacyTable && tableExists(database, 'assistant_profiles')) {
    database.exec(
      `ALTER TABLE assistant_profiles RENAME TO ${ASSISTANT_PROFILES_LEGACY_TABLE};`
    );
  }

  database.exec(`
    DROP INDEX IF EXISTS idx_assistant_profiles_updated;
    DROP TABLE IF EXISTS assistant_profiles;
  `);
  createAssistantProfilesTable(database);

  if (tableExists(database, ASSISTANT_PROFILES_LEGACY_TABLE)) {
    database.exec(`
      INSERT INTO assistant_profiles (
        id,
        profile_id,
        display_name,
        role_summary,
        owner_display_name,
        tone_guidance,
        hard_boundaries_json,
        collaboration_style_json,
        metadata_json,
        created_at,
        updated_at
      )
      SELECT
        id,
        profile_id,
        display_name,
        role_summary,
        owner_display_name,
        tone_guidance,
        hard_boundaries_json,
        collaboration_style_json,
        metadata_json,
        created_at,
        updated_at
      FROM ${ASSISTANT_PROFILES_LEGACY_TABLE};

      DROP TABLE ${ASSISTANT_PROFILES_LEGACY_TABLE};
    `);
  }
};

const rebuildContinuityTablesIfNeeded = (database: Database.Database) => {
  const continuityItemTargets = getForeignKeyTargets(database, 'continuity_items');
  const needsRepair = continuityItemTargets.includes(LEGACY_IDENTITY_TABLE);
  const hasLegacyItemsTable = tableExists(database, CONTINUITY_ITEMS_LEGACY_TABLE);
  const hasLegacyEvidenceTable = tableExists(database, CONTINUITY_EVIDENCE_LEGACY_TABLE);

  if (!needsRepair && !hasLegacyItemsTable && !hasLegacyEvidenceTable) return;

  if (!hasLegacyEvidenceTable && tableExists(database, 'continuity_evidence')) {
    database.exec(
      `ALTER TABLE continuity_evidence RENAME TO ${CONTINUITY_EVIDENCE_LEGACY_TABLE};`
    );
  }

  if (!hasLegacyItemsTable && tableExists(database, 'continuity_items')) {
    database.exec(`ALTER TABLE continuity_items RENAME TO ${CONTINUITY_ITEMS_LEGACY_TABLE};`);
  }

  database.exec(`
    DROP INDEX IF EXISTS idx_continuity_evidence_item;
    DROP INDEX IF EXISTS idx_continuity_items_source_ref;
    DROP INDEX IF EXISTS idx_continuity_items_kind;
    DROP INDEX IF EXISTS idx_continuity_items_profile_status;
    DROP TABLE IF EXISTS continuity_evidence;
    DROP TABLE IF EXISTS continuity_items;
  `);

  createContinuityItemsTable(database);
  if (tableExists(database, CONTINUITY_ITEMS_LEGACY_TABLE)) {
    database.exec(`
      INSERT INTO continuity_items (
        id,
        profile_id,
        kind,
        title,
        summary,
        status,
        confidence,
        priority,
        scope,
        subject_key,
        source_kind,
        source_ref,
        first_seen_at,
        last_confirmed_at,
        last_used_at,
        metadata_json,
        created_at,
        updated_at
      )
      SELECT
        id,
        profile_id,
        kind,
        title,
        summary,
        status,
        confidence,
        priority,
        scope,
        subject_key,
        source_kind,
        source_ref,
        first_seen_at,
        last_confirmed_at,
        last_used_at,
        metadata_json,
        created_at,
        updated_at
      FROM ${CONTINUITY_ITEMS_LEGACY_TABLE};
    `);
  }

  createContinuityEvidenceTable(database);
  if (tableExists(database, CONTINUITY_EVIDENCE_LEGACY_TABLE)) {
    database.exec(`
      INSERT INTO continuity_evidence (
        id,
        item_id,
        thread_id,
        message_id,
        excerpt,
        extractor_version,
        created_at
      )
      SELECT
        id,
        item_id,
        thread_id,
        message_id,
        excerpt,
        extractor_version,
        created_at
      FROM ${CONTINUITY_EVIDENCE_LEGACY_TABLE};
    `);
  }

  database.exec(`
    DROP TABLE IF EXISTS ${CONTINUITY_EVIDENCE_LEGACY_TABLE};
    DROP TABLE IF EXISTS ${CONTINUITY_ITEMS_LEGACY_TABLE};
  `);
};

export const repairIdentityProfileForeignKeys = (
  database: Database.Database = getDb()
): void => {
  const hasRepairWork =
    getForeignKeyTargets(database, 'assistant_profiles').includes(LEGACY_IDENTITY_TABLE) ||
    getForeignKeyTargets(database, 'continuity_items').includes(LEGACY_IDENTITY_TABLE) ||
    tableExists(database, ASSISTANT_PROFILES_LEGACY_TABLE) ||
    tableExists(database, CONTINUITY_ITEMS_LEGACY_TABLE) ||
    tableExists(database, CONTINUITY_EVIDENCE_LEGACY_TABLE);

  if (!hasRepairWork) return;

  database.exec('PRAGMA foreign_keys = OFF;');

  try {
    database.exec('BEGIN;');
    rebuildAssistantProfilesIfNeeded(database);
    rebuildContinuityTablesIfNeeded(database);
    database.exec('COMMIT;');
  } catch (error) {
    try {
      database.exec('ROLLBACK;');
    } catch {
      // Ignore rollback errors after a failed migration attempt.
    }
    throw error;
  } finally {
    database.exec('PRAGMA foreign_keys = ON;');
  }
};
