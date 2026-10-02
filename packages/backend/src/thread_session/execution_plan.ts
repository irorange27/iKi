import type { AgentRunInput, AgentRunKind, AgentRunWorkingState } from '@iki/backend/types/agent_run';
import type { ApprovalPolicy } from '../agent/harness/tool_resolver';
import type { HarnessConfig } from '../agent/harness/harness_types';
import type { ThreadWorkspaceSelection } from '../workspaces/thread_workspace';
import { parseApprovalPolicy } from '../workspaces/thread_mode';
import { getPersonalityStylePrompt } from '../message/personality';
import {
  NO_TOOLS_SYSTEM_PROMPT,
  TOOL_AGENT_SYSTEM_PROMPT,
  resolveToolCallMaxIterations,
} from './constants';
import type { ChatTurnOptions, PreparedChatTurn } from '../turn_prep/turn_preparer';

/**
 * The typed definition of one turn execution. Every public entry (stream,
 * send, approval resume, retry, queued resume) derives the same projections
 * from this one object — harness config, run-row identity/metadata, and the
 * approval recovery context — instead of re-assembling the same fields at
 * each call site. Resumed turns read the persisted version of the plan: the
 * run row (via run_rehydrator) and, for approval recovery, the approval
 * session row.
 */
export type ExecutionPlan = {
  // Supply
  providerType: string;
  providerId?: string;
  model: string;
  // Tool & approval behavior (the guarded, post-preparation selection)
  enableTools: boolean;
  enabledTools: string[];
  availableSkillIds: string[];
  guardActive: boolean;
  requireApproval: boolean;
  autoApproveToolRequests: boolean;
  approvalPolicy?: ApprovalPolicy;
  maxIterations: number;
  // Budgets
  maxInputTokens?: number;
  maxOutputTokens?: number;
  reasoningEffort?: string;
  // Outer-loop autonomy (ADR 004)
  autonomous?: { maxIterations: number; continuePrompt?: string };
  // Turn-start world binding (D30): tools and later-approved actions run
  // where the turn started, never where the thread points mid-turn.
  workspaceSelection?: ThreadWorkspaceSelection | null;
  // Request shape
  systemPrompt: string;
  contextTokens?: number;
  skillMode: 'manual' | 'auto';
  // Run identity
  threadId?: string;
  kind: AgentRunKind;
  parentRunId?: string;
  rootRunId?: string;
  /** Execute inside this already-claimed run row (queued resume / retry). */
  adoptRunId?: string;
  /** Extra metadata the caller carried in runConfig. */
  runMetadata: Record<string, unknown>;
  /** Transport surface the execution rides (provenance, not behavior). */
  transport: 'stream' | 'send' | 'approval-resume';
};

/**
 * The single assembly point for fresh turns. The caller resolves the
 * turn-start workspace binding when the turn starts for it (for stream/send:
 * at admission, before preparation awaits) and hands it in — assembly never
 * re-resolves a world that a mid-prepare switch would change.
 */
export const assembleExecutionPlan = (params: {
  options: ChatTurnOptions;
  preparedTurn: PreparedChatTurn;
  transport: ExecutionPlan['transport'];
  workspaceSelection: ThreadWorkspaceSelection | null;
}): ExecutionPlan => {
  const { options, preparedTurn, transport, workspaceSelection } = params;
  const approvalPolicy = parseApprovalPolicy(options.approvalPolicy);
  return {
    providerType: options.providerType,
    ...(options.providerId ? { providerId: options.providerId } : {}),
    model: options.model,
    enableTools: preparedTurn.enableTools,
    enabledTools: [...preparedTurn.guardedTools],
    availableSkillIds: [...preparedTurn.selectedSkillIds],
    guardActive: preparedTurn.guardActive,
    requireApproval: preparedTurn.requireApproval,
    autoApproveToolRequests: preparedTurn.autoApproveToolRequests,
    ...(approvalPolicy ? { approvalPolicy } : {}),
    maxIterations: resolveToolCallMaxIterations(options.maxIterations),
    ...(typeof preparedTurn.maxInputTokens === 'number'
      ? { maxInputTokens: preparedTurn.maxInputTokens }
      : {}),
    ...(typeof preparedTurn.maxOutputTokens === 'number'
      ? { maxOutputTokens: preparedTurn.maxOutputTokens }
      : {}),
    ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
    ...(options.autonomous ? { autonomous: { ...options.autonomous } } : {}),
    workspaceSelection,
    systemPrompt: [
      preparedTurn.enableTools ? TOOL_AGENT_SYSTEM_PROMPT : NO_TOOLS_SYSTEM_PROMPT,
      getPersonalityStylePrompt(options.personality),
    ]
      .filter(part => part.trim().length > 0)
      .join('\n\n'),
    contextTokens: preparedTurn.report.totalEstimatedTokens,
    skillMode: preparedTurn.skillMode,
    threadId: options.threadId,
    kind: options.runConfig?.kind ?? 'chat-turn',
    ...(options.runConfig?.parentRunId ? { parentRunId: options.runConfig.parentRunId } : {}),
    ...(options.runConfig?.rootRunId ? { rootRunId: options.runConfig.rootRunId } : {}),
    ...(options.runConfig?.adoptRunId ? { adoptRunId: options.runConfig.adoptRunId } : {}),
    runMetadata: { ...(options.runConfig?.metadata ?? {}) },
    transport,
  };
};

