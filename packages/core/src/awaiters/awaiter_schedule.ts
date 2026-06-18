import {
  formatAwaiterTriggerSummary,
  parseAwaiterTriggerSpec,
  type AwaiterTriggerKind,
  type AwaiterTriggerSpec,
} from '../types/awaiters';
import { getErrorMessage } from '../utils/errors';
import { toIsoNow } from '../utils/text';

const parseDateInput = (value: string): Date | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const normalizeAwaiterTriggerKind = (value: unknown): AwaiterTriggerKind | null =>
  value === 'time_at' || value === 'time_after' ? value : null;

export const normalizeAwaiterTriggerSpec = (value: unknown): AwaiterTriggerSpec | null => {
  const parsed = parseAwaiterTriggerSpec(value);
  if (!parsed) return null;

  if (parsed.kind === 'time_at') {
    const date = parseDateInput(parsed.at);
    if (!date) return null;
    return {
      kind: 'time_at',
      at: date.toISOString(),
    };
  }

  return {
    kind: 'time_after',
    delay_minutes: Math.max(1, Math.trunc(parsed.delay_minutes)),
  };
};

export const computeAwaiterNextWakeAt = (
  trigger: AwaiterTriggerSpec,
  fromIso: string
): string => {
  const anchor = parseDateInput(fromIso) ?? new Date();

  if (trigger.kind === 'time_at') {
    const at = parseDateInput(trigger.at);
    if (!at) {
      throw new Error('Invalid time_at trigger');
    }
    return at.toISOString();
  }

  return new Date(anchor.getTime() + trigger.delay_minutes * 60_000).toISOString();
};

export const validateAwaiterTriggerSpec = (
  trigger: AwaiterTriggerSpec,
  fromIso: string = toIsoNow()
): string | null => {
  try {
    const nextWakeAt = computeAwaiterNextWakeAt(trigger, fromIso);
    const nextWakeDate = parseDateInput(nextWakeAt);
    const anchor = parseDateInput(fromIso) ?? new Date();

    if (!nextWakeDate) {
      throw new Error('Invalid next wake time');
    }

    if (nextWakeDate.getTime() <= anchor.getTime()) {
      throw new Error('Wake time must be in the future');
    }

    return null;
  } catch (error) {
    return getErrorMessage(error);
  }
};

export { formatAwaiterTriggerSummary };
