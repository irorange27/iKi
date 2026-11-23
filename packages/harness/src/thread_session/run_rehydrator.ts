import type { ModelMessage } from '@iki/llm/message/model_history';

import type { AgentRun } from '@iki/core/types/agent_run';
import type { ApprovalPolicy } from '../agent/harness/tool_resolver';
import type { ChatTurnOptions } from '../turn_prep/turn_preparer';
import { toModelInputMessages } from '@iki/llm/message/ui_messages';
import {
  rebuildThreadViewFromEvents,
  selectMessagesForCompaction,
  APPROVAL_REQUESTED,
  TOOL_EXECUTED,
  type RebuiltThreadView,
} from './session_log';
import {
  exchangeToModelMessages,
  readToolExecutionFact,
} from './tool_execution';
import { parseApprovalPolicy } from '../workspaces/thread_mode';
import type { ThreadWorkspaceSelection } from '../workspaces/thread_workspace';
import { resolveToolCallMaxIterations } from './constants';

/**
 * The turn plan recovered from a persisted run row, for resume and retry.
 *
 * No system prompt lives here on purpose: `turn_prep` composes the prompt for the
 * turn being started now. A resumed turn that replayed the prompt recorded on the
 * dead run would send two system prompts (the stale one plus the current one), and
 * the stale copy carries a workspace, skill list and instructions that may no
 * longer be true.
 */
type RunTurnPlan = {
  providerType: string;
  providerId?: string;
  model: string;
  enabledTools: string[];
  availableSkillIds: string[];
  approvalPolicy?: ApprovalPolicy;

  requireApproval?: boolean;

  maxIterations: number;

  reasoningEffort?: string;

  autonomous?: { maxIterations: number; continuePrompt?: string };

  workspaceSelection?: ThreadWorkspaceSelection | null;
};

const trimmedOrUndefined = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const getRunMaxIterations = (run: AgentRun): number | undefined => {
  const value = run.input?.metadata?.maxIterations;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.trunc(value));
};

export const deriveRunTurnPlan = (run: AgentRun): RunTurnPlan => {
  const metadata = run.input?.metadata ?? {};
  const requireApproval =
    typeof metadata.requireApproval === 'boolean' ? metadata.requireApproval : undefined;
  const reasoningEffort = trimmedOrUndefined(metadata.reasoningEffort);
  const workspaceSelectionMetadata = metadata.workspaceSelection;
  const workspaceSelection =
    workspaceSelectionMetadata === null ||
    (workspaceSelectionMetadata && typeof workspaceSelectionMetadata === 'object')
      ? (workspaceSelectionMetadata as ThreadWorkspaceSelection | null)
      : undefined;
  const autonomousMetadata = metadata.autonomous as
    | { maxIterations?: unknown; continuePrompt?: unknown }
    | undefined;
  const autonomous =
    autonomousMetadata &&
    typeof autonomousMetadata === 'object' &&
    typeof autonomousMetadata.maxIterations === 'number' &&
    Number.isFinite(autonomousMetadata.maxIterations)
      ? {
          maxIterations: Math.max(1, Math.trunc(autonomousMetadata.maxIterations)),
          ...(typeof autonomousMetadata.continuePrompt === 'string' &&
          autonomousMetadata.continuePrompt
            ? { continuePrompt: autonomousMetadata.continuePrompt }
            : {}),
        }
      : undefined;

  return {
    providerType: trimmedOrUndefined(run.providerType) ?? '',
    providerId: trimmedOrUndefined(run.providerId),
    model: trimmedOrUndefined(run.model) ?? '',
    enabledTools: run.enabledTools ?? [],
    availableSkillIds: run.availableSkillIds ?? [],
    approvalPolicy: parseApprovalPolicy(metadata.approvalPolicy) ?? undefined,
    requireApproval,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(autonomous ? { autonomous } : {}),
    ...(workspaceSelection !== undefined ? { workspaceSelection } : {}),
    maxIterations: resolveToolCallMaxIterations(getRunMaxIterations(run)),
  };
};

type ResumeKind = NonNullable<NonNullable<ChatTurnOptions['runConfig']>['kind']>;

/** A journal entry whose shape this build cannot read. */
export class UnrepresentableExecutionError extends Error {
  constructor() {
    super('A journaled tool execution of the dead chain cannot be represented from the log.');
    this.name = 'UnrepresentableExecutionError';
  }
}

/** An execution that began but never recorded what it did. */
export class UnfinishedExecutionError extends Error {
  constructor() {
    super(
      'A tool execution of the dead chain started but never recorded its outcome; its effect is unknown and the recovery cannot continue.'
    );
    this.name = 'UnfinishedExecutionError';
  }
}