/** The harness reads its whole config from the plan. */
export const planToHarnessConfig = (
  plan: ExecutionPlan,
  overrides?: Partial<Pick<HarnessConfig, 'modelFactory' | 'guardActive'>>
): HarnessConfig => ({
  providerType: plan.providerType,
  ...(plan.providerId ? { providerId: plan.providerId } : {}),
  model: plan.model,
  systemPrompt: plan.systemPrompt,
  enableTools: plan.enableTools,
  enabledToolNames: plan.enabledTools,
  availableSkillIds: plan.availableSkillIds,
  guardActive: overrides?.guardActive ?? plan.guardActive,
  requireApproval: plan.requireApproval,
  autoApproveToolRequests: plan.autoApproveToolRequests,
  ...(plan.approvalPolicy ? { approvalPolicy: plan.approvalPolicy } : {}),
  maxIterations: plan.maxIterations,
  ...(typeof plan.maxOutputTokens === 'number' ? { maxOutputTokens: plan.maxOutputTokens } : {}),
  ...(typeof plan.maxInputTokens === 'number' ? { maxInputTokens: plan.maxInputTokens } : {}),
  ...(plan.reasoningEffort ? { reasoningEffort: plan.reasoningEffort } : {}),
  ...(plan.threadId ? { threadId: plan.threadId } : {}),
  ...(overrides?.modelFactory ? { modelFactory: overrides.modelFactory } : {}),
});

/**
 * The run row is the persisted version of the plan: identity, supply, tool
 * selection and the metadata block are written from the plan (plus per-entry
 * extras), so resume paths can rebuild the same plan from the row alone.
 */
export const planToRunTrackerParams = (
  plan: ExecutionPlan,
  params: {
    input: Pick<AgentRunInput, 'prompt' | 'messages'>;
    working: AgentRunWorkingState;
    metadataExtras?: Record<string, unknown>;
  }
) => ({
  kind: plan.kind,
  ...(plan.threadId ? { threadId: plan.threadId } : {}),
  ...(plan.parentRunId ? { parentRunId: plan.parentRunId } : {}),
  ...(plan.rootRunId ? { rootRunId: plan.rootRunId } : {}),
  ...(plan.adoptRunId ? { adoptExistingRunId: plan.adoptRunId } : {}),
  providerType: plan.providerType,
  ...(plan.providerId ? { providerId: plan.providerId } : {}),
  model: plan.model,
  systemPrompt: plan.systemPrompt,
  enabledTools: plan.enabledTools,
  availableSkillIds: plan.availableSkillIds,
  input: {
    ...params.input,
    metadata: {
      ...plan.runMetadata,
      transport: plan.transport,
      ...(plan.approvalPolicy ? { approvalPolicy: plan.approvalPolicy } : {}),
      requireApproval: plan.requireApproval,
      // Persisted so the run-row recovery path (retry / queued resume) can
      // restore them — the run row is those paths' only plan source, and a
      // silently dropped field is neither full recovery nor a new decision.
      ...(plan.reasoningEffort ? { reasoningEffort: plan.reasoningEffort } : {}),
      ...(plan.autonomous ? { autonomous: { ...plan.autonomous } } : {}),
      ...(typeof plan.contextTokens === 'number' ? { contextTokens: plan.contextTokens } : {}),
      skillMode: plan.skillMode,
      maxIterations: plan.maxIterations,
      enableTools: plan.enableTools,
      ...params.metadataExtras,
    },
  },
  working: params.working,
});
