import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/db/database', () => ({
  getDb: vi.fn(),
}));

import { getDb } from '../../../src/core/db/database';
import { addProactiveTask, updateProactiveTask } from '../../../src/core/db/tasks';

const getDbMock = vi.mocked(getDb);

const setupDb = () => {
  const runMock = vi.fn((params?: unknown) => params ?? { changes: 1 });
  const prepareMock = vi.fn(() => ({ run: runMock }));
  getDbMock.mockReturnValue({ prepare: prepareMock } as unknown as ReturnType<typeof getDb>);
  return { runMock, prepareMock };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('addProactiveTask', () => {
  it('applies defaults and computes the next run time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T08:00:00.000Z'));

    const { runMock } = setupDb();

    addProactiveTask({
      id: 'task_1',
      name: 'Briefing',
      prompt: 'Summarize updates.',
      provider_type: 'openai',
      model: 'gpt-4',
    });

    const params = runMock.mock.calls[0][0] as Record<string, unknown>;
    expect(params.schedule_type).toBe('interval');
    expect(params.interval_minutes).toBe(60);
    expect(params.cron_expression).toBeNull();
    expect(params.schedule_timezone).toBeNull();
    expect(params.tool_mode).toBe('auto');
    expect(params.enabled).toBe(0);
    expect(params.notify).toBe(1);
    expect(params.last_status).toBe('idle');
    expect(params.next_run_at).toBe('2026-03-18T09:00:00.000Z');
    expect(typeof params.created_at).toBe('string');
    expect(typeof params.updated_at).toBe('string');
  });
});

describe('updateProactiveTask', () => {
  it('returns null when there are no update fields', () => {
    const { prepareMock } = setupDb();

    const result = updateProactiveTask('task_2', { id: 'task_2' } as any);

    expect(result).toBeNull();
    expect(prepareMock).not.toHaveBeenCalled();
  });

  it('normalizes booleans and truncates interval minutes', () => {
    const { runMock } = setupDb();

    updateProactiveTask('task_3', {
      enabled: true,
      notify: false,
      interval_minutes: 12.9,
      name: 'New name',
    });

    const params = runMock.mock.calls[0][0] as Record<string, unknown>;
    expect(params.enabled).toBe(1);
    expect(params.notify).toBe(0);
    expect(params.interval_minutes).toBe(12);
    expect(params.name).toBe('New name');
    expect(params.id).toBe('task_3');
    expect(typeof params.updated_at).toBe('string');
  });
});
