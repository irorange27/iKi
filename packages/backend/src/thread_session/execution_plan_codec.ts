import { createLogger } from '@iki/backend/logger';
import type { ExecutionPlan } from './execution_plan';

const logger = createLogger({ module: 'execution_plan_codec' });

/**
 * Versioned codec for persisted ExecutionPlan snapshots. The approval
 * session's plan_json (and, from stage C onward, any other persisted
 * execution configuration) goes through this single encode/decode pair —
 * persisted plans are versioned data, not ad-hoc JSON, so a field change
 * bumps the version and the reader decides instead of silently drifting.
 */
/**
 * Version 2: the two budgets became explicit (`plan.budget{step,batch?}`,
 * audit C-1). A v1 snapshot is NOT adapted — the field it stored,
 * `maxIterations`, was the step budget under a name that also meant the batch
 * bound, and re-interpreting it would be a second authority. Version 1 is
 * refused below and the caller takes its declared fallback.
 */
export const EXECUTION_PLAN_VERSION = 2;

export type SerializedExecutionPlan = { version: number; plan: ExecutionPlan };

export const serializeExecutionPlan = (plan: ExecutionPlan): string =>
  JSON.stringify({ version: EXECUTION_PLAN_VERSION, plan } satisfies SerializedExecutionPlan);

/**
 * Structural validation for a decoded plan. Anything that would reach the
 * harness with an undefined field the harness config consumes fails the
 * parse — an unreadable snapshot must not fabricate an execution
 * configuration; callers fall back to the legacy derivation.
 */
const isValidPlan = (candidate: unknown): candidate is ExecutionPlan => {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const plan = candidate as Partial<ExecutionPlan>;
  return (
    typeof plan.providerType === 'string' &&
    typeof plan.model === 'string' &&
    typeof plan.systemPrompt === 'string' &&
    typeof plan.enableTools === 'boolean' &&
    typeof plan.requireApproval === 'boolean' &&
    typeof plan.autoApproveToolRequests === 'boolean' &&
    Array.isArray(plan.enabledTools) &&
    Array.isArray(plan.availableSkillIds) &&
    typeof plan.budget === 'object' &&
    plan.budget !== null &&
    typeof plan.budget.step === 'number' &&
    Number.isFinite(plan.budget.step)
  );
};

/**
 * Decode a persisted plan snapshot. Returns null for anything unusable —
 * malformed JSON, unknown future versions, or structurally invalid plans —
 * so the caller can take its declared fallback.
 *
 * The STORED form is always the versioned envelope, and this entry point
 * enforces that: a payload that names no version is rejected, because the
 * column is a persistence boundary and an unversioned blob there means the
 * writer was not `serializeExecutionPlan`. That is a separate contract from the
 * log path below and must stay so — relaxing it would let a column written by
 * some other producer be adopted as a plan.
 */
export const parseExecutionPlan = (stored: string | null | undefined): ExecutionPlan | null => {
  if (typeof stored !== 'string' || !stored.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as { version?: unknown; plan?: unknown };
    if (!('version' in record)) return null;
    return decodeVersionedPlan(record);
  } catch {
    return null;
  }
};

/**
 * Decode a plan that is ALREADY a decoded value — the shape a Session-log
 * `turn_started` fact carries.
 *
 * Accepts the versioned envelope (a fact whose payload stored
 * `serializeExecutionPlan`'s output) and the BARE plan object, because
 * `TurnStartedPayload.plan` is a bare `ExecutionPlan`. The bare form is
 * legitimate here for a reason that does not hold for the column: the fact's
 * own `version` field is the payload schema version, so the envelope would
 * duplicate it, and the fact was written by the one producer that owns the
 * shape.
 *
 * Validation beyond that is identical to the column path — the same structural
 * check, and a null rather than a coerced value — so a plan recovered from the
 * event stream is never held to a looser standard than one recovered from a
 * column.
 */
export const parseExecutionPlanValue = (value: unknown): ExecutionPlan | null => {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as { version?: unknown; plan?: unknown };
  if ('version' in record || 'plan' in record) return decodeVersionedPlan(record);
  return isValidPlan(value) ? value : null;
};

/** The shared versioned-envelope decoder both entry points funnel through. */
const decodeVersionedPlan = (record: { version?: unknown; plan?: unknown }): ExecutionPlan | null => {
  if (record.version !== EXECUTION_PLAN_VERSION) {
    logger.event({
      level: 'warn',
      event: 'execution_plan.codec_version',
      outcome: 'degraded',
      message: 'Persisted execution plan has an unknown version; falling back.',
      data: { version: record.version ?? null },
    });
    return null;
  }
  return isValidPlan(record.plan) ? record.plan : null;
};
