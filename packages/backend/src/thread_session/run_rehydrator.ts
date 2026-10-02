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
  /**
   * The stored requireApproval decision — undefined when the run never stored
   * one. Callers apply their own default: stream options omit the field (the
   * guard derivation stays authoritative), approval recovery falls back to
   * true (its pre-rehydrator default).
   */
  requireApproval?: boolean;
  maxIterations: number;
  /** Restored execution configuration (run metadata); undefined when the row
   *  never stored it — callers keep their current behavior then. */
  reasoningEffort?: string;
  autonomous?: { maxIterations: number; continuePrompt?: string };
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
    typeof metadata.requireApproval === 'boolean' ? metadata.requireApproval : undefined;
  const reasoningEffort =
    typeof metadata.reasoningEffort === 'string' && metadata.reasoningEffort.trim()
      ? metadata.reasoningEffort.trim()
      : undefined;
  const autonomousMetadata = metadata.autonomous as
    | { maxIterations?: unknown; continuePrompt?: unknown }
    | undefined;
  const autonomous =
    autonomousMetadata && typeof autonomousMetadata === 'object' && typeof autonomousMetadata.maxIterations === 'number'
      ? {
          maxIterations: Math.max(1, Math.trunc(autonomousMetadata.maxIterations)),
          ...(typeof autonomousMetadata.continuePrompt === 'string' && autonomousMetadata.continuePrompt
            ? { continuePrompt: autonomousMetadata.continuePrompt }
            : {}),
        }
      : undefined;

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
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(autonomous ? { autonomous } : {}),
    maxIterations: resolveToolCallMaxIterations(
      getRunMaxIterations(run) ?? fallback?.maxIterations ?? undefined
    ),
  };
};

type ResumeKind = NonNullable<NonNullable<ChatTurnOptions['runConfig']>['kind']>;

/**
 * Stream options for re-entering the turn loop from a run row (queued resume,
 * blocked resume, retry). Restores the plan fields the original turn ran
 * under — approval policy and iteration cap included — and replays the run's
 * recorded input messages so the resumed turn targets the original task
 * instead of an empty prompt.
 */
export const deriveResumeStreamOptions = (
  run: AgentRun,
  overrides: {
    kind: ResumeKind;
    parentRunId?: string;
    metadata?: Record<string, unknown>;
    autonomous?: { maxIterations: number; continuePrompt?: string };
    /** Adopt this run id as the executing identity (queued resume / retry). */
    adoptRunId?: string;
  }
): ChatTurnOptions => {
  const plan = deriveRunTurnPlan(run);
  const recordedMessages = Array.isArray(run.input?.messages) ? run.input.messages : [];
  return {
    providerType: plan.providerType,
    ...(plan.providerId ? { providerId: plan.providerId } : {}),
    model: plan.model,
    ...(plan.approvalPolicy ? { approvalPolicy: plan.approvalPolicy } : {}),
    ...(plan.requireApproval !== undefined ? { requireApproval: plan.requireApproval } : {}),
    ...(plan.reasoningEffort ? { reasoningEffort: plan.reasoningEffort } : {}),
    ...(plan.autonomous ? { autonomous: { ...plan.autonomous } } : {}),
    maxIterations: plan.maxIterations,
    // The recorded input is the recovery source. A run without recorded
    // messages resumes empty and fails explicitly downstream — missing input
    // must not be fabricated.
    messages: recordedMessages as ChatTurnOptions['messages'],
    threadId: run.threadId ?? undefined,
    tools: plan.enabledTools,
    skillIds: plan.availableSkillIds,
    runConfig: {
      kind: overrides.kind,
      ...(overrides.parentRunId ? { parentRunId: overrides.parentRunId } : {}),
      rootRunId: run.rootRunId,
      ...(overrides.adoptRunId ? { adoptRunId: overrides.adoptRunId } : {}),
      ...(overrides.metadata ? { metadata: overrides.metadata } : {}),
    },
    ...(overrides.autonomous ? { autonomous: overrides.autonomous } : {}),
  };
};
