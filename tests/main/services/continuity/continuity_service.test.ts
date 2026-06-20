import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getAppConfigMock,
  getChatThreadMock,
  upsertAssistantProfileMock,
  searchContinuityItemsMock,
  touchContinuityItemsMock,
  findContinuityItemByExactSummaryMock,
  upsertContinuityItemMock,
  addContinuityEvidenceMock,
  getOrCreateActiveIdentityProfileMock,
  extractTextFromMessageJsonMock,
  getIdentityBrainDocumentsMock,
  loggerEventMock,
} = vi.hoisted(() => ({
  getAppConfigMock: vi.fn(),
  getChatThreadMock: vi.fn(),
  upsertAssistantProfileMock: vi.fn(),
  searchContinuityItemsMock: vi.fn(),
  touchContinuityItemsMock: vi.fn(),
  findContinuityItemByExactSummaryMock: vi.fn(),
  upsertContinuityItemMock: vi.fn(),
  addContinuityEvidenceMock: vi.fn(),
  getOrCreateActiveIdentityProfileMock: vi.fn(),
  extractTextFromMessageJsonMock: vi.fn(),
  getIdentityBrainDocumentsMock: vi.fn(),
  loggerEventMock: vi.fn(),
}));

vi.mock('@iki/backend/config', () => ({
  getAppConfig: getAppConfigMock,
}));

vi.mock('@iki/backend/db/chat_thread', () => ({
  getChatThread: getChatThreadMock,
}));

vi.mock('@iki/backend/db/continuity', () => ({
  upsertAssistantProfile: upsertAssistantProfileMock,
  searchContinuityItems: searchContinuityItemsMock,
  touchContinuityItems: touchContinuityItemsMock,
  findContinuityItemByExactSummary: findContinuityItemByExactSummaryMock,
  upsertContinuityItem: upsertContinuityItemMock,
  addContinuityEvidence: addContinuityEvidenceMock,
}));

vi.mock('@iki/backend/db/memory', () => ({
  extractTextFromMessageJson: extractTextFromMessageJsonMock,
}));

vi.mock('../../../../packages/desktop/src/main/services/identity/identity_service', () => ({
  getOrCreateActiveIdentityProfile: getOrCreateActiveIdentityProfileMock,
}));

vi.mock('../../../../packages/desktop/src/main/services/identity/identity_brain', () => ({
  getIdentityBrainDocuments: getIdentityBrainDocumentsMock,
}));

vi.mock('@iki/backend/logger', () => ({
  createLogger: vi.fn(() => ({
    event: loggerEventMock,
  })),
}));

import {
  getAssistantProfileContextMessage,
  onMessagePersisted,
  retrieveRelevantContinuity,
} from '../../../../packages/desktop/src/main/services/continuity/continuity_service';

const baseConfig = {
  continuity: {
    enabled: true,
    autoCaptureExplicitFacts: true,
    injectToSystemPrompt: true,
    maxRetrievedItems: 2,
  },
};

const activeIdentity = {
  id: 'identity_1',
  name: 'iKi',
  self_description: 'Grounded execution partner.',
  owner_name: 'Nina',
  owner_role_description: 'owner',
  core_values: '["be direct","preserve continuity"]',
  boundaries: '["do not bluff"]',
  tone_guidance: 'Calm and concise.',
  active: 1,
  metadata: null,
  created_at: '2026-04-06T00:00:00.000Z',
  updated_at: '2026-04-06T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  getAppConfigMock.mockReturnValue(baseConfig);
  getChatThreadMock.mockReturnValue({ id: 'thread_1', is_incognito: 0 });
  getOrCreateActiveIdentityProfileMock.mockReturnValue(activeIdentity);
  getIdentityBrainDocumentsMock.mockReturnValue({
    iki: 'Keep replies grounded in explicit evidence.',
    owner: '',
    threadContext: '',
  });
  upsertAssistantProfileMock.mockImplementation((entry: Record<string, unknown>) => ({
    id: 'assistant_1',
    created_at: '2026-04-06T00:00:00.000Z',
    updated_at: '2026-04-06T00:00:00.000Z',
    role_summary: '',
    owner_display_name: '',
    tone_guidance: '',
    hard_boundaries_json: null,
    collaboration_style_json: null,
    metadata_json: null,
    ...entry,
  }));
  searchContinuityItemsMock.mockReturnValue([]);
  extractTextFromMessageJsonMock.mockReturnValue(null);
  findContinuityItemByExactSummaryMock.mockReturnValue(null);
  upsertContinuityItemMock.mockImplementation((entry: Record<string, unknown>) => ({
    id: 'continuity_1',
    created_at: '2026-04-06T00:00:00.000Z',
    updated_at: '2026-04-06T00:00:00.000Z',
    ...entry,
  }));
});

