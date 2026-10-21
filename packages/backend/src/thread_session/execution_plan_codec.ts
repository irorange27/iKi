import { createLogger } from '@iki/backend/logger';
import type { ExecutionPlan } from './execution_plan';

const logger = createLogger({ module: 'execution_plan_codec' });

export const EXECUTION_PLAN_VERSION = 2;

export type SerializedExecutionPlan = { version: number; plan: ExecutionPlan };

export const serializeExecutionPlan = (plan: ExecutionPlan): string =>
  JSON.stringify({ version: EXECUTION_PLAN_VERSION, plan } satisfies SerializedExecutionPlan);

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

export const parseExecutionPlanValue = (value: unknown): ExecutionPlan | null => {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as { version?: unknown; plan?: unknown };
  if ('version' in record || 'plan' in record) return decodeVersionedPlan(record);
  return isValidPlan(value) ? value : null;
};

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
