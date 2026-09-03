import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { repairIdentityProfileForeignKeys } from '@iki/backend/db/migration/identity_profile_foreign_key_repair';

const escapeSqlString = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const queryJson = (dbPath: string, sql: string): Array<Record<string, unknown>> => {
  const output = execFileSync('sqlite3', ['-json', dbPath, sql], {
    encoding: 'utf8',
  }).trim();
  return output ? (JSON.parse(output) as Array<Record<string, unknown>>) : [];
};

const execSql = (dbPath: string, sql: string, options?: { enableForeignKeys?: boolean }) => {
  const sqlText = options?.enableForeignKeys ? `PRAGMA foreign_keys = ON;\n${sql}` : sql;
  execFileSync('sqlite3', [dbPath, sqlText], {
    encoding: 'utf8',
  });
};

const createDatabaseAdapter = (dbPath: string) =>
  ({
    exec: (sql: string) => {
      if (
        sql === 'BEGIN;' ||
        sql === 'COMMIT;' ||
        sql === 'ROLLBACK;' ||
        sql === 'PRAGMA foreign_keys = OFF;' ||
        sql === 'PRAGMA foreign_keys = ON;'
      ) {
        return;
      }
      execSql(dbPath, sql);
    },
    prepare: (sql: string) => {
      if (sql === "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?") {
        return {
          get: (tableName: string) =>
            queryJson(
              dbPath,
              `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${escapeSqlString(tableName)}`
            )[0],
        };
      }

      return {
        all: () => queryJson(dbPath, sql),
      };
    },
  }) as never;

const getForeignKeyTargets = (dbPath: string, tableName: string): string[] =>
  queryJson(dbPath, `PRAGMA foreign_key_list(${tableName})`)
    .map(row => (typeof row.table === 'string' ? row.table : ''))
    .filter(Boolean);

