import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getActiveIdentityProfileMock,
  addIdentityProfileMock,
} = vi.hoisted(() => ({
  getActiveIdentityProfileMock: vi.fn(),
  addIdentityProfileMock: vi.fn(),
}));

vi.mock('../../../../src/core/db/identity', () => ({
  getActiveIdentityProfile: getActiveIdentityProfileMock,
  addIdentityProfile: addIdentityProfileMock,
}));

import { getOrCreateActiveIdentityProfile } from '../../../../src/main/services/identity/identity_service';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('identity_service', () => {
  it('returns the existing active profile without rewriting it', () => {
    const existing = {
      id: 'identity_existing',
      name: 'Existing',
      self_description: 'Existing identity.',
      owner_name: 'Nina',
      owner_role_description: 'trusted personal AI companion.',
      core_values: '["truthful"]',
      boundaries: '["Do not fabricate embodiment."]',
      tone_guidance: 'Grounded.',
      active: 1,
      metadata: null,
      created_at: '2026-03-21T00:00:00.000Z',
      updated_at: '2026-03-21T00:00:00.000Z',
    };
    getActiveIdentityProfileMock.mockReturnValue(existing);

    const profile = getOrCreateActiveIdentityProfile();

    expect(profile).toEqual(existing);
    expect(addIdentityProfileMock).not.toHaveBeenCalled();
  });

  it('creates a default active profile when none exists', () => {
    getActiveIdentityProfileMock.mockReturnValueOnce(null).mockReturnValueOnce({
      id: 'identity_default',
      name: 'iKi Core',
      self_description: 'Default identity.',
      owner_name: 'the user',
      owner_role_description: 'trusted personal AI companion.',
      core_values: '["truthful"]',
      boundaries: '["Do not fabricate embodiment."]',
      tone_guidance: 'Grounded.',
      active: 1,
      metadata: null,
      created_at: '2026-03-21T00:00:00.000Z',
      updated_at: '2026-03-21T00:00:00.000Z',
    });
    addIdentityProfileMock.mockReturnValue({
      id: 'identity_default',
      name: 'iKi Core',
      self_description: 'Default identity.',
      owner_name: 'the user',
      owner_role_description: 'trusted personal AI companion.',
      core_values: '["truthful"]',
      boundaries: '["Do not fabricate embodiment."]',
      tone_guidance: 'Grounded.',
      active: 1,
      metadata: null,
      created_at: '2026-03-21T00:00:00.000Z',
      updated_at: '2026-03-21T00:00:00.000Z',
    });

    const profile = getOrCreateActiveIdentityProfile();

    expect(addIdentityProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'iKi Core',
        active: true,
      })
    );
    expect(profile).toEqual(
      expect.objectContaining({
        id: 'identity_default',
        name: 'iKi Core',
      })
    );
  });
});
