import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LifeEpisodeRecord } from '../../../../src/shared/types/life';

const {
  getOrCreateActiveIdentityProfileMock,
  getToolModelMock,
  createSimplePromptTextGeneratorMock,
  getLifeStateMock,
  listLifeEpisodesInWindowMock,
  getLifeReflectionMock,
  addLifeReflectionMock,
  getLatestLifeReflectionMock,
  listLifeReflectionsInWindowMock,
  listLongMemoryMock,
  addLongMemoryMock,
  getProactiveTasksMock,
  listTodoListsMock,
  getTodoListByIdMock,
} = vi.hoisted(() => ({
  getOrCreateActiveIdentityProfileMock: vi.fn(),
  getToolModelMock: vi.fn(),
  createSimplePromptTextGeneratorMock: vi.fn(),
  getLifeStateMock: vi.fn(),
  listLifeEpisodesInWindowMock: vi.fn(),
  getLifeReflectionMock: vi.fn(),
  addLifeReflectionMock: vi.fn(),
  getLatestLifeReflectionMock: vi.fn(),
  listLifeReflectionsInWindowMock: vi.fn(),
  listLongMemoryMock: vi.fn(),
  addLongMemoryMock: vi.fn(),
  getProactiveTasksMock: vi.fn(),
  listTodoListsMock: vi.fn(),
  getTodoListByIdMock: vi.fn(),
}));

vi.mock('../../../../src/main/services/identity/identity_service', () => ({
  getOrCreateActiveIdentityProfile: getOrCreateActiveIdentityProfileMock,
}));

vi.mock('../../../../src/core/provider/tool_model', () => ({
  getToolModel: getToolModelMock,
}));

vi.mock('../../../../src/core/runtimes/prompt_text_generator', () => ({
  createSimplePromptTextGenerator: createSimplePromptTextGeneratorMock,
}));

vi.mock('../../../../src/core/db/life', () => ({
  getLifeState: getLifeStateMock,
  listLifeEpisodesInWindow: listLifeEpisodesInWindowMock,
}));

vi.mock('../../../../src/core/db/life_reflection', () => ({
  getLifeReflection: getLifeReflectionMock,
  addLifeReflection: addLifeReflectionMock,
  getLatestLifeReflection: getLatestLifeReflectionMock,
  listLifeReflectionsInWindow: listLifeReflectionsInWindowMock,
}));

vi.mock('../../../../src/core/db/memory', () => ({
  listLongMemory: listLongMemoryMock,
  addLongMemory: addLongMemoryMock,
}));

vi.mock('../../../../src/core/db/tasks', () => ({
  getProactiveTasks: getProactiveTasksMock,
}));

vi.mock('../../../../src/core/db/todos', () => ({
  listTodoLists: listTodoListsMock,
  getTodoListById: getTodoListByIdMock,
}));

const makeEpisode = (overrides: Partial<LifeEpisodeRecord> = {}): LifeEpisodeRecord => ({
  id: `episode_${Math.random().toString(36).slice(2, 6)}`,
  profile_id: 'identity_1',
  activity_type: 'focused_work',
  presence: 'focused',
  started_at: '2026-03-21T08:05:00.000Z',
  ended_at: '2026-03-21T08:30:00.000Z',
  transition_reason: 'task-running',
  summary: 'Focused on proactive task review.',
  trigger_type: 'task-started',
  trigger_ref: 'task_1',
  thread_id: 'thread_1',
  client_id: null,
  task_id: 'task_1',
  snapshot_json: '{}',
  created_at: '2026-03-21T08:05:00.000Z',
  updated_at: '2026-03-21T08:05:00.000Z',
  ...overrides,
});

