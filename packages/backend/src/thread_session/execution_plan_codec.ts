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
export const EXECUTION_PLAN_VERSION = 1;

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
    typeof plan.maxIterations === 'number' &&
    Number.isFinite(plan.maxIterations)
  );
};

/**
 * Decode a persisted plan snapshot. Returns null for anything unusable —
 * malformed JSON, unknown future versions, or structurally invalid plans —
 * so the caller can take its declared fallback.
 */
export const parseExecutionPlan = (stored: string | null | undefined): ExecutionPlan | null => {
  if (typeof stored !== 'string' || !stored.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as { version?: unknown; plan?: unknown };
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
  } catch {
    return null;
  }
};
