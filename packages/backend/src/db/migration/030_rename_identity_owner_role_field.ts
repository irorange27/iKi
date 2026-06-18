import type { Migration } from './runner';
import { getDb } from '../database';
import { repairIdentityProfileForeignKeys } from './identity_profile_foreign_key_repair';

const CURRENT_TABLE = 'identity_profiles';
const LEGACY_TABLE = 'identity_profiles_legacy_030';

const tableExists = (tableName: string): boolean =>
  Boolean(
    getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName)
  );

const getColumnNames = (tableName: string): string[] => {
  if (!tableExists(tableName)) return [];

  return (
    getDb().prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
      name?: string;
    }>
  )
    .map(row => (typeof row.name === 'string' ? row.name : ''))
    .filter(Boolean);
};

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

const rebuildIdentityProfilesTable = (
  sourceTableName: typeof CURRENT_TABLE | typeof LEGACY_TABLE,
  ownerRoleSourceExpression: string
) => {
  getDb().exec('PRAGMA foreign_keys = OFF;');

  try {
    getDb().exec('BEGIN;');

    if (sourceTableName === CURRENT_TABLE && !tableExists(LEGACY_TABLE)) {
      getDb().exec(`ALTER TABLE ${CURRENT_TABLE} RENAME TO ${LEGACY_TABLE};`);
    }

    getDb().exec(`
      DROP INDEX IF EXISTS idx_identity_profiles_single_active;
      DROP INDEX IF EXISTS idx_identity_profiles_updated_at;
      DROP TABLE IF EXISTS ${CURRENT_TABLE};

      CREATE TABLE ${CURRENT_TABLE} (
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

      INSERT INTO ${CURRENT_TABLE} (
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
      FROM ${LEGACY_TABLE};

      DROP TABLE ${LEGACY_TABLE};

      CREATE INDEX IF NOT EXISTS idx_identity_profiles_updated_at
        ON ${CURRENT_TABLE}(updated_at DESC);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_profiles_single_active
        ON ${CURRENT_TABLE}(active)
        WHERE active = 1;
    `);

    getDb().exec('COMMIT;');
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
    const sourceTableName = tableExists(LEGACY_TABLE) ? LEGACY_TABLE : CURRENT_TABLE;
    const columns = getColumnNames(sourceTableName);
    if (columns.length === 0) return;

    const ownerRoleSourceExpression = buildOwnerRoleSourceExpression(columns);
    if (!ownerRoleSourceExpression) return;

    const currentColumns = getColumnNames(CURRENT_TABLE);
    if (
      sourceTableName === CURRENT_TABLE &&
      currentColumns.includes('owner_role_description') &&
      !currentColumns.includes('relationship_to_owner')
    ) {
      return;
    }

    rebuildIdentityProfilesTable(sourceTableName, ownerRoleSourceExpression);
    repairIdentityProfileForeignKeys();
  },
  down: () => {
    // Intentionally no-op. The older column name should not be reintroduced automatically.
  },
};
