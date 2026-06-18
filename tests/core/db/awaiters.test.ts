import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Awaiter } from '@iki/core/types/awaiters';

vi.mock('@iki/backend/db/database', () => ({
  getDb: vi.fn(),
}));

import { getDb } from '@iki/backend/db/database';
import {
  addAwaiter,
  addAwaiterWakeEvent,
  listDueAwaiters,
  updateAwaiter,
  updateAwaiterIfStatus,
} from '@iki/backend/db/awaiters';

const getDbMock = vi.mocked(getDb);
type AwaiterUpdate = Partial<Awaiter>;

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

describe('addAwaiter', () => {
  it('applies defaults and timestamps on insert', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T03:00:00.000Z'));

    const { runMock } = setupDb();

    addAwaiter({
      id: 'awaiter_1',
      title: 'Draft follow-up',
      instruction: 'Continue the draft tomorrow morning.',
      thread_id: 'thread_1',
      provider_type: 'openai',
      model: 'gpt-5.4',
      trigger_kind: 'time_after',
      trigger_spec_json: '{"kind":"time_after","delay_minutes":30}',
    });

    const params = runMock.mock.calls[0][0] as Record<string, unknown>;
    expect(params.status).toBe('armed');
    expect(params.delivery_mode).toBe('thread');
    expect(params.notify).toBe(1);
    expect(params.provider_id).toBeNull();
    expect(params.origin_run_id).toBeNull();
    expect(params.origin_checkpoint_id).toBeNull();
    expect(params.resume_context_json).toBeNull();
    expect(params.next_wake_at).toBeNull();
    expect(params.last_wake_at).toBeNull();
    expect(params.last_error).toBeNull();
    expect(params.expires_at).toBeNull();
    expect(params.created_at).toBe('2026-04-23T03:00:00.000Z');
    expect(params.updated_at).toBe('2026-04-23T03:00:00.000Z');
  });
});

describe('updateAwaiter', () => {
  it('returns null when there are no update fields', () => {
    const { prepareMock } = setupDb();

    const result = updateAwaiter('awaiter_2', { id: 'awaiter_2' } as AwaiterUpdate);

    expect(result).toBeNull();
    expect(prepareMock).not.toHaveBeenCalled();
  });

  it('normalizes notify booleans and keeps updated_at fresh', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T04:10:00.000Z'));

    const { runMock } = setupDb();

    updateAwaiter('awaiter_3', {
      notify: false,
      status: 'failed',
      last_error: 'Boom',
    });

    const params = runMock.mock.calls[0][0] as Record<string, unknown>;
    expect(params.notify).toBe(0);
    expect(params.status).toBe('failed');
    expect(params.last_error).toBe('Boom');
    expect(params.id).toBe('awaiter_3');
    expect(params.updated_at).toBe('2026-04-23T04:10:00.000Z');
  });
});

describe('updateAwaiterIfStatus', () => {
  it('adds the expected status guard to the update', () => {
    const { runMock, prepareMock } = setupDb();

    updateAwaiterIfStatus('awaiter_4', 'waking', {
      status: 'completed',
      next_wake_at: null,
    });

    expect(String(prepareMock.mock.calls[0]?.[0])).toContain('AND status = @expected_status');
    const params = runMock.mock.calls[0][0] as Record<string, unknown>;
    expect(params.id).toBe('awaiter_4');
    expect(params.expected_status).toBe('waking');
    expect(params.status).toBe('completed');
    expect(params.next_wake_at).toBeNull();
  });
});

describe('addAwaiterWakeEvent', () => {
  it('persists nullable wake-event fields and returns the normalized record', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T04:30:00.000Z'));

    const { runMock } = setupDb();

    const event = addAwaiterWakeEvent({
      id: 'awaiter_wake_1',
      awaiter_id: 'awaiter_1',
      trigger_fired_at: '2026-04-23T04:29:00.000Z',
      outcome: 'error',
    });

    const params = runMock.mock.calls[0][0] as Record<string, unknown>;
    expect(params.run_id).toBeNull();
    expect(params.trigger_snapshot_json).toBeNull();
    expect(params.error).toBeNull();
    expect(params.created_at).toBe('2026-04-23T04:30:00.000Z');
    expect(event).toEqual({
      id: 'awaiter_wake_1',
      awaiter_id: 'awaiter_1',
      run_id: null,
      trigger_fired_at: '2026-04-23T04:29:00.000Z',
      trigger_snapshot_json: null,
      outcome: 'error',
      error: null,
      created_at: '2026-04-23T04:30:00.000Z',
    });
  });
});

describe('listDueAwaiters', () => {
  it('selects both armed and waking due awaiters and maps notify flags back into typed rows', () => {
    const allMock = vi.fn(() => [
      {
        id: 'awaiter_due_1',
        title: 'Resume Draft',
        instruction: 'Continue the draft.',
        status: 'waking',
        thread_id: 'thread_1',
        origin_run_id: null,
        origin_checkpoint_id: null,
        trigger_kind: 'time_after',
        trigger_spec_json: '{"kind":"time_after","delay_minutes":30}',
        delivery_mode: 'thread',
        notify: 0,
        provider_type: 'openai',
        provider_id: null,
        model: 'gpt-5.4',
        resume_context_json: null,
        next_wake_at: '2026-04-23T05:00:00.000Z',
        last_wake_at: null,
        last_error: null,
        expires_at: null,
        created_at: '2026-04-23T04:00:00.000Z',
        updated_at: '2026-04-23T04:00:00.000Z',
      },
    ]);
    const prepareMock = vi.fn(() => ({ all: allMock }));
    getDbMock.mockReturnValue({ prepare: prepareMock } as unknown as ReturnType<typeof getDb>);

    expect(listDueAwaiters('2026-04-23T05:00:00.000Z')).toEqual([
      expect.objectContaining({
        id: 'awaiter_due_1',
        notify: false,
        status: 'waking',
      }),
    ]);
    expect(allMock).toHaveBeenCalledWith('2026-04-23T05:00:00.000Z');
    expect(String(prepareMock.mock.calls[0]?.[0])).toContain("status IN ('armed', 'waking')");
  });
});
