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

import {
  buildIdentitySystemMessage,
  getIdentityContextMessage,
} from '../../../../src/main/services/identity/identity_service';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('identity_service', () => {
  it('builds a compact identity system message from the stored profile', () => {
    const message = buildIdentitySystemMessage({
      id: 'identity_default',
      name: 'iKi Core',
      self_description: 'A grounded personal AI brain.',
      owner_name: 'Nina',
      relationship_to_owner: 'trusted companion',
      core_values: '["truthful","privacy-preserving"]',
      boundaries: '["Do not fabricate embodiment."]',
      tone_guidance: 'Calm and thoughtful.',
      active: 1,
      metadata: null,
      created_at: '2026-03-21T00:00:00.000Z',
      updated_at: '2026-03-21T00:00:00.000Z',
    });

    expect(message).toContain('Identity profile for iKi:');
    expect(message).toContain('- Name: iKi Core');
    expect(message).toContain('- Owner label: Nina');
    expect(message).toContain('truthful');
    expect(message).toContain('Do not fabricate embodiment.');
  });

  it('creates a default active profile when none exists', () => {
    getActiveIdentityProfileMock.mockReturnValueOnce(null).mockReturnValueOnce({
      id: 'identity_default',
      name: 'iKi Core',
      self_description: 'Default identity.',
      owner_name: 'the user',
      relationship_to_owner: 'trusted personal AI companion.',
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
      relationship_to_owner: 'trusted personal AI companion.',
      core_values: '["truthful"]',
      boundaries: '["Do not fabricate embodiment."]',
      tone_guidance: 'Grounded.',
      active: 1,
      metadata: null,
      created_at: '2026-03-21T00:00:00.000Z',
      updated_at: '2026-03-21T00:00:00.000Z',
    });

    const message = getIdentityContextMessage();

    expect(addIdentityProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'iKi Core',
        active: true,
      })
    );
    expect(message).toContain('Identity profile for iKi:');
  });
});