describe('continuity_service', () => {
  it('builds the assistant profile prompt context from the active identity profile and local brain notes', () => {
    const message = getAssistantProfileContextMessage();

    expect(upsertAssistantProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        profile_id: 'identity_1',
        display_name: 'iKi',
        role_summary: 'Grounded execution partner.',
        owner_display_name: 'Nina',
        tone_guidance: 'Calm and concise.',
        hard_boundaries_json: '["do not bluff"]',
        collaboration_style_json: '["be direct","preserve continuity"]',
      })
    );
    expect(message).toContain('Assistant profile for iKi:');
    expect(message).toContain('- Name: iKi');
    expect(message).toContain('- Role: Grounded execution partner.');
    expect(message).toContain('- Owner label: Nina');
    expect(message).toContain('- Tone guidance: Calm and concise.');
    expect(message).toContain('- Collaboration style:');
    expect(message).toContain('  - be direct');
    expect(message).toContain('- Hard boundaries:');
    expect(message).toContain('  - do not bluff');
    expect(message).toContain('Keep replies grounded in explicit evidence.');

    const metadataJson = upsertAssistantProfileMock.mock.calls[0]?.[0]?.metadata_json;
    expect(JSON.parse(String(metadataJson))).toEqual({
      legacyIdentityProfileId: 'identity_1',
      identityOwnerRoleDescription: 'owner',
    });
  });

  it('retrieves confirmed continuity items into one ranked payload', () => {
    searchContinuityItemsMock.mockReturnValue([
      {
        id: 'continuity_1',
        profile_id: 'identity_1',
        kind: 'preference',
        title: 'Preferred address',
        summary: 'Call the owner Nina.',
        status: 'confirmed',
        confidence: 1,
        priority: 0.8,
        scope: 'global',
        source_kind: 'manual',
        created_at: '2026-04-06T00:00:00.000Z',
        updated_at: '2026-04-06T01:00:00.000Z',
        score: 0.91,
        evidence_count: 2,
      },
      {
        id: 'continuity_2',
        profile_id: 'identity_1',
        kind: 'workflow_rule',
        title: 'Workflow rule',
        summary: 'Prefer direct technical critique over reassurance.',
        status: 'confirmed',
        confidence: 1,
        priority: 0.8,
        scope: 'global',
        source_kind: 'manual',
        created_at: '2026-04-06T00:00:00.000Z',
        updated_at: '2026-04-06T01:30:00.000Z',
        score: 0.82,
        evidence_count: 1,
      },
    ]);

    const payload = retrieveRelevantContinuity('  continuity docs  ');

    expect(payload).not.toBeNull();
    expect(payload?.query).toBe('continuity docs');
    expect(payload?.results.map(entry => entry.id)).toEqual(['continuity_1', 'continuity_2']);
    expect(payload?.systemMessage).toContain('Durable continuity context');
    expect(payload?.systemMessage).toContain('preference: Call the owner Nina.');
    expect(touchContinuityItemsMock).toHaveBeenCalledWith(['continuity_1', 'continuity_2']);
  });

  it('captures explicit user-declared facts into confirmed continuity items with evidence', async () => {
    extractTextFromMessageJsonMock.mockReturnValue({
      role: 'user',
      content: '我的名字是 Nina。',
    });
    upsertContinuityItemMock.mockReturnValue({
      id: 'continuity_1',
      profile_id: 'identity_1',
      kind: 'owner_fact',
      title: 'Owner name',
      summary: "The owner's name is Nina.",
      status: 'confirmed',
      confidence: 1,
      priority: 1,
      scope: 'global',
      source_kind: 'explicit_message',
      created_at: '2026-04-06T00:00:00.000Z',
      updated_at: '2026-04-06T00:00:00.000Z',
    });

    await onMessagePersisted({
      threadId: 'thread_1',
      messageId: 'msg_1',
      messageJson: '{"role":"user","content":"我的名字是 Nina。"}',
    });

    expect(upsertContinuityItemMock).toHaveBeenCalledWith(
      expect.objectContaining({
        profile_id: 'identity_1',
        kind: 'owner_fact',
        title: 'Owner name',
        summary: "The owner's name is Nina.",
        status: 'confirmed',
        confidence: 1,
        priority: 1,
        scope: 'global',
        source_kind: 'explicit_message',
        source_ref: expect.stringContaining('message:msg_1:owner_fact:'),
      })
    );
    expect(
      JSON.parse(String(upsertContinuityItemMock.mock.calls[0]?.[0]?.metadata_json))
    ).toEqual({
      extractor: 'continuity-explicit-v1',
      threadId: 'thread_1',
      messageId: 'msg_1',
    });
    expect(addContinuityEvidenceMock).toHaveBeenCalledWith({
      item_id: 'continuity_1',
      thread_id: 'thread_1',
      message_id: 'msg_1',
      excerpt: '我的名字是 Nina。',
      extractor_version: 'continuity-explicit-v1',
    });
    expect(loggerEventMock).not.toHaveBeenCalled();
  });

  it('skips automatic continuity capture for incognito threads', async () => {
    getChatThreadMock.mockReturnValue({ id: 'thread_secret', is_incognito: 1 });
    extractTextFromMessageJsonMock.mockReturnValue({
      role: 'user',
      content: 'my name is Nina',
    });

    await onMessagePersisted({
      threadId: 'thread_secret',
      messageId: 'msg_secret',
      messageJson: '{"role":"user","content":"my name is Nina"}',
    });

    expect(upsertContinuityItemMock).not.toHaveBeenCalled();
    expect(addContinuityEvidenceMock).not.toHaveBeenCalled();
  });
});
