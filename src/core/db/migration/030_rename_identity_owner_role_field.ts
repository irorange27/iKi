import type { Migration } from './runner';
import { getDb } from '../database';

const getColumnNames = (tableName: string): string[] =>
  (
    getDb().prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
      name?: string;
    }>
  )
    .map(row => (typeof row.name === 'string' ? row.name : ''))
    .filter(Boolean);

const buildOwnerRoleSourceExpression = (columns: string[]): string | null => {
  const hasNewColumn = columns.includes('owner_role_description');
  const hasLegacyColumn = columns.includes('relationship_to_owner');

  if (hasNewColumn && hasLegacyColumn) {
    return `
      CASE
        WHEN TRIM(COALESCE(owner_role_description, '')) <> '' THEN owner_role_description
        ELSE relationship_to_owner
      END
    `;
  }

  if (hasNewColumn) return 'owner_role_description';
  if (hasLegacyColumn) return 'relationship_to_owner';
  return null;
};

const rebuildIdentityProfilesTable = (ownerRoleSourceExpression: string) => {
  getDb().exec('PRAGMA foreign_keys = OFF;');

  try {
    getDb().exec(`
      BEGIN;

      ALTER TABLE identity_profiles RENAME TO identity_profiles_legacy_030;

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
        ${ownerRoleSourceExpression},
        core_values,
        boundaries,
        tone_guidance,
        active,
        metadata,
        created_at,
        updated_at
      FROM identity_profiles_legacy_030;

      DROP TABLE identity_profiles_legacy_030;

      CREATE INDEX IF NOT EXISTS idx_identity_profiles_updated_at
        ON identity_profiles(updated_at DESC);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_profiles_single_active
        ON identity_profiles(active)
        WHERE active = 1;

      COMMIT;
    `);
  } catch (error) {
    try {
      getDb().exec('ROLLBACK;');
    } catch {
      // Ignore rollback errors after a failed migration attempt.
    }
    throw error;
  } finally {
    getDb().exec('PRAGMA foreign_keys = ON;');
  }
};

export const migration: Migration = {
  name: '030_rename_identity_owner_role_field',
  up: () => {
    const columns = getColumnNames('identity_profiles');
    if (columns.length === 0) return;

    const ownerRoleSourceExpression = buildOwnerRoleSourceExpression(columns);
    if (!ownerRoleSourceExpression) return;

    if (columns.includes('owner_role_description') && !columns.includes('relationship_to_owner')) {
      return;
    }

    rebuildIdentityProfilesTable(ownerRoleSourceExpression);
  },
  down: () => {
    // Intentionally no-op. The older column name should not be reintroduced automatically.
  },
};
