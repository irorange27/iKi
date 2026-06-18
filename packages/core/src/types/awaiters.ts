export type AwaiterStatus =
  | 'armed'
  | 'waking'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'expired';

export type AwaiterTriggerKind = 'time_at' | 'time_after';

export type AwaiterDeliveryMode = 'thread';

export type AwaiterTimeAtTriggerSpec = {
  kind: 'time_at';
  at: string;
};

export type AwaiterTimeAfterTriggerSpec = {
  kind: 'time_after';
  delay_minutes: number;
};

export type AwaiterTriggerSpec = AwaiterTimeAtTriggerSpec | AwaiterTimeAfterTriggerSpec;

export const DEFAULT_AWAITER_LIST_LIMIT = 20;
export const MAX_AWAITER_LIST_LIMIT = 100;

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const parseAwaiterTriggerSpec = (
  raw: unknown,
  fallbackKind?: AwaiterTriggerKind | null
): AwaiterTriggerSpec | null => {
  let candidate: unknown = raw;

  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (!trimmed) return null;
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  if (!isObjectRecord(candidate)) return null;

  const kindCandidate =
    typeof candidate.kind === 'string' && candidate.kind.trim()
      ? candidate.kind.trim()
      : typeof fallbackKind === 'string'
        ? fallbackKind
        : '';

  if (kindCandidate === 'time_at') {
    const at = typeof candidate.at === 'string' ? candidate.at.trim() : '';
    return at ? { kind: 'time_at', at } : null;
  }

  if (kindCandidate === 'time_after') {
    const delayMinutes =
      typeof candidate.delay_minutes === 'number'
        ? candidate.delay_minutes
        : Number(candidate.delay_minutes);
    if (!Number.isFinite(delayMinutes)) return null;
    return {
      kind: 'time_after',
      delay_minutes: Math.max(1, Math.trunc(delayMinutes)),
    };
  }

  return null;
};

export const formatAwaiterTriggerSummary = (
  trigger: AwaiterTriggerSpec | null | undefined
): string => {
  if (!trigger) return 'Unknown trigger';

  if (trigger.kind === 'time_at') {
    return `Wake at ${trigger.at}`;
  }

  return `Wake after ${Math.max(1, Math.trunc(trigger.delay_minutes))} minute(s)`;
};

export interface Awaiter {
  id: string;
  title: string;
  instruction: string;
  status: AwaiterStatus;
  thread_id: string;
  origin_run_id?: string | null;
  origin_checkpoint_id?: string | null;
  trigger_kind: AwaiterTriggerKind;
  trigger_spec_json: string;
  delivery_mode: AwaiterDeliveryMode;
  notify: boolean;
  provider_type: string;
  provider_id?: string | null;
  model: string;
  resume_context_json?: string | null;
  next_wake_at?: string | null;
  last_wake_at?: string | null;
  last_error?: string | null;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AwaiterWakeEvent {
  id: string;
  awaiter_id: string;
  run_id?: string | null;
  trigger_fired_at: string;
  trigger_snapshot_json?: string | null;
  outcome: 'success' | 'error';
  error?: string | null;
  created_at: string;
}
