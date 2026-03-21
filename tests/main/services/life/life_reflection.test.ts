import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LifeEpisodeRecord } from '../../../../src/shared/types/life';

const {
  getOrCreateActiveIdentityProfileMock,
  getToolModelMock,
  createSimplePromptTextGeneratorMock,
  listLifeEpisodesInWindowMock,
  getLifeReflectionMock,
  addLifeReflectionMock,
  getLatestLifeReflectionMock,
  listLongMemoryMock,
  addLongMemoryMock,
} = vi.hoisted(() => ({
  getOrCreateActiveIdentityProfileMock: vi.fn(),
  getToolModelMock: vi.fn(),
  createSimplePromptTextGeneratorMock: vi.fn(),
  listLifeEpisodesInWindowMock: vi.fn(),
  getLifeReflectionMock: vi.fn(),
  addLifeReflectionMock: vi.fn(),
  getLatestLifeReflectionMock: vi.fn(),
  listLongMemoryMock: vi.fn(),
  addLongMemoryMock: vi.fn(),
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
  listLifeEpisodesInWindow: listLifeEpisodesInWindowMock,
}));

vi.mock('../../../../src/core/db/life_reflection', () => ({
  getLifeReflection: getLifeReflectionMock,
  addLifeReflection: addLifeReflectionMock,
  getLatestLifeReflection: getLatestLifeReflectionMock,
}));

vi.mock('../../../../src/core/db/memory', () => ({
  listLongMemory: listLongMemoryMock,
  addLongMemory: addLongMemoryMock,
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
      relationship_to_owner: 'trusted companion',
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

  it('formats the latest stored reflection into a bounded context message', async () => {
    getLatestLifeReflectionMock.mockReturnValue({
      id: 'reflection_latest',
      profile_id: 'identity_1',
      period_type: 'hour',
      period_start: '2026-03-21T08:00:00.000Z',
      period_end: '2026-03-21T09:00:00.000Z',
      summary: 'The hour stayed coherent around one focused task arc.',
      insights_json: '["Focused task arcs are the most legible unit of trajectory."]',
      plan_json: '["Protect a calm follow-up window."]',
      created_at: '2026-03-21T09:01:00.000Z',
    });

    const { getRecentLifeReflectionContextMessage } = await import(
      '../../../../src/main/services/life/life_reflection'
    );

    const message = getRecentLifeReflectionContextMessage();

    expect(message).toContain('Recent life reflection for iKi:');
    expect(message).toContain('Hourly recap: The hour stayed coherent around one focused task arc.');
    expect(message).toContain('Focused task arcs are the most legible unit of trajectory.');
    expect(message).toContain('Protect a calm follow-up window.');
  });
});
