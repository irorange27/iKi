import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PresenceEpisodeRecord, PresenceStateRecord } from '../../../../src/shared/types/presence';

const {
  getOrCreateActiveIdentityProfileMock,
  listDueProactiveTasksMock,
  getProactiveTasksMock,
  listPresenceReflectionsMock,
  runDueHourlyRuntimeReflectionsMock,
  runDueDailyRuntimeReflectionsMock,
} = vi.hoisted(() => ({
  getOrCreateActiveIdentityProfileMock: vi.fn(),
  listDueProactiveTasksMock: vi.fn(),
  getProactiveTasksMock: vi.fn(),
  listPresenceReflectionsMock: vi.fn(),
  runDueHourlyRuntimeReflectionsMock: vi.fn(),
  runDueDailyRuntimeReflectionsMock: vi.fn(),
}));

let currentState: PresenceStateRecord | null = null;
let episodes: PresenceEpisodeRecord[] = [];

const localDate = (hour: number, minute = 0) => new Date(2026, 2, 21, hour, minute, 0, 0);
const toLocalTimestamp = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

vi.mock('../../../../src/main/services/identity/identity_service', () => ({
  getOrCreateActiveIdentityProfile: getOrCreateActiveIdentityProfileMock,
}));

vi.mock('../../../../src/core/db/tasks', () => ({
  listDueProactiveTasks: listDueProactiveTasksMock,
  getProactiveTasks: getProactiveTasksMock,
}));

