import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/db/awaiters', () => ({
  addAwaiter: vi.fn(),
  deleteAwaiter: vi.fn(),
  getAwaiter: vi.fn(),
  getAwaiters: vi.fn(),
  updateAwaiter: vi.fn(),
}));

import * as awaitersDb from '../../../src/core/db/awaiters';
import type { Awaiter } from '../../../src/shared/types/awaiters';
import {
  createAwaiter,
  deleteAwaiter,
  listAwaiterRecords,
  readAwaiterRecord,
  updateAwaiter,
} from '../../../src/core/awaiters/awaiter_manager';

const createAwaiterRow = (overrides: Partial<Awaiter> = {}): Awaiter => ({
  id: 'awaiter_1',
  title: 'Resume Draft',
  instruction: 'Continue the draft tomorrow morning.',
  status: 'armed',
  thread_id: 'thread_1',
  origin_run_id: 'run_origin',
  origin_checkpoint_id: null,
  trigger_kind: 'time_after',
  trigger_spec_json: '{"kind":"time_after","delay_minutes":30}',
  delivery_mode: 'thread',
  notify: true,
  provider_type: 'openai',
  provider_id: 'provider_primary',
  model: 'gpt-5.4',
  resume_context_json: '{"createdFromRunId":"run_origin"}',
  next_wake_at: '2026-04-23T05:30:00.000Z',
  last_wake_at: null,
  last_error: null,
  expires_at: null,
  created_at: '2026-04-23T05:00:00.000Z',
  updated_at: '2026-04-23T05:00:00.000Z',
  ...overrides,
});

describe('awaiter_manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('creates awaiters with normalized trigger timing and provider identity', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T05:00:00.000Z'));

    vi.mocked(awaitersDb.getAwaiter).mockReturnValue(createAwaiterRow({ id: 'awaiter_created' }));

    const awaiter = createAwaiter({
      title: '  Resume Draft  ',
      instruction: '  Continue the draft tomorrow morning.  ',
      thread_id: ' thread_1 ',
      provider_type: ' openai ',
      provider_id: ' provider_primary ',
      model: ' gpt-5.4 ',
      trigger: {
        kind: 'time_after',
        delay_minutes: 45.9,
      },
    });

    expect(awaiter.id).toBe('awaiter_created');
    expect(awaitersDb.addAwaiter).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Resume Draft',
        instruction: 'Continue the draft tomorrow morning.',
        thread_id: 'thread_1',
        provider_type: 'openai',
        provider_id: 'provider_primary',
        model: 'gpt-5.4',
        status: 'armed',
        trigger_kind: 'time_after',
        trigger_spec_json: '{"kind":"time_after","delay_minutes":45}',
        next_wake_at: '2026-04-23T05:45:00.000Z',
      })
    );
  });

  it('re-arms a completed awaiter when its trigger is rescheduled', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T06:00:00.000Z'));

    vi.mocked(awaitersDb.getAwaiters).mockReturnValue([
      createAwaiterRow({
        id: 'awaiter_rescheduled',
        title: 'Resume Draft',
        status: 'completed',
        next_wake_at: null,
        last_wake_at: '2026-04-23T05:30:00.000Z',
      }),
    ]);
    vi.mocked(awaitersDb.getAwaiter).mockReturnValue(
      createAwaiterRow({
        id: 'awaiter_rescheduled',
        title: 'Resume Draft',
        status: 'armed',
        trigger_spec_json: '{"kind":"time_after","delay_minutes":120}',
        next_wake_at: '2026-04-23T08:00:00.000Z',
        last_wake_at: '2026-04-23T05:30:00.000Z',
      })
    );

    const updated = updateAwaiter(
      { title: 'Resume Draft' },
      {
        trigger: {
          kind: 'time_after',
          delay_minutes: 120,
        },
      }
    );

    expect(updated.status).toBe('armed');
    expect(awaitersDb.updateAwaiter).toHaveBeenCalledWith(
      'awaiter_rescheduled',
      expect.objectContaining({
        status: 'armed',
        trigger_kind: 'time_after',
        trigger_spec_json: '{"kind":"time_after","delay_minutes":120}',
        next_wake_at: '2026-04-23T08:00:00.000Z',
        last_error: null,
      })
    );
  });

  it('re-arms a waking awaiter when its trigger is rescheduled mid-flight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T06:00:00.000Z'));

    vi.mocked(awaitersDb.getAwaiters).mockReturnValue([
      createAwaiterRow({
        id: 'awaiter_waking',
        title: 'Resume Draft',
        status: 'waking',
      }),
    ]);
    vi.mocked(awaitersDb.getAwaiter).mockReturnValue(
      createAwaiterRow({
        id: 'awaiter_waking',
        title: 'Resume Draft',
        status: 'armed',
        trigger_spec_json: '{"kind":"time_after","delay_minutes":90}',
        next_wake_at: '2026-04-23T07:30:00.000Z',
      })
    );

    const updated = updateAwaiter(
      { title: 'Resume Draft' },
      {
        trigger: {
          kind: 'time_after',
          delay_minutes: 90,
        },
      }
    );

    expect(updated.status).toBe('armed');
    expect(awaitersDb.updateAwaiter).toHaveBeenCalledWith(
      'awaiter_waking',
      expect.objectContaining({
        status: 'armed',
        trigger_kind: 'time_after',
        trigger_spec_json: '{"kind":"time_after","delay_minutes":90}',
        next_wake_at: '2026-04-23T07:30:00.000Z',
      })
    );
  });

  it('returns summarized records for list/read and forwards deletes by awaiter reference', () => {
    vi.mocked(awaitersDb.getAwaiters).mockReturnValue([
      createAwaiterRow({
        id: 'awaiter_summary',
        title: 'Resume Draft',
        trigger_spec_json: '{"kind":"time_at","at":"2026-04-24T01:00:00.000Z"}',
        trigger_kind: 'time_at',
      }),
    ]);

    const list = listAwaiterRecords({ query: 'draft', limit: 5 });
    expect(list[0]).toEqual(
      expect.objectContaining({
        id: 'awaiter_summary',
        trigger_summary: 'Wake at 2026-04-24T01:00:00.000Z',
        trigger_spec: {
          kind: 'time_at',
          at: '2026-04-24T01:00:00.000Z',
        },
      })
    );

    const read = readAwaiterRecord({ title: 'Resume Draft' });
    expect(read?.id).toBe('awaiter_summary');

    expect(deleteAwaiter({ title: 'Resume Draft' })).toEqual({
      deleted: true,
      awaiterId: 'awaiter_summary',
      awaiterTitle: 'Resume Draft',
    });
    expect(awaitersDb.deleteAwaiter).toHaveBeenCalledWith('awaiter_summary');
  });
});
