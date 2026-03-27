import { CronExpressionParser } from 'cron-parser';

import type { ProactiveTaskScheduleType } from '../../../shared/types/tasks';
import { toIsoNow } from '../../../shared/utils/text';
import { createLogger } from '../../../core/logger';
import { getErrorMessage } from '../../utils/errors';

export const MIN_INTERVAL_MINUTES = 1;
export const MAX_INTERVAL_MINUTES = 60 * 24 * 7; // 7 days

const taskScheduleLogger = createLogger({ module: 'task_schedule' });

const addMinutes = (baseIso: string, minutes: number): string => {
  const base = new Date(baseIso);
  if (Number.isNaN(base.getTime())) return toIsoNow();
  base.setMinutes(base.getMinutes() + minutes);
  return base.toISOString();
};

const resolveTimezone = (value?: string | null): string => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed) return trimmed;
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
};

export const clampIntervalMinutes = (value: unknown): number => {
  const asNumber = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(asNumber)) return 60;
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.trunc(asNumber)));
};

export const normalizeScheduleType = (value: unknown): ProactiveTaskScheduleType =>
  value === 'cron' ? 'cron' : 'interval';

export const normalizeCronExpression = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const normalizeScheduleTimezone = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const computeNextCronRunAt = (
  expression: string,
  fromIso: string,
  timezone?: string | null
): string => {
  const tz = resolveTimezone(timezone);
  const baseDate = new Date(fromIso);
  const anchor = Number.isNaN(baseDate.getTime()) ? new Date() : baseDate;
  const parsed = CronExpressionParser.parse(expression, { currentDate: anchor, tz });
  let nextDate = parsed.next().toDate();

  if (Number.isNaN(nextDate.getTime())) {
    throw new Error('Invalid cron next run time');
  }

  if (nextDate.toISOString() <= anchor.toISOString()) {
    const bump = new Date(anchor.getTime() + 1000);
    const bumpedParsed = CronExpressionParser.parse(expression, { currentDate: bump, tz });
    nextDate = bumpedParsed.next().toDate();
    if (Number.isNaN(nextDate.getTime())) {
      throw new Error('Invalid cron next run time');
    }
  }

  return nextDate.toISOString();
};

export const validateCronExpression = (
  expression: string,
  timezone?: string | null
): string | null => {
  try {
    computeNextCronRunAt(expression, toIsoNow(), timezone);
    return null;
  } catch (error) {
    return getErrorMessage(error);
  }
};

export const computeNextRunAt = (
  task: {
    schedule_type?: ProactiveTaskScheduleType | string;
    interval_minutes?: number;
    cron_expression?: string | null;
    schedule_timezone?: string | null;
  },
  fromIso: string
): string => {
  const scheduleType = normalizeScheduleType(task.schedule_type);
  if (scheduleType === 'cron') {
    const expression = normalizeCronExpression(task.cron_expression);
    if (expression) {
      try {
        return computeNextCronRunAt(expression, fromIso, task.schedule_timezone);
      } catch (error) {
        taskScheduleLogger.event({
          level: 'warn',
          event: 'task.schedule.compute_next',
          outcome: 'degraded',
          error,
          message: 'Invalid cron schedule; falling back to interval schedule.',
          data: {
            cron_expression: expression,
            schedule_timezone: task.schedule_timezone || null,
          },
        });
      }
    }
  }

  return addMinutes(fromIso, clampIntervalMinutes(task.interval_minutes));
};
