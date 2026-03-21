import { beforeEach, describe, expect, it, vi } from 'vitest';

type LifeStateRow = Record<string, unknown> | null;
type LifeEpisodeRow = Record<string, unknown> | null;

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock('../../../src/core/db/database', () => ({
  getDb: getDbMock,
}));

describe('life db helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('upserts a life state row and reloads it by profile id', async () => {
    let stateRow: LifeStateRow = null;
    const prepareMock = vi.fn((sql: string) => {
      if (sql.includes('SELECT * FROM life_state WHERE profile_id = ?')) {
        return {
          get: vi.fn(() => stateRow),
        };
      }

      if (sql.includes('INSERT INTO life_state')) {
        return {
          run: vi.fn((params: Record<string, unknown>) => {
            stateRow = {
              ...params,
              current_episode_id: params.current_episode_id ?? null,
              next_review_at: params.next_review_at ?? null,
              sleep_window_json: params.sleep_window_json ?? null,
              state_json: params.state_json ?? null,
            };
          }),
        };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    });

    getDbMock.mockReturnValue({
      prepare: prepareMock,
      transaction: vi.fn((fn: () => unknown) => fn),
    });

    const { upsertLifeState } = await import('../../../src/core/db/life');
    const state = upsertLifeState({
      profile_id: 'identity_1',
      current_activity: 'companion_idle',
      presence: 'available',
      energy: 0.7,
      focus_budget: 0.8,
      social_availability: 0.9,
      current_episode_id: 'episode_1',
      next_review_at: '2026-03-21T12:15:00.000Z',
      sleep_window_json: '{"startHour":1,"endHour":9}',
      policy_version: 'life-kernel-v1',
      state_json: '{"dayPhase":"day"}',
    });

    expect(state).toEqual(
      expect.objectContaining({
        profile_id: 'identity_1',
        current_activity: 'companion_idle',
        presence: 'available',
        current_episode_id: 'episode_1',
      })
    );
  });

  it('adds and lists life episodes in reverse chronological order', async () => {
    const episodes: LifeEpisodeRow[] = [];
    const prepareMock = vi.fn((sql: string) => {
      if (sql.includes('SELECT * FROM life_episodes WHERE id = ?')) {
        return {
          get: vi.fn((id: string) => episodes.find(entry => entry?.id === id) || null),
        };
      }

      if (sql.includes('SELECT * FROM life_episodes') && sql.includes('LIMIT ?')) {
        return {
          all: vi.fn(() =>
            [...episodes].sort((left, right) =>
              String(right?.started_at || '').localeCompare(String(left?.started_at || ''))
            )
          ),
        };
      }

      if (sql.includes('INSERT INTO life_episodes')) {
        return {
          run: vi.fn((params: Record<string, unknown>) => {
            episodes.push(params);
          }),
        };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    });

    getDbMock.mockReturnValue({
      prepare: prepareMock,
      transaction: vi.fn((fn: () => unknown) => fn),
    });

    const { addLifeEpisode, listLifeEpisodes } = await import('../../../src/core/db/life');

    addLifeEpisode({
      id: 'episode_old',
      profile_id: 'identity_1',
      activity_type: 'companion_idle',
      presence: 'available',
      started_at: '2026-03-21T08:00:00.000Z',
      transition_reason: 'idle-available',
    });
    addLifeEpisode({
      id: 'episode_new',
      profile_id: 'identity_1',
      activity_type: 'focused_work',
      presence: 'focused',
      started_at: '2026-03-21T09:00:00.000Z',
      transition_reason: 'task-running',
    });

    expect(listLifeEpisodes('identity_1', 5).map(entry => entry.id)).toEqual([
      'episode_new',
      'episode_old',
    ]);
  });

  it('queries windowed episodes with open-episode overlap semantics', async () => {
    const prepareMock = vi.fn((sql: string) => {
      if (sql.includes('SELECT * FROM life_episodes') && sql.includes('ended_at IS NULL OR ended_at >= ?')) {
        return {
          all: vi.fn(() => [
            {
              id: 'episode_open',
              profile_id: 'identity_1',
              activity_type: 'companion_idle',
              presence: 'available',
              started_at: '2026-03-21T07:30:00.000Z',
              ended_at: null,
              transition_reason: 'idle-available',
              summary: 'Available during the hour.',
              trigger_type: 'tick',
              trigger_ref: 'tick',
              thread_id: null,
              client_id: null,
              task_id: null,
              snapshot_json: '{}',
              created_at: '2026-03-21T07:30:00.000Z',
              updated_at: '2026-03-21T07:30:00.000Z',
            },
          ]),
        };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    });

    getDbMock.mockReturnValue({
      prepare: prepareMock,
      transaction: vi.fn((fn: () => unknown) => fn),
    });

    const { listLifeEpisodesInWindow } = await import('../../../src/core/db/life');
    const rows = listLifeEpisodesInWindow(
      'identity_1',
      '2026-03-21T08:00:00.000Z',
      '2026-03-21T09:00:00.000Z'
    );

    expect(rows.map(entry => entry.id)).toEqual(['episode_open']);
  });
});
