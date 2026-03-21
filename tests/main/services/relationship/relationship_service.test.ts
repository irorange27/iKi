import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getChatThreadMock,
  getRelationshipStateMock,
  upsertRelationshipStateMock,
  listRelationshipStatesMock,
  getOrCreateActiveIdentityProfileMock,
} = vi.hoisted(() => ({
  getChatThreadMock: vi.fn(),
  getRelationshipStateMock: vi.fn(),
  upsertRelationshipStateMock: vi.fn(),
  listRelationshipStatesMock: vi.fn(),
  getOrCreateActiveIdentityProfileMock: vi.fn(),
}));

vi.mock('../../../../src/core/db/chat_thread', () => ({
  getChatThread: getChatThreadMock,
}));

vi.mock('../../../../src/core/db/relationship', () => ({
  getRelationshipState: getRelationshipStateMock,
  upsertRelationshipState: upsertRelationshipStateMock,
  listRelationshipStates: listRelationshipStatesMock,
}));

vi.mock('../../../../src/main/services/identity/identity_service', () => ({
  getOrCreateActiveIdentityProfile: getOrCreateActiveIdentityProfileMock,
}));

describe('relationship_service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrCreateActiveIdentityProfileMock.mockReturnValue({
      id: 'identity_1',
      name: 'iKi Core',
      self_description: '',
      owner_name: 'Nina',
      relationship_to_owner: 'trusted companion',
      core_values: '[]',
      boundaries: '[]',
      tone_guidance: '',
      active: 1,
      metadata: null,
      created_at: '2026-03-21T00:00:00.000Z',
      updated_at: '2026-03-21T00:00:00.000Z',
    });
    getChatThreadMock.mockReturnValue({
      id: 'thread_group',
      title: 'QQ Group 30003',
      model: 'gpt-4.1',
      is_generating: false,
      reasoning_effort: 'medium',
      metadata: JSON.stringify({
        source: 'napcat',
        message_type: 'group',
        group_id: '30003',
      }),
      created_at: '2026-03-21T00:00:00.000Z',
      updated_at: '2026-03-21T00:00:00.000Z',
      client_id: 'client_napcat',
      prompt_app_id: null,
      tools: null,
      is_favorited: 0,
      is_incognito: 0,
      workspace_id: null,
      enable_artifacts: 0,
      artifact_workspace_id: null,
      skill_ids: null,
    });
    getRelationshipStateMock.mockReturnValue(null);
    upsertRelationshipStateMock.mockImplementation((entry: Record<string, unknown>) => ({
      id: 'relationship_1',
      created_at: '2026-03-21T00:00:00.000Z',
      updated_at: '2026-03-21T00:00:00.000Z',
      boundaries_json: null,
      notes_json: null,
      last_interaction_at: null,
      ...entry,
    }));
    listRelationshipStatesMock.mockReturnValue([]);
  });

  it('seeds a group-thread relationship from bridge metadata', async () => {
    const { ensureThreadRelationshipState } = await import(
      '../../../../src/main/services/relationship/relationship_service'
    );

    const state = ensureThreadRelationshipState('thread_group');

    expect(getRelationshipStateMock).toHaveBeenCalledWith('identity_1', 'thread', 'thread_group');
    expect(upsertRelationshipStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        profile_id: 'identity_1',
        scope_type: 'thread',
        scope_id: 'thread_group',
        source_kind: 'napcat-group',
        subject_label: 'QQ Group 30003',
      })
    );
    expect(state?.relationship_summary).toContain('shared group context');
  });

  it('touches a thread relationship with the latest interaction timestamp', async () => {
    getRelationshipStateMock.mockReturnValue({
      id: 'relationship_existing',
      profile_id: 'identity_1',
      scope_type: 'thread',
      scope_id: 'thread_group',
      source_kind: 'napcat-group',
      subject_label: 'QQ Group 30003',
      relationship_summary: 'Group context.',
      preferred_address: '',
      boundaries_json: null,
      notes_json: null,
      metadata: '{"source":"napcat"}',
      last_interaction_at: null,
      created_at: '2026-03-21T00:00:00.000Z',
      updated_at: '2026-03-21T00:00:00.000Z',
    });

    const { touchThreadRelationshipState } = await import(
      '../../../../src/main/services/relationship/relationship_service'
    );

    touchThreadRelationshipState('thread_group', '2026-03-21T12:00:00.000Z');

    expect(upsertRelationshipStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'relationship_existing',
        last_interaction_at: '2026-03-21T12:00:00.000Z',
      })
    );
  });

  it('builds a relationship context message for the active thread', async () => {
    upsertRelationshipStateMock.mockReturnValue({
      id: 'relationship_1',
      profile_id: 'identity_1',
      scope_type: 'thread',
      scope_id: 'thread_group',
      source_kind: 'napcat-group',
      subject_label: 'QQ Group 30003',
      relationship_summary: 'QQ group thread. Treat it as shared group context.',
      preferred_address: 'Address the group briefly.',
      boundaries_json: '["Do not assume every participant is the owner."]',
      notes_json: '["Recent discussion was about planning."]',
      metadata: '{"source":"napcat"}',
      last_interaction_at: '2026-03-21T12:00:00.000Z',
      created_at: '2026-03-21T00:00:00.000Z',
      updated_at: '2026-03-21T12:00:00.000Z',
    });

    const { getRelationshipContextMessage } = await import(
      '../../../../src/main/services/relationship/relationship_service'
    );

    const message = getRelationshipContextMessage('thread_group');

    expect(message).toContain('Relationship context for iKi:');
    expect(message).toContain('Owner baseline: trusted companion');
    expect(message).toContain('Current thread: QQ Group 30003');
    expect(message).toContain('Thread kind: napcat-group');
    expect(message).toContain('Address the group briefly.');
    expect(message).toContain('Do not assume every participant is the owner.');
  });

  it('returns owner baseline and recent states in the relationship overview', async () => {
    listRelationshipStatesMock.mockReturnValue([
      {
        id: 'relationship_1',
        profile_id: 'identity_1',
        scope_type: 'thread',
        scope_id: 'thread_group',
        source_kind: 'napcat-group',
        subject_label: 'QQ Group 30003',
        relationship_summary: 'Group context.',
        preferred_address: '',
        boundaries_json: null,
        notes_json: null,
        metadata: null,
        last_interaction_at: '2026-03-21T12:00:00.000Z',
        created_at: '2026-03-21T00:00:00.000Z',
        updated_at: '2026-03-21T12:00:00.000Z',
      },
    ]);

    const { getRelationshipOverview } = await import(
      '../../../../src/main/services/relationship/relationship_service'
    );

    const overview = getRelationshipOverview(4);

    expect(overview.owner).toEqual({
      owner_label: 'Nina',
      relationship_to_owner: 'trusted companion',
    });
    expect(overview.recentStates).toHaveLength(1);
  });
});
