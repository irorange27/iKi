import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state, execMock, prepareMock } = vi.hoisted(() => {
  const state = {
    columns: [] as string[],
  };

  const execMock = vi.fn();
  const prepareMock = vi.fn((sql: string) => {
    if (sql === 'PRAGMA table_info(identity_profiles)') {
      return {
        all: () => state.columns.map(name => ({ name })),
      };
    }

    throw new Error(`Unexpected SQL in 030 migration test: ${sql}`);
  });

  return {
    state,
    execMock,
    prepareMock,
  };
});

vi.mock('../../../src/core/db/database', () => ({
  getDb: () => ({
    exec: execMock,
    prepare: prepareMock,
  }),
}));

describe('030_rename_identity_owner_role_field migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    state.columns = [];
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

    const { migration } = await import(
      '../../../src/core/db/migration/030_rename_identity_owner_role_field'
    );

    migration.up();

    expect(execMock).toHaveBeenNthCalledWith(1, 'PRAGMA foreign_keys = OFF;');
    expect(execMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('owner_role_description')
    );
    expect(execMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('relationship_to_owner')
    );
    expect(execMock).toHaveBeenNthCalledWith(3, 'PRAGMA foreign_keys = ON;');
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

    const { migration } = await import(
      '../../../src/core/db/migration/030_rename_identity_owner_role_field'
    );

    migration.up();

    expect(execMock).not.toHaveBeenCalled();
  });
});
