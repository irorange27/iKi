import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state, execMock, prepareMock, repairIdentityProfileForeignKeysMock } = vi.hoisted(() => {
  const state = {
    columns: [] as string[],
    legacyColumns: [] as string[],
    tables: new Set<string>(),
  };

  const execMock = vi.fn();
  const prepareMock = vi.fn((sql: string) => {
    if (sql === "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?") {
      return {
        get: (name: string) => (state.tables.has(name) ? { name } : undefined),
      };
    }

    if (sql === 'PRAGMA table_info(identity_profiles)') {
      return {
        all: () => state.columns.map(name => ({ name })),
      };
    }

    if (sql === 'PRAGMA table_info(identity_profiles_legacy_030)') {
      return {
        all: () => state.legacyColumns.map(name => ({ name })),
      };
    }

    throw new Error(`Unexpected SQL in 030 migration test: ${sql}`);
  });

  return {
    state,
    execMock,
    prepareMock,
    repairIdentityProfileForeignKeysMock: vi.fn(),
  };
});

vi.mock('../../../src/core/db/database', () => ({
  getDb: () => ({
    exec: execMock,
    prepare: prepareMock,
  }),
}));

vi.mock('../../../src/core/db/migration/identity_profile_foreign_key_repair', () => ({
  repairIdentityProfileForeignKeys: repairIdentityProfileForeignKeysMock,
}));

describe('030_rename_identity_owner_role_field migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    state.columns = [];
    state.legacyColumns = [];
    state.tables = new Set<string>();
  });

  it('rebuilds identity_profiles when the legacy relationship column still exists', async () => {
    state.columns = [
      'id',
      'name',
      'self_description',
      'owner_name',
      'relationship_to_owner',
      'core_values',
      'boundaries',
      'tone_guidance',
      'active',
      'metadata',
      'created_at',
      'updated_at',
    ];
    state.tables = new Set<string>(['identity_profiles']);

    const { migration } = await import(
      '../../../src/core/db/migration/030_rename_identity_owner_role_field'
    );

    migration.up();

    expect(execMock).toHaveBeenNthCalledWith(1, 'PRAGMA foreign_keys = OFF;');
    expect(execMock).toHaveBeenNthCalledWith(2, 'BEGIN;');
    expect(execMock).toHaveBeenNthCalledWith(
      3,
      'ALTER TABLE identity_profiles RENAME TO identity_profiles_legacy_030;'
    );
    expect(execMock).toHaveBeenNthCalledWith(4, expect.stringContaining('owner_role_description'));
    expect(execMock).toHaveBeenNthCalledWith(4, expect.stringContaining('relationship_to_owner'));
    expect(execMock).toHaveBeenNthCalledWith(5, 'COMMIT;');
    expect(execMock).toHaveBeenNthCalledWith(6, 'PRAGMA foreign_keys = ON;');
    expect(repairIdentityProfileForeignKeysMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the identity table already uses the owner-role field name', async () => {
    state.columns = [
      'id',
      'name',
      'self_description',
      'owner_name',
      'owner_role_description',
      'core_values',
      'boundaries',
      'tone_guidance',
      'active',
      'metadata',
      'created_at',
      'updated_at',
    ];
    state.tables = new Set<string>(['identity_profiles']);

    const { migration } = await import(
      '../../../src/core/db/migration/030_rename_identity_owner_role_field'
    );

    migration.up();

    expect(execMock).not.toHaveBeenCalled();
    expect(repairIdentityProfileForeignKeysMock).not.toHaveBeenCalled();
  });

  it('resumes from the legacy temporary table when a previous rebuild stopped mid-migration', async () => {
    state.legacyColumns = [
      'id',
      'name',
      'self_description',
      'owner_name',
      'relationship_to_owner',
      'core_values',
      'boundaries',
      'tone_guidance',
      'active',
      'metadata',
      'created_at',
      'updated_at',
    ];
    state.tables = new Set<string>(['identity_profiles_legacy_030']);

    const { migration } = await import(
      '../../../src/core/db/migration/030_rename_identity_owner_role_field'
    );

    migration.up();

    expect(execMock).toHaveBeenNthCalledWith(1, 'PRAGMA foreign_keys = OFF;');
    expect(execMock).toHaveBeenNthCalledWith(2, 'BEGIN;');
    expect(execMock).toHaveBeenCalledWith(
      expect.stringContaining('FROM identity_profiles_legacy_030')
    );
    expect(execMock).toHaveBeenNthCalledWith(4, 'COMMIT;');
    expect(execMock).toHaveBeenNthCalledWith(5, 'PRAGMA foreign_keys = ON;');
    expect(repairIdentityProfileForeignKeysMock).toHaveBeenCalledTimes(1);
  });
});
