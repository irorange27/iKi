import { beforeEach, describe, expect, it, vi } from 'vitest';

type RelationshipRow = Record<string, unknown> | null;

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock('../../../src/core/db/database', () => ({
  getDb: getDbMock,
}));

describe('relationship db helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('upserts and reloads a relationship state by scope', async () => {
    let relationshipRow: RelationshipRow = null;
    const prepareMock = vi.fn((sql: string) => {
      if (sql.includes('SELECT * FROM relationship_states') && sql.includes('scope_id = ?')) {
        return {
          get: vi.fn(() => relationshipRow),
        };
      }

      if (sql.includes('INSERT INTO relationship_states')) {
        return {
          run: vi.fn((params: Record<string, unknown>) => {
            relationshipRow = params;
          }),
        };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    });

    getDbMock.mockReturnValue({
      prepare: prepareMock,
    });

    const { upsertRelationshipState } = await import('../../../src/core/db/relationship');
    const record = upsertRelationshipState({
      profile_id: 'identity_1',
      scope_type: 'thread',
      scope_id: 'thread_1',
      source_kind: 'desktop-owner-thread',
      subject_label: 'Desktop Thread',
      relationship_summary: 'Direct owner conversation.',
      preferred_address: 'Speak directly to the owner.',
      metadata: '{"source":"desktop"}',
    });

    expect(record).toEqual(
      expect.objectContaining({
        profile_id: 'identity_1',
        scope_type: 'thread',
        scope_id: 'thread_1',
        source_kind: 'desktop-owner-thread',
      })
    );
  });

  it('lists relationship states ordered by recent interaction', async () => {
    const prepareMock = vi.fn((sql: string) => {
      if (sql.includes('ORDER BY COALESCE(last_interaction_at, updated_at) DESC')) {
        return {
          all: vi.fn(() => [
            {
              id: 'relationship_2',
              profile_id: 'identity_1',
              scope_type: 'thread',
              scope_id: 'thread_2',
              source_kind: 'napcat-group',
              subject_label: 'QQ Group 30003',
              relationship_summary: 'Group context.',
              preferred_address: '',
              boundaries_json: null,
              notes_json: null,
              metadata: null,
              last_interaction_at: '2026-03-21T10:00:00.000Z',
              created_at: '2026-03-21T10:00:00.000Z',
              updated_at: '2026-03-21T10:00:00.000Z',
            },
            {
              id: 'relationship_1',
              profile_id: 'identity_1',
              scope_type: 'thread',
              scope_id: 'thread_1',
              source_kind: 'desktop-owner-thread',
              subject_label: 'Desktop Thread',
              relationship_summary: 'Owner conversation.',
              preferred_address: '',
              boundaries_json: null,
              notes_json: null,
              metadata: null,
              last_interaction_at: '2026-03-21T09:00:00.000Z',
              created_at: '2026-03-21T09:00:00.000Z',
              updated_at: '2026-03-21T09:00:00.000Z',
            },
          ]),
        };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    });

    getDbMock.mockReturnValue({
      prepare: prepareMock,
    });

    const { listRelationshipStates } = await import('../../../src/core/db/relationship');
    const list = listRelationshipStates({ profileId: 'identity_1', scopeType: 'thread', limit: 5 });

    expect(list.map(entry => entry.id)).toEqual(['relationship_2', 'relationship_1']);
  });
});