vi.mock('../../../../src/core/db/presence', () => ({
  runPresenceTransaction: (fn: () => unknown) => fn(),
  getPresenceState: vi.fn(() => currentState),
  upsertPresenceState: vi.fn((params: Partial<PresenceStateRecord> & { profile_id: string }) => {
    currentState = {
      id: currentState?.id || 'life_1',
      created_at: currentState?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      current_episode_id: null,
      next_review_at: null,
      sleep_window_json: null,
      state_json: null,
      ...currentState,
      ...params,
    } as PresenceStateRecord;
    return currentState;
  }),
  addPresenceEpisode: vi.fn((params: Partial<PresenceEpisodeRecord> & { profile_id: string }) => {
    const episode: PresenceEpisodeRecord = {
      id: params.id || `episode_${episodes.length + 1}`,
      profile_id: params.profile_id,
      activity_type: params.activity_type || 'companion_idle',
      presence: params.presence || 'available',
      started_at: params.started_at || new Date().toISOString(),
      ended_at: params.ended_at ?? null,
      transition_reason: params.transition_reason || 'idle-available',
      summary: params.summary ?? null,
      trigger_type: params.trigger_type ?? null,
      trigger_ref: params.trigger_ref ?? null,
      thread_id: params.thread_id ?? null,
      client_id: params.client_id ?? null,
      task_id: params.task_id ?? null,
      snapshot_json: params.snapshot_json ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    episodes.push(episode);
    return episode;
  }),
  getPresenceEpisode: vi.fn((id: string) => episodes.find(entry => entry.id === id) || null),
  updatePresenceEpisode: vi.fn((id: string, updates: Partial<PresenceEpisodeRecord>) => {
    episodes = episodes.map(entry =>
      entry.id === id ? { ...entry, ...updates, updated_at: new Date().toISOString() } : entry
    );
    return { changes: 1 };
  }),
  listPresenceEpisodes: vi.fn((_profileId: string, limit: number) => episodes.slice(-limit).reverse()),
}));

vi.mock('../../../../src/core/db/presence_reflection', () => ({
  listPresenceReflections: listPresenceReflectionsMock,
}));

vi.mock('../../../../src/main/services/presence/presence_reflection', () => ({
  runDueHourlyRuntimeReflections: runDueHourlyRuntimeReflectionsMock,
  runDueDailyRuntimeReflections: runDueDailyRuntimeReflectionsMock,
}));

describe('presence_runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    currentState = null;
    episodes = [];
    getOrCreateActiveIdentityProfileMock.mockReturnValue({
      id: 'identity_1',
      name: 'iKi Core',
      self_description: '',
      owner_name: 'the user',
      owner_role_description: '',
      core_values: '[]',
      boundaries: '[]',
      tone_guidance: '',
      active: 1,
      metadata: null,
      created_at: '2026-03-21T00:00:00.000Z',
      updated_at: '2026-03-21T00:00:00.000Z',
    });
    listDueProactiveTasksMock.mockReturnValue([]);
    getProactiveTasksMock.mockReturnValue([]);
    listPresenceReflectionsMock.mockReturnValue([]);
    runDueHourlyRuntimeReflectionsMock.mockResolvedValue([]);
    runDueDailyRuntimeReflectionsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates an initial truthful idle state on startup', async () => {
    const startedAt = localDate(14, 0);
    vi.setSystemTime(startedAt);
    const { recordPresenceRuntimeEvent, getPresenceContextMessage } = await import(
      '../../../../src/main/services/presence/presence_runtime'
    );

    const snapshot = recordPresenceRuntimeEvent({
      type: 'runtime-start',
      at: toLocalTimestamp(startedAt),
    });

    expect(snapshot?.state.current_activity).toBe('companion_idle');
    expect(snapshot?.state.presence).toBe('available');
    expect(snapshot?.derived.dayPhase).toBe('day');
    expect(snapshot?.currentEpisode?.summary).toContain('Available');
    expect(getPresenceContextMessage()).toContain('Current presence state for iKi:');
  });

  it('stays daemon-safe when BrowserWindow.getAllWindows is unavailable', async () => {
    const electronModule = await import('electron');
    const originalGetAllWindows = electronModule.BrowserWindow.getAllWindows;
    (electronModule.BrowserWindow as { getAllWindows?: unknown }).getAllWindows = undefined;

    try {
      const startedAt = localDate(14, 0);
      vi.setSystemTime(startedAt);
      const { recordPresenceRuntimeEvent } = await import(
        '../../../../src/main/services/presence/presence_runtime'
      );

      const snapshot = recordPresenceRuntimeEvent({
        type: 'runtime-start',
        at: toLocalTimestamp(startedAt),
      });

      expect(snapshot?.state.current_activity).toBe('companion_idle');
      expect(snapshot?.state.presence).toBe('available');
    } finally {
      (electronModule.BrowserWindow as { getAllWindows?: unknown }).getAllWindows =
        originalGetAllWindows;
    }
  });

  it('opens a focused episode during task execution and exits it after completion', async () => {
    const { recordPresenceRuntimeEvent, getPresenceOverview } = await import(
      '../../../../src/main/services/presence/presence_runtime'
    );

    const startedAt = localDate(14, 0);
    vi.setSystemTime(startedAt);
    recordPresenceRuntimeEvent({
      type: 'runtime-start',
      at: toLocalTimestamp(startedAt),
    });

    const focusedAt = localDate(14, 5);
    vi.setSystemTime(focusedAt);
    const focused = recordPresenceRuntimeEvent({
      type: 'task-started',
      at: toLocalTimestamp(focusedAt),
      taskId: 'task_1',
      threadId: 'thread_1',
    });

    expect(focused?.state.current_activity).toBe('focused_work');
    expect(focused?.state.presence).toBe('focused');
    expect(focused?.derived.runningTaskIds).toEqual(['task_1']);
    expect(focused?.currentEpisode?.task_id).toBe('task_1');

    const settledAt = localDate(14, 25);
    vi.setSystemTime(settledAt);
    const settled = recordPresenceRuntimeEvent({
      type: 'task-finished',
      at: toLocalTimestamp(settledAt),
      taskId: 'task_1',
      threadId: 'thread_1',
    });

    expect(settled?.state.current_activity).not.toBe('focused_work');
    expect(settled?.derived.runningTaskIds).toEqual([]);

    const overview = getPresenceOverview(5);
    expect(overview.recentEpisodes.length).toBeGreaterThanOrEqual(2);
    expect(overview.recentEpisodes[0].activity_type).toBe(settled?.state.current_activity);
  });

  it('runs hourly and daily reflection backfill during refresh', async () => {
    const { recordPresenceRuntimeEvent, refreshPresenceRuntime } = await import(
      '../../../../src/main/services/presence/presence_runtime'
    );

    const startedAt = localDate(14, 0);
    vi.setSystemTime(startedAt);
    recordPresenceRuntimeEvent({
      type: 'runtime-start',
      at: toLocalTimestamp(startedAt),
    });

    await refreshPresenceRuntime();

    expect(runDueHourlyRuntimeReflectionsMock).toHaveBeenCalled();
    expect(runDueDailyRuntimeReflectionsMock).toHaveBeenCalled();
  });

  it('stores owner mode and applies it after a running task lock clears', async () => {
    const { recordPresenceRuntimeEvent, setPresenceOwnerMode, getPresenceContextMessage } = await import(
      '../../../../src/main/services/presence/presence_runtime'
    );

    const startedAt = localDate(14, 0);
    vi.setSystemTime(startedAt);
    recordPresenceRuntimeEvent({
      type: 'runtime-start',
      at: toLocalTimestamp(startedAt),
    });

    const focusedAt = localDate(14, 5);
    vi.setSystemTime(focusedAt);
    recordPresenceRuntimeEvent({
      type: 'task-started',
      at: toLocalTimestamp(focusedAt),
      taskId: 'task_1',
      threadId: 'thread_1',
    });

    const deferred = setPresenceOwnerMode('sleep');
    expect(deferred?.state.current_activity).toBe('focused_work');
    expect(deferred?.derived.ownerMode).toBe('sleep');
    expect(deferred?.derived.ownerModeStatus).toBe('deferred');

    const settledAt = localDate(14, 20);
    vi.setSystemTime(settledAt);
    const settled = recordPresenceRuntimeEvent({
      type: 'task-finished',
      at: toLocalTimestamp(settledAt),
      taskId: 'task_1',
      threadId: 'thread_1',
    });

    expect(settled?.state.current_activity).toBe('sleep');
    expect(settled?.state.presence).toBe('sleeping');
    expect(settled?.derived.ownerMode).toBe('sleep');
    expect(settled?.derived.ownerModeStatus).toBe('applied');
    expect(getPresenceContextMessage()).toContain('Owner mode: sleep (applied)');
  });

  it('clears owner mode and opens a new semantic episode even when presence stays available', async () => {
    const { recordPresenceRuntimeEvent, setPresenceOwnerMode, clearPresenceOwnerMode, getPresenceOverview } =
      await import('../../../../src/main/services/presence/presence_runtime');

    const startedAt = localDate(14, 0);
    vi.setSystemTime(startedAt);
    recordPresenceRuntimeEvent({
      type: 'runtime-start',
      at: toLocalTimestamp(startedAt),
    });

    const overrideAt = localDate(14, 3);
    vi.setSystemTime(overrideAt);
    const overridden = setPresenceOwnerMode('available');
    expect(overridden?.derived.ownerMode).toBe('available');
    expect(overridden?.derived.ownerModeStatus).toBe('applied');

    const clearAt = localDate(14, 6);
    vi.setSystemTime(clearAt);
    const cleared = clearPresenceOwnerMode();

    expect(cleared?.derived.ownerModeStatus).toBe('none');
    expect(cleared?.currentEpisode?.transition_reason).toBe('idle-available');

    const overview = getPresenceOverview(5);
    expect(overview.recentEpisodes.length).toBeGreaterThanOrEqual(3);
    expect(overview.recentEpisodes.some(entry => entry.transition_reason === 'owner-mode-available')).toBe(true);
  });
});
