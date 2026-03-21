import { beforeEach, describe, expect, it, vi } from 'vitest';

type ReflectionRow = Record<string, unknown> | null;

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock('../../../src/core/db/database', () => ({
  getDb: getDbMock,
}));

describe('life reflection db helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('inserts and reloads a life reflection by period window', async () => {
    let reflectionRow: ReflectionRow = null;
    const prepareMock = vi.fn((sql: string) => {
      if (sql.includes('SELECT * FROM life_reflections') && sql.includes('period_start = ?')) {
        return {
          get: vi.fn(() => reflectionRow),
        };
      }

      if (sql.includes('INSERT INTO life_reflections')) {
        return {
          run: vi.fn((params: Record<string, unknown>) => {
            reflectionRow = params;
          }),
        };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    });

    getDbMock.mockReturnValue({
      prepare: prepareMock,
    });

    const { addLifeReflection } = await import('../../../src/core/db/life_reflection');
    const reflection = addLifeReflection({
      profile_id: 'identity_1',
      period_type: 'hour',
      period_start: '2026-03-21T08:00:00.000Z',
      period_end: '2026-03-21T09:00:00.000Z',
      summary: 'Morning planning stabilized into focused work.',
      insights_json: '["Focus windows are strongest after wake-up."]',
      plan_json: '["Finish the open task before new exploration."]',
    });

    expect(reflection).toEqual(
      expect.objectContaining({
        profile_id: 'identity_1',
        period_type: 'hour',
        summary: 'Morning planning stabilized into focused work.',
      })
    );
  });

  it('lists reflections ordered by recent period end', async () => {
    const prepareMock = vi.fn((sql: string) => {
      if (sql.includes('ORDER BY period_end DESC')) {
        return {
          all: vi.fn(() => [
            {
              id: 'reflection_2',
              profile_id: 'identity_1',
              period_type: 'hour',
              period_start: '2026-03-21T09:00:00.000Z',
              period_end: '2026-03-21T10:00:00.000Z',
              summary: 'Later reflection',
              insights_json: '[]',
              plan_json: '[]',
              created_at: '2026-03-21T10:01:00.000Z',
            },
            {
              id: 'reflection_1',
              profile_id: 'identity_1',
              period_type: 'hour',
              period_start: '2026-03-21T08:00:00.000Z',
              period_end: '2026-03-21T09:00:00.000Z',
              summary: 'Earlier reflection',
              insights_json: '[]',
              plan_json: '[]',
              created_at: '2026-03-21T09:01:00.000Z',
            },
          ]),
        };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    });

    getDbMock.mockReturnValue({
      prepare: prepareMock,
    });

    const { listLifeReflections } = await import('../../../src/core/db/life_reflection');
    const list = listLifeReflections({ profileId: 'identity_1', limit: 5 });

    expect(list.map(entry => entry.id)).toEqual(['reflection_2', 'reflection_1']);
  });
});
