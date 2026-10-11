import type { ModelMessage } from 'ai';

import type { AgentRun } from '@iki/backend/types/agent_run';
import type { ApprovalPolicy } from '../agent/harness/tool_resolver';
import type { ChatTurnOptions } from '../turn_prep/turn_preparer';
import { toModelInputMessages } from '@iki/backend/message/ui_messages';
import { rebuildThreadViewFromEvents, type RebuiltThreadView } from './session_log';
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
  /** The original turn's workspace world (D30): a retry/queued-resume is the
   *  same turn re-executing, so it rebinds this world rather than adopting
   *  the thread's current selection. Undefined for legacy rows. */
  workspaceSelection?: import('../workspaces/thread_workspace').ThreadWorkspaceSelection | null;
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
  const workspaceSelectionMetadata = metadata.workspaceSelection;
  const workspaceSelection =
    workspaceSelectionMetadata === null ||
    (workspaceSelectionMetadata && typeof workspaceSelectionMetadata === 'object')
      ? (workspaceSelectionMetadata as import('../workspaces/thread_workspace').ThreadWorkspaceSelection | null)
      : undefined;
  const autonomousMetadata = metadata.autonomous as
    | { maxIterations?: unknown; continuePrompt?: unknown }
    | undefined;
  const autonomous =
    autonomousMetadata && typeof autonomousMetadata === 'object' && typeof autonomousMetadata.maxIterations === 'number' && Number.isFinite(autonomousMetadata.maxIterations)
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
    ...(workspaceSelection !== undefined ? { workspaceSelection } : {}),
    maxIterations: resolveToolCallMaxIterations(
      getRunMaxIterations(run) ?? fallback?.maxIterations ?? undefined
    ),
  };
};

type ResumeKind = NonNullable<NonNullable<ChatTurnOptions['runConfig']>['kind']>;

/**
 * The recovery history for re-entering a turn, rebuilt from the session log
 * replay alone (ADR 008 F3): the run row's `input.messages` copy is no
 * longer read as authority. Non-terminal tool parts stay intact
 * (`repairInterruptedTools: false`) — a committed partial exchange rides the
 * recovered request so the provider does not re-run an effect that already
 * happened. Memory injection is the caller's seam: the retry path re-enters
 * through the preparer (which owns it); the approval path bypasses the
 * preparer and injects persisted context itself.
 * Returns null when the log has no messages — missing input is refused by
 * the caller, never fabricated.
 */
export const resumeHistoryFromReplay = async (
  replay: RebuiltThreadView
): Promise<ModelMessage[] | null> => {
  if (replay.messages.length === 0) return null;
  return await toModelInputMessages(replay.messages, { repairInterruptedTools: false });
};

export const rebuildResumeHistoryFromEvents = async (
  threadId: string,
  excludeRunId?: string
): Promise<ModelMessage[] | null> =>
  resumeHistoryFromReplay(rebuildThreadViewFromEvents(threadId, { excludeRunId }));

/**
 * Stream options for re-entering the turn loop from a run row (queued resume,
 * blocked resume, retry). Restores the plan fields the original turn ran
 * under — approval policy and iteration cap included — and carries the
 * recovery history from `rebuildResumeHistoryFromEvents` so the resumed turn
 * targets the original task instead of an empty prompt.
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
    /** The session-log recovery history (rebuildResumeHistoryFromEvents). */
    inputMessages?: ModelMessage[];
  }
): ChatTurnOptions => {
  const plan = deriveRunTurnPlan(run);
  const recordedMessages = overrides.inputMessages ?? [];
  return {
    providerType: plan.providerType,
    ...(plan.providerId ? { providerId: plan.providerId } : {}),
    model: plan.model,
    ...(plan.approvalPolicy ? { approvalPolicy: plan.approvalPolicy } : {}),
    ...(plan.requireApproval !== undefined ? { requireApproval: plan.requireApproval } : {}),
    ...(plan.reasoningEffort ? { reasoningEffort: plan.reasoningEffort } : {}),
    ...(plan.autonomous ? { autonomous: { ...plan.autonomous } } : {}),
    ...(plan.workspaceSelection !== undefined
      ? { workspaceSelection: plan.workspaceSelection }
      : {}),
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
