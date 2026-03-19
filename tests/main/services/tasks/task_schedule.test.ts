import { describe, expect, it, vi } from 'vitest';

import {
  MAX_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  clampIntervalMinutes,
  computeNextCronRunAt,
  computeNextRunAt,
  normalizeCronExpression,
  normalizeScheduleTimezone,
  normalizeScheduleType,
  validateCronExpression,
} from '../../../../src/main/services/tasks/task_schedule';

describe('task_schedule helpers', () => {
  it('clamps interval minutes to configured bounds', () => {
    expect(clampIntervalMinutes(undefined)).toBe(60);
    expect(clampIntervalMinutes(0)).toBe(MIN_INTERVAL_MINUTES);
    expect(clampIntervalMinutes(12.9)).toBe(12);
    expect(clampIntervalMinutes(MAX_INTERVAL_MINUTES + 100)).toBe(MAX_INTERVAL_MINUTES);
  });

  it('normalizes schedule fields', () => {
    expect(normalizeScheduleType('cron')).toBe('cron');
    expect(normalizeScheduleType('anything-else')).toBe('interval');

    expect(normalizeCronExpression('  0 2 * * *  ')).toBe('0 2 * * *');
    expect(normalizeCronExpression('   ')).toBeNull();

    expect(normalizeScheduleTimezone('  UTC  ')).toBe('UTC');
    expect(normalizeScheduleTimezone('')).toBeNull();
  });
});

describe('task_schedule cron/next-run behavior', () => {
  it('computes the next cron run in UTC', () => {
    const next = computeNextCronRunAt('*/5 * * * *', '2026-03-18T00:01:00.000Z', 'UTC');
    expect(next).toBe('2026-03-18T00:05:00.000Z');
  });

  it('returns validation error text for invalid cron expressions', () => {
    const validation = validateCronExpression('not-a-cron', 'UTC');
    expect(validation).toEqual(expect.any(String));
    expect(validation && validation.length > 0).toBe(true);
  });

  it('falls back to interval scheduling when cron parsing fails', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const next = computeNextRunAt(
      {
        schedule_type: 'cron',
        cron_expression: 'invalid cron',
        interval_minutes: 15,
      },
      '2026-03-18T00:00:00.000Z'
    );

    expect(next).toBe('2026-03-18T00:15:00.000Z');
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  it('uses cron scheduling in computeNextRunAt when expression is valid', () => {
    const next = computeNextRunAt(
      {
        schedule_type: 'cron',
        cron_expression: '0 2 * * *',
        schedule_timezone: 'UTC',
        interval_minutes: 30,
      },
      '2026-03-18T01:23:00.000Z'
    );

    expect(next).toBe('2026-03-18T02:00:00.000Z');
  });
});
