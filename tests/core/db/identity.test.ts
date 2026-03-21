import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock('../../../src/core/db/database', () => ({
  getDb: getDbMock,
}));

describe('identity db helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('inserts a new active identity profile and clears prior active flags first', async () => {
    const runMock = vi.fn();
    const getMock = vi.fn().mockReturnValue({
      id: 'identity_1',
      name: 'iKi Core',
      active: 1,
    });
    const prepareMock = vi.fn(() => ({
      run: runMock,
      get: getMock,
      all: vi.fn(),
    }));
    const transactionMock = vi.fn((fn: () => unknown) => fn);

    getDbMock.mockReturnValue({
      prepare: prepareMock,
      transaction: transactionMock,
    });

    const { addIdentityProfile } = await import('../../../src/core/db/identity');
    const result = addIdentityProfile({
      name: 'iKi Core',
      active: true,
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'identity_1',
        name: 'iKi Core',
        active: 1,
      })
    );
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(prepareMock).toHaveBeenNthCalledWith(
      1,
      'UPDATE identity_profiles SET active = 0 WHERE active != 0'
    );
    expect(prepareMock).toHaveBeenCalledWith(
      'SELECT * FROM identity_profiles WHERE id = ?'
    );
  });

  it('returns the current active identity profile', async () => {
    const prepareMock = vi.fn(() => ({
      get: vi.fn().mockReturnValue({
        id: 'identity_active',
        name: 'iKi Core',
        active: 1,
      }),
      all: vi.fn(),
      run: vi.fn(),
    }));

    getDbMock.mockReturnValue({
      prepare: prepareMock,
      transaction: vi.fn((fn: () => unknown) => fn),
    });

    const { getActiveIdentityProfile } = await import('../../../src/core/db/identity');
    const result = getActiveIdentityProfile();

    expect(result).toEqual(
      expect.objectContaining({
        id: 'identity_active',
        active: 1,
      })
    );
    expect(prepareMock).toHaveBeenCalledWith(
      'SELECT * FROM identity_profiles WHERE active = 1 ORDER BY updated_at DESC LIMIT 1'
    );
  });
});
