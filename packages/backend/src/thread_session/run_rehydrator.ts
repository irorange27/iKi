import type { AgentRun } from '@iki/backend/types/agent_run';
import type { ApprovalPolicy } from '../agent/harness/tool_resolver';
import type { ChatTurnOptions } from '../turn_prep/turn_preparer';
import { parseApprovalPolicy } from '../workspaces/thread_mode';
import { resolveToolCallMaxIterations } from './constants';

/**
 * Single derivation of "rebuild a turn from a run row". resumeRun,
 * retryAndExecute and approval recovery must agree on these fields; before
 * this module each call site re-derived them and drifted — resume and retry
 * silently dropped the stored approval policy and iteration cap, degrading
 * restored turns to the legacy approval flags.
 */
export type RunTurnPlan = {
  providerType: string;
  providerId?: string;
  model: string;
  systemPrompt: string;
  enabledTools: string[];
  availableSkillIds: string[];
  approvalPolicy?: ApprovalPolicy;
  requireApproval: boolean;
  maxIterations: number;
};

export type RunTurnPlanFallback = {
  providerType?: string | null;
  providerId?: string | null;
  model?: string | null;
  systemPrompt?: string | null;
  enabledTools?: string[] | null;
  availableSkillIds?: string[] | null;
  maxIterations?: number | null;
};

const trimmedOrUndefined = (value: string | null | undefined): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const getRunMaxIterations = (run: AgentRun | null | undefined): number | undefined => {
  const value = run?.input?.metadata?.maxIterations;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.trunc(value));
};

/**
 * Layer a run row over optional fallbacks (the approval-session row). A field
 * present on the run wins; nullish run fields fall back. Arrays use nullish
 * semantics — an empty run array is a deliberate value, not a missing one.
 */
export const deriveRunTurnPlan = (
  run: AgentRun | null | undefined,
  fallback?: RunTurnPlanFallback
): RunTurnPlan => {
  const metadata = run?.input?.metadata ?? {};
  const requireApproval =
    typeof metadata.requireApproval === 'boolean' ? metadata.requireApproval : true;

  return {
    providerType:
      trimmedOrUndefined(run?.providerType) ?? trimmedOrUndefined(fallback?.providerType) ?? '',
    providerId:
      trimmedOrUndefined(run?.providerId) ?? trimmedOrUndefined(fallback?.providerId),
    model: trimmedOrUndefined(run?.model) ?? trimmedOrUndefined(fallback?.model) ?? '',
    systemPrompt:
      typeof run?.systemPrompt === 'string' && run.systemPrompt.length > 0
        ? run.systemPrompt
        : typeof fallback?.systemPrompt === 'string'
          ? fallback.systemPrompt
          : '',
    enabledTools: run?.enabledTools ?? fallback?.enabledTools ?? [],
    availableSkillIds: run?.availableSkillIds ?? fallback?.availableSkillIds ?? [],
    approvalPolicy: parseApprovalPolicy(metadata.approvalPolicy) ?? undefined,
    requireApproval,
    maxIterations: resolveToolCallMaxIterations(
      getRunMaxIterations(run) ?? fallback?.maxIterations ?? undefined
    ),
  };
};

type ResumeKind = NonNullable<NonNullable<ChatTurnOptions['runConfig']>['kind']>;

/**
 * Stream options for re-entering the turn loop from a run row (queued resume,
 * blocked resume, retry). Restores the plan fields the original turn ran
 * under — approval policy and iteration cap included.
 */
export const deriveResumeStreamOptions = (
  run: AgentRun,
  overrides: {
    kind: ResumeKind;
    parentRunId?: string;
    metadata?: Record<string, unknown>;
    autonomous?: { maxIterations: number; continuePrompt?: string };
  }
): ChatTurnOptions => {
  const plan = deriveRunTurnPlan(run);
  return {
    providerType: plan.providerType,
    ...(plan.providerId ? { providerId: plan.providerId } : {}),
    model: plan.model,
    ...(plan.approvalPolicy ? { approvalPolicy: plan.approvalPolicy } : {}),
    maxIterations: plan.maxIterations,
    messages: [],
    threadId: run.threadId ?? undefined,
    tools: plan.enabledTools,
    skillIds: plan.availableSkillIds,
    runConfig: {
      kind: overrides.kind,
      ...(overrides.parentRunId ? { parentRunId: overrides.parentRunId } : {}),
      rootRunId: run.rootRunId,
      ...(overrides.metadata ? { metadata: overrides.metadata } : {}),
    },
    ...(overrides.autonomous ? { autonomous: overrides.autonomous } : {}),
  };
};