describe('identity_profile_foreign_key_repair', () => {
  let tempDir = '';
  let dbPath = '';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iki-identity-fk-repair-'));
    dbPath = path.join(tempDir, 'test.db');

    execSql(
      dbPath,
      `
        PRAGMA foreign_keys = ON;

        CREATE TABLE chat_threads (
          id TEXT PRIMARY KEY
        );

        CREATE TABLE chat_messages (
          id TEXT PRIMARY KEY
        );

        CREATE TABLE identity_profiles (
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

        CREATE INDEX idx_assistant_profiles_updated
          ON assistant_profiles(updated_at DESC);

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

        CREATE INDEX idx_continuity_items_profile_status
          ON continuity_items(profile_id, status, updated_at DESC);

        CREATE INDEX idx_continuity_items_kind
          ON continuity_items(profile_id, kind, updated_at DESC);

        CREATE UNIQUE INDEX idx_continuity_items_source_ref
          ON continuity_items(profile_id, source_ref)
          WHERE source_ref IS NOT NULL;

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

        CREATE INDEX idx_continuity_evidence_item
          ON continuity_evidence(item_id, created_at DESC);

        INSERT INTO chat_threads (id) VALUES ('thread_1');
        INSERT INTO chat_messages (id) VALUES ('message_1');

        INSERT INTO identity_profiles (
          id,
          name,
          self_description,
          owner_name,
          relationship_to_owner,
          core_values,
          boundaries,
          tone_guidance,
          active,
          metadata,
          created_at,
          updated_at
        ) VALUES (
          'identity_1',
          'iKi',
          'Grounded execution partner.',
          'Nina',
          'owner',
          '[]',
          '[]',
          'calm',
          1,
          '{}',
          '2026-04-06T00:00:00.000Z',
          '2026-04-06T00:00:00.000Z'
        );

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
        ) VALUES (
          'assistant_1',
          'identity_1',
          'iKi',
          'Grounded execution partner.',
          'Nina',
          'calm',
          '[]',
          '[]',
          '{}',
          '2026-04-06T00:00:00.000Z',
          '2026-04-06T00:00:00.000Z'
        );

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
        ) VALUES (
          'continuity_1',
          'identity_1',
          'owner_fact',
          'Owner name',
          'The owner''s name is Nina.',
          'confirmed',
          1,
          1,
          'global',
          NULL,
          'manual',
          'source_1',
          NULL,
          NULL,
          NULL,
          '{}',
          '2026-04-06T00:00:00.000Z',
          '2026-04-06T00:00:00.000Z'
        );

        INSERT INTO continuity_evidence (
          id,
          item_id,
          thread_id,
          message_id,
          excerpt,
          extractor_version,
          created_at
        ) VALUES (
          'evidence_1',
          'continuity_1',
          'thread_1',
          'message_1',
          'my name is Nina',
          'continuity-explicit-v1',
          '2026-04-06T00:00:00.000Z'
        );

        PRAGMA foreign_keys = OFF;

        ALTER TABLE identity_profiles RENAME TO identity_profiles_legacy_030;
        ALTER TABLE assistant_profiles RENAME TO assistant_profiles_pre_legacy_fk;
        ALTER TABLE continuity_items RENAME TO continuity_items_pre_legacy_fk;
        ALTER TABLE continuity_evidence RENAME TO continuity_evidence_pre_legacy_fk;

        DROP INDEX idx_assistant_profiles_updated;
        DROP INDEX idx_continuity_items_profile_status;
        DROP INDEX idx_continuity_items_kind;
        DROP INDEX idx_continuity_items_source_ref;
        DROP INDEX idx_continuity_evidence_item;

        CREATE TABLE identity_profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          self_description TEXT NOT NULL DEFAULT '',
          owner_name TEXT NOT NULL DEFAULT '',
          owner_role_description TEXT NOT NULL DEFAULT '',
          core_values TEXT,
          boundaries TEXT,
          tone_guidance TEXT NOT NULL DEFAULT '',
          active INTEGER NOT NULL DEFAULT 0,
          metadata TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        INSERT INTO identity_profiles (
          id,
          name,
          self_description,
          owner_name,
          owner_role_description,
          core_values,
          boundaries,
          tone_guidance,
          active,
          metadata,
          created_at,
          updated_at
        )
        SELECT
          id,
          name,
          self_description,
          owner_name,
          relationship_to_owner,
          core_values,
          boundaries,
          tone_guidance,
          active,
          metadata,
          created_at,
          updated_at
        FROM identity_profiles_legacy_030;

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
          FOREIGN KEY (profile_id) REFERENCES identity_profiles_legacy_030(id) ON DELETE CASCADE
        );

        CREATE INDEX idx_assistant_profiles_updated
          ON assistant_profiles(updated_at DESC);

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
        FROM assistant_profiles_pre_legacy_fk;

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
          FOREIGN KEY (profile_id) REFERENCES identity_profiles_legacy_030(id) ON DELETE CASCADE
        );

        CREATE INDEX idx_continuity_items_profile_status
          ON continuity_items(profile_id, status, updated_at DESC);

        CREATE INDEX idx_continuity_items_kind
          ON continuity_items(profile_id, kind, updated_at DESC);

        CREATE UNIQUE INDEX idx_continuity_items_source_ref
          ON continuity_items(profile_id, source_ref)
          WHERE source_ref IS NOT NULL;

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
        FROM continuity_items_pre_legacy_fk;

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

        CREATE INDEX idx_continuity_evidence_item
          ON continuity_evidence(item_id, created_at DESC);

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
        FROM continuity_evidence_pre_legacy_fk;

        DROP TABLE continuity_evidence_pre_legacy_fk;
        DROP TABLE continuity_items_pre_legacy_fk;
        DROP TABLE assistant_profiles_pre_legacy_fk;

        PRAGMA foreign_keys = ON;
      `
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('rebuilds continuity tables whose foreign keys were silently rewritten to the legacy identity table', () => {
    expect(getForeignKeyTargets(dbPath, 'assistant_profiles')).toContain('identity_profiles_legacy_030');
    expect(getForeignKeyTargets(dbPath, 'continuity_items')).toContain('identity_profiles_legacy_030');

    repairIdentityProfileForeignKeys(createDatabaseAdapter(dbPath));

    expect(getForeignKeyTargets(dbPath, 'assistant_profiles')).toEqual(['identity_profiles']);
    expect(getForeignKeyTargets(dbPath, 'continuity_items')).toEqual(['identity_profiles']);
    expect(getForeignKeyTargets(dbPath, 'continuity_evidence')).toContain('continuity_items');
    expect(queryJson(dbPath, 'PRAGMA foreign_key_check')).toEqual([]);

    expect(
      queryJson(
        dbPath,
        'SELECT profile_id, display_name FROM assistant_profiles ORDER BY id'
      )
    ).toEqual([{ profile_id: 'identity_1', display_name: 'iKi' }]);
    expect(queryJson(dbPath, 'SELECT id FROM continuity_items ORDER BY id')).toEqual([
      { id: 'continuity_1' },
    ]);
    expect(queryJson(dbPath, 'SELECT id FROM continuity_evidence ORDER BY id')).toEqual([
      { id: 'evidence_1' },
    ]);

    execSql(
      dbPath,
      `
        INSERT INTO identity_profiles (
          id,
          name,
          self_description,
          owner_name,
          owner_role_description,
          core_values,
          boundaries,
          tone_guidance,
          active,
          metadata,
          created_at,
          updated_at
        ) VALUES (
          'identity_2',
          'iKi Secondary',
          '',
          '',
          '',
          '[]',
          '[]',
          '',
          0,
          '{}',
          '2026-04-06T00:00:00.000Z',
          '2026-04-06T00:00:00.000Z'
        );

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
        ) VALUES (
          'assistant_2',
          'identity_2',
          'iKi Secondary',
          '',
          '',
          '',
          '[]',
          '[]',
          '{}',
          '2026-04-06T00:00:00.000Z',
          '2026-04-06T00:00:00.000Z'
        );
      `,
      { enableForeignKeys: true }
    );

    expect(queryJson(dbPath, 'SELECT id FROM assistant_profiles ORDER BY id')).toEqual([
      { id: 'assistant_1' },
      { id: 'assistant_2' },
    ]);
  });
});
