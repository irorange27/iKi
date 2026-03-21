import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SLEEP_WINDOW,
  advanceLifeBudgets,
  chooseLifeActivity,
  normalizeSleepWindow,
  parseLifeStateEnvelope,
  resolveLifeDayPhase,
  serializeLifeStateEnvelope,
} from '../../../../src/main/services/life/life_activity_engine';

const localDate = (hour: number, minute = 0) => new Date(2026, 2, 21, hour, minute, 0, 0);

describe('life_activity_engine', () => {
  it('normalizes invalid sleep windows back to defaults', () => {
    expect(normalizeSleepWindow({ startHour: -5, endHour: 99 })).toEqual(DEFAULT_SLEEP_WINDOW);
  });

  it('resolves sleep and wake phases around the configured sleep window', () => {
    expect(resolveLifeDayPhase(localDate(2, 30), DEFAULT_SLEEP_WINDOW)).toBe('night');
    expect(resolveLifeDayPhase(localDate(9, 10), DEFAULT_SLEEP_WINDOW)).toBe('wake');
    expect(resolveLifeDayPhase(localDate(13, 0), DEFAULT_SLEEP_WINDOW)).toBe('day');
    expect(resolveLifeDayPhase(localDate(20, 0), DEFAULT_SLEEP_WINDOW)).toBe('evening');
  });

  it('prefers focused work whenever a task is actively running', () => {
    const decision = chooseLifeActivity({
      now: localDate(14, 0),
      sleepWindow: DEFAULT_SLEEP_WINDOW,
      tasks: {
        runningTaskIds: ['task_1'],
        dueTaskCount: 0,
        nextDueAt: null,
      },
    });

    expect(decision).toEqual(
      expect.objectContaining({
        activity: 'focused_work',
        presence: 'focused',
        transitionReason: 'task-running',
      })
    );
  });

  it('enters maintenance when commitments are due soon', () => {
    const decision = chooseLifeActivity({
      now: localDate(15, 0),
      sleepWindow: DEFAULT_SLEEP_WINDOW,
      tasks: {
        runningTaskIds: [],
        dueTaskCount: 1,
        nextDueAt: '2026-03-21T15:05:00',
      },
    });

    expect(decision).toEqual(
      expect.objectContaining({
        activity: 'maintenance',
        presence: 'maintaining',
      })
    );
  });

  it('otherwise falls back to honest idle availability', () => {
    const decision = chooseLifeActivity({
      now: localDate(16, 0),
      sleepWindow: DEFAULT_SLEEP_WINDOW,
      tasks: {
        runningTaskIds: [],
        dueTaskCount: 0,
        nextDueAt: '2026-03-21T18:00:00',
      },
    });

    expect(decision).toEqual(
      expect.objectContaining({
        activity: 'companion_idle',
        presence: 'available',
        transitionReason: 'idle-available',
      })
    );
  });

  it('applies bounded budget drift per activity', () => {
    const focused = advanceLifeBudgets(
      'focused_work',
      {
        energy: 0.8,
        focus_budget: 0.8,
        social_availability: 0.8,
      },
      120
    );

    expect(focused.energy).toBeLessThan(0.8);
    expect(focused.focus_budget).toBeLessThan(0.8);

    const recovered = advanceLifeBudgets(
      'sleep',
      {
        energy: 0.3,
        focus_budget: 0.3,
        social_availability: 0.3,
      },
      240
    );

    expect(recovered.energy).toBeGreaterThan(0.3);
    expect(recovered.energy).toBeLessThanOrEqual(1);
  });

  it('round-trips the life state envelope JSON shape', () => {
    const serialized = serializeLifeStateEnvelope({
      dayPhase: 'day',
      lastTransitionReason: 'idle-available',
      lastEventType: 'tick',
      runningTaskIds: ['task_1'],
      lastTaskFinishedAt: '2026-03-21T12:00:00.000Z',
      lastTaskThreadId: 'thread_1',
      lastTaskStatus: 'success',
    });

    expect(parseLifeStateEnvelope(serialized)).toEqual({
      dayPhase: 'day',
      lastTransitionReason: 'idle-available',
      lastEventType: 'tick',
      runningTaskIds: ['task_1'],
      lastTaskFinishedAt: '2026-03-21T12:00:00.000Z',
      lastTaskThreadId: 'thread_1',
      lastTaskStatus: 'success',
    });
  });
});