describe('life_reflection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrCreateActiveIdentityProfileMock.mockReturnValue({
      id: 'identity_1',
      name: 'iKi Core',
      self_description: '',
      owner_name: 'Nina',
      owner_role_description: 'trusted companion',
      core_values: '[]',
      boundaries: '[]',
      tone_guidance: '',
      active: 1,
      metadata: null,
      created_at: '2026-03-21T00:00:00.000Z',
      updated_at: '2026-03-21T00:00:00.000Z',
    });
    getToolModelMock.mockReturnValue({
      providerType: 'openai',
      model: 'gpt-4o-mini',
    });
    getLifeStateMock.mockReturnValue(null);
    listLifeEpisodesInWindowMock.mockReturnValue([
      makeEpisode(),
      makeEpisode({
        id: 'episode_2',
        started_at: '2026-03-21T08:35:00.000Z',
        ended_at: '2026-03-21T08:55:00.000Z',
        activity_type: 'maintenance',
        presence: 'maintaining',
        summary: 'Wrapped the task and monitored next commitments.',
        trigger_type: 'task-finished',
      }),
    ]);
    getLifeReflectionMock.mockReturnValue(null);
    addLifeReflectionMock.mockImplementation((entry: Record<string, unknown>) => ({
      id: 'reflection_1',
      created_at: '2026-03-21T09:01:00.000Z',
      ...entry,
    }));
    listLongMemoryMock.mockReturnValue([]);
    addLongMemoryMock.mockReturnValue({ changes: 1 });
    getLatestLifeReflectionMock.mockReturnValue(null);
    listLifeReflectionsInWindowMock.mockReturnValue([]);
    getProactiveTasksMock.mockReturnValue([]);
    listTodoListsMock.mockReturnValue([]);
    getTodoListByIdMock.mockReturnValue(null);
  });

  it('generates and stores an hourly reflection with selective memory writeback', async () => {
    const generateMock = vi.fn().mockResolvedValue({
      response: JSON.stringify({
        summary: 'The hour moved from focused task execution into maintenance and reprioritization.',
        insights: ['Task-backed focus created the clearest trajectory of the hour.'],
        next_focus: ['Protect a short idle window before the next commitment.'],
        memory_candidate: 'Task-driven focus blocks produce the most stable progress for iKi.',
        memory_confidence: 'high',
      }),
    });
    createSimplePromptTextGeneratorMock.mockReturnValue({
      generate: generateMock,
    });

    const { runDueHourlyLifeReflections } = await import(
      '../../../../src/main/services/life/life_reflection'
    );

    const result = await runDueHourlyLifeReflections({
      now: '2026-03-21T09:05:00.000Z',
      maxWindows: 1,
    });

    expect(result).toHaveLength(1);
    expect(addLifeReflectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        profile_id: 'identity_1',
        period_type: 'hour',
      })
    );
    expect(addLongMemoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        thread_id: 'thread_1',
        summary: 'Task-driven focus blocks produce the most stable progress for iKi.',
        tags: expect.arrayContaining(['life-reflection']),
        metadata: expect.objectContaining({
          source: 'life-reflection',
          reflectionId: 'reflection_1',
        }),
      })
    );
  });

  it('skips generation when the period already has a stored reflection', async () => {
    getLifeReflectionMock.mockReturnValue({
      id: 'reflection_existing',
      profile_id: 'identity_1',
      period_type: 'hour',
      period_start: '2026-03-21T08:00:00.000Z',
      period_end: '2026-03-21T09:00:00.000Z',
      summary: 'Existing reflection',
      insights_json: '[]',
      plan_json: '[]',
      created_at: '2026-03-21T09:01:00.000Z',
    });

    const { runDueHourlyLifeReflections } = await import(
      '../../../../src/main/services/life/life_reflection'
    );

    const result = await runDueHourlyLifeReflections({
      now: '2026-03-21T09:05:00.000Z',
      maxWindows: 1,
    });

    expect(result).toEqual([]);
    expect(createSimplePromptTextGeneratorMock).not.toHaveBeenCalled();
    expect(addLifeReflectionMock).not.toHaveBeenCalled();
  });

  it('generates a daily reflection with hourly recap and commitment inputs', async () => {
    const generateMock = vi.fn().mockResolvedValue({
      response: JSON.stringify({
        summary: 'The day was strongest when commitments were made explicit and reviewed against pending work.',
        insights: ['Pending todo structure created the clearest next-day priorities.'],
        next_focus: ['Finish the inbox review before scheduling fresh exploration.'],
        memory_candidate: null,
        memory_confidence: 'none',
      }),
    });
    createSimplePromptTextGeneratorMock.mockReturnValue({
      generate: generateMock,
    });
    listLifeReflectionsInWindowMock.mockReturnValue([
      {
        id: 'reflection_hour_1',
        profile_id: 'identity_1',
        period_type: 'hour',
        period_start: '2026-03-21T08:00:00.000Z',
        period_end: '2026-03-21T09:00:00.000Z',
        summary: 'Focused work stabilized once the task scope was explicit.',
        insights_json: '["Clear scope reduced drift."]',
        plan_json: '["Close the open checklist."]',
        created_at: '2026-03-21T09:01:00.000Z',
      },
    ]);
    listTodoListsMock.mockReturnValue([
      {
        id: 'todo_1',
        title: 'Inbox',
        summary: 'Owner-facing follow-ups',
        item_count: 3,
        completed_count: 1,
        pending_count: 2,
        created_at: '2026-03-20T10:00:00.000Z',
        updated_at: '2026-03-21T23:00:00.000Z',
      },
    ]);
    getTodoListByIdMock.mockReturnValue({
      id: 'todo_1',
      title: 'Inbox',
      summary: 'Owner-facing follow-ups',
      item_count: 3,
      completed_count: 1,
      pending_count: 2,
      created_at: '2026-03-20T10:00:00.000Z',
      updated_at: '2026-03-21T23:00:00.000Z',
      items: [
        {
          id: 'todo_item_1',
          list_id: 'todo_1',
          content: 'Reply to owner follow-up',
          notes: null,
          status: 'pending',
          sort_order: 0,
          completed_at: null,
          created_at: '2026-03-20T10:00:00.000Z',
          updated_at: '2026-03-21T23:00:00.000Z',
        },
      ],
    });
    getProactiveTasksMock.mockReturnValue([
      {
        id: 'task_1',
        name: 'Morning sync',
        prompt: 'Review overnight changes.',
        schedule_type: 'interval',
        interval_minutes: 60,
        cron_expression: null,
        schedule_timezone: null,
        enabled: true,
        provider_type: 'openai',
        model: 'gpt-4o-mini',
        tool_mode: 'auto',
        tools: null,
        thread_id: 'thread_1',
        notify: true,
        last_run_at: '2026-03-21T22:30:00.000Z',
        next_run_at: '2026-03-22T01:30:00.000Z',
        last_status: 'success',
        last_output: null,
        last_error: null,
        created_at: '2026-03-20T00:00:00.000Z',
        updated_at: '2026-03-21T22:30:00.000Z',
      },
    ]);

    const { runDueDailyLifeReflections } = await import(
      '../../../../src/main/services/life/life_reflection'
    );

    const result = await runDueDailyLifeReflections({
      now: '2026-03-22T02:15:00.000Z',
      maxWindows: 1,
    });

    expect(result).toHaveLength(1);
    expect(addLifeReflectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        profile_id: 'identity_1',
        period_type: 'day',
      })
    );
    expect(generateMock).toHaveBeenCalledWith(expect.stringContaining('Hourly reflections'));
    expect(generateMock).toHaveBeenCalledWith(expect.stringContaining('Inbox'));
    expect(generateMock).toHaveBeenCalledWith(expect.stringContaining('Morning sync'));
    expect(addLongMemoryMock).not.toHaveBeenCalled();
  });

  it('formats recent daily and hourly reflections into one bounded context message', async () => {
    getLatestLifeReflectionMock.mockImplementation((_profileId: string, periodType?: string) => {
      if (periodType === 'day') {
        return {
          id: 'reflection_day_latest',
          profile_id: 'identity_1',
          period_type: 'day',
          period_start: '2026-03-21T01:00:00.000Z',
          period_end: '2026-03-22T01:00:00.000Z',
          summary: 'The day stayed strongest when open commitments were surfaced early.',
          insights_json: '["Explicit commitment review reduced drift."]',
          plan_json: '["Finish inbox follow-ups before new proactive work."]',
          created_at: '2026-03-22T01:05:00.000Z',
        };
      }

      if (periodType === 'hour') {
        return {
          id: 'reflection_hour_latest',
          profile_id: 'identity_1',
          period_type: 'hour',
          period_start: '2026-03-22T08:00:00.000Z',
          period_end: '2026-03-22T09:00:00.000Z',
          summary: 'The hour stayed coherent around one focused task arc.',
          insights_json: '["Focused task arcs are the most legible unit of trajectory."]',
          plan_json: '["Protect a calm follow-up window."]',
          created_at: '2026-03-22T09:01:00.000Z',
        };
      }

      return null;
    });

    const { getRecentLifeReflectionContextMessage } = await import(
      '../../../../src/main/services/life/life_reflection'
    );

    const message = getRecentLifeReflectionContextMessage();

    expect(message).toContain('Recent life reflection for iKi:');
    expect(message).toContain('Daily arc: The day stayed strongest when open commitments were surfaced early.');
    expect(message).toContain('Explicit commitment review reduced drift.');
    expect(message).toContain('Finish inbox follow-ups before new proactive work.');
    expect(message).toContain('Hourly recap: The hour stayed coherent around one focused task arc.');
    expect(message).toContain('Focused task arcs are the most legible unit of trajectory.');
    expect(message).toContain('Protect a calm follow-up window.');
  });
});