export const journaledExchangePairs = (
  events: RebuiltThreadView['events'],
  chainRunIds: string[]
): ModelMessage[] => {
  if (chainRunIds.length === 0) return [];
  const chain = new Set(chainRunIds);
  const chainApprovalIds = new Set<string>();
  for (const event of events) {
    if (event.type !== APPROVAL_REQUESTED) continue;
    const payload = event.payload as { approvalId?: unknown; runId?: unknown };
    if (
      typeof payload.approvalId === 'string' &&
      typeof payload.runId === 'string' &&
      chain.has(payload.runId)
    ) {
      chainApprovalIds.add(payload.approvalId);
    }
  }

  const pairs: ModelMessage[] = [];
  const finishedApprovalIds = new Set<string>();
  const startedApprovalIds = new Set<string>();

  for (const event of events) {
    const fact = readToolExecutionFact(event);
    if (fact) {
      if (!chainApprovalIds.has(fact.approvalId)) continue;
      if (fact.kind === 'unreadable') throw new UnrepresentableExecutionError();
      startedApprovalIds.add(fact.approvalId);
      if (fact.kind === 'exchange') {
        finishedApprovalIds.add(fact.approvalId);
        pairs.push(...exchangeToModelMessages(fact.exchange));
      }
      continue;
    }
    if (event.type !== TOOL_EXECUTED) continue;
    const payload = event.payload as {
      runId?: unknown;
      toolCallId?: unknown;
      toolName?: unknown;
      args?: unknown;
      output?: unknown;
    };
    if (typeof payload.runId !== 'string' || !chain.has(payload.runId)) continue;
    if (
      typeof payload.toolCallId !== 'string' ||
      !payload.toolCallId ||
      typeof payload.toolName !== 'string' ||
      !payload.toolName ||
      payload.output === undefined
    ) {
      throw new UnrepresentableExecutionError();
    }
    pairs.push(
      ...exchangeToModelMessages({
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        args: payload.args,
        output: payload.output,
      })
    );
  }

  // An execution that started but never recorded its outcome has an unknown effect:
  // the tool may have half-run. Rebuilding history around it would tell the model
  // the call produced something, so recovery refuses to continue instead.
  for (const approvalId of startedApprovalIds) {
    if (!finishedApprovalIds.has(approvalId)) throw new UnfinishedExecutionError();
  }
  return pairs;
};

const resumeHistoryFromReplay = async (
  replay: RebuiltThreadView
): Promise<ModelMessage[] | null> => {
  if (replay.messages.length === 0) return null;
  const activeMessages = selectMessagesForCompaction(replay.messages, replay.compaction).messages;
  return await toModelInputMessages(activeMessages, { repairInterruptedTools: false });
};

export const rebuildResumeHistoryFromEvents = async (
  threadId: string,
  excludeRunIds?: string[]
): Promise<{
  history: ModelMessage[];
  continuation: boolean;
  inputRunId?: string;
} | null> => {
  const replay = rebuildThreadViewFromEvents(threadId, { excludeRunIds });
  const history = await resumeHistoryFromReplay(replay);
  if (!history) return null;
  const exchanges = journaledExchangePairs(replay.events, excludeRunIds ?? []);
  return {
    history: [...history, ...exchanges],
    continuation: exchanges.length > 0,
    ...(replay.inputRunId ? { inputRunId: replay.inputRunId } : {}),
  };
};

export const deriveResumeStreamOptions = (
  run: AgentRun,
  overrides: {
    kind: ResumeKind;
    parentRunId?: string;
    metadata?: Record<string, unknown>;

    continuePrompt?: string;

    adoptRunId?: string;

    inputMessages?: ModelMessage[];
  }
): ChatTurnOptions => {
  const plan = deriveRunTurnPlan(run);
  const recordedMessages = overrides.inputMessages ?? [];

  const continuation = recordedMessages.at(-1)?.role === 'tool';
  const { continuation: _stripped, ...callerMetadata } = (overrides.metadata ??
    {}) as Record<string, unknown>;
  const runMetadata: Record<string, unknown> = {
    ...callerMetadata,
    ...(continuation ? { continuation: true } : {}),
  };

  const batch =
    plan.autonomous && overrides.continuePrompt
      ? { ...plan.autonomous, continuePrompt: overrides.continuePrompt }
      : plan.autonomous;
  return {
    providerType: plan.providerType,
    ...(plan.providerId ? { providerId: plan.providerId } : {}),
    model: plan.model,
    ...(plan.approvalPolicy ? { approvalPolicy: plan.approvalPolicy } : {}),
    ...(plan.requireApproval !== undefined ? { requireApproval: plan.requireApproval } : {}),
    ...(plan.reasoningEffort ? { reasoningEffort: plan.reasoningEffort } : {}),
    ...(batch ? { autonomous: { ...batch } } : {}),
    ...(plan.workspaceSelection !== undefined
      ? { workspaceSelection: plan.workspaceSelection }
      : {}),
    maxIterations: plan.maxIterations,

    messages: recordedMessages as ChatTurnOptions['messages'],
    threadId: run.threadId ?? undefined,
    tools: plan.enabledTools,
    skillIds: plan.availableSkillIds,
    runConfig: {
      kind: overrides.kind,
      ...(overrides.parentRunId ? { parentRunId: overrides.parentRunId } : {}),
      rootRunId: run.rootRunId,
      ...(overrides.adoptRunId ? { adoptRunId: overrides.adoptRunId } : {}),
      ...(Object.keys(runMetadata).length > 0 ? { metadata: runMetadata } : {}),
    },
  };
};
