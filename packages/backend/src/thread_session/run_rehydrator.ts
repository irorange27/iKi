import type { ModelMessage } from '../message/model_history';

import type { AgentRun } from '@iki/backend/types/agent_run';
import type { ApprovalPolicy } from '../agent/harness/tool_resolver';
import type { ChatTurnOptions } from '../turn_prep/turn_preparer';
import { toModelInputMessages } from '@iki/backend/message/ui_messages';
import {
  rebuildThreadViewFromEvents,
  APPROVAL_REQUESTED,
  TOOL_EXECUTED,
  type RebuiltThreadView,
} from './session_log';
import { TOOL_EXECUTION_FINISHED, TOOL_EXECUTION_STARTED } from './tool_execution';
import { parseApprovalPolicy } from '../workspaces/thread_mode';
import { resolveToolCallMaxIterations } from './constants';

export type RunTurnPlan = {
  providerType: string;
  providerId?: string;
  model: string;
  systemPrompt: string;
  enabledTools: string[];
  availableSkillIds: string[];
  approvalPolicy?: ApprovalPolicy;

  requireApproval?: boolean;

  maxIterations: number;

  reasoningEffort?: string;

  autonomous?: { maxIterations: number; continuePrompt?: string };

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

const getRunMaxIterations = (run: AgentRun | null | undefined): number | undefined => {
  const value = run?.input?.metadata?.maxIterations;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.trunc(value));
};

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

export const journaledExchangePairs = (
  events: RebuiltThreadView['events'],
  chainRunIds: string[]
): ModelMessage[] => {
  if (chainRunIds.length === 0) return [];
  const chain = new Set(chainRunIds);
  const chainApprovalIds = new Set<string>();

  const startedApprovalIds = new Set<string>();

  const finishedApprovalIds = new Set<string>();
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
  if (chainApprovalIds.size === 0 && !events.some(event => event.type === TOOL_EXECUTED)) return [];
  const pairs: ModelMessage[] = [];
  const pushPair = (
    toolCallId: string,
    toolName: string,
    args: unknown,
    output: unknown
  ) => {
    pairs.push(
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId, toolName, input: args }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId,
            toolName,

            output: output as Extract<
              Extract<ModelMessage, { role: 'tool' }>['content'][number],
              { type: 'tool-result' }
            >['output'],
          },
        ],
      }
    );
  };
  const unrepresentable = () =>
    new Error('A journaled tool execution of the dead chain cannot be represented from the log.');
  for (const event of events) {
    if (event.type === TOOL_EXECUTION_STARTED) {
      const payload = event.payload as { binding?: { approvalId?: unknown } };
      const approvalId = payload.binding?.approvalId;
      if (typeof approvalId === 'string' && chainApprovalIds.has(approvalId)) {
        startedApprovalIds.add(approvalId);
      }
      continue;
    }
    if (event.type === TOOL_EXECUTION_FINISHED) {
      const payload = event.payload as {
        binding?: {
          approvalId?: unknown;
          toolCallId?: unknown;
          toolName?: unknown;
          args?: unknown;
        };
        result?: { toolCallId?: unknown; toolName?: unknown; output?: unknown };
      };
      const binding = payload.binding;
      const result = payload.result;
      if (
        !binding ||
        typeof binding.approvalId !== 'string' ||
        !chainApprovalIds.has(binding.approvalId)
      )
        continue;
      if (
        typeof binding.toolCallId !== 'string' ||
        typeof binding.toolName !== 'string' ||
        typeof binding.args !== 'object' ||
        binding.args === null ||
        !result ||
        result.toolCallId !== binding.toolCallId ||
        result.toolName !== binding.toolName
      ) {
        throw unrepresentable();
      }
      finishedApprovalIds.add(binding.approvalId);
      pushPair(binding.toolCallId, binding.toolName, binding.args, result.output);
      continue;
    }
    if (event.type === TOOL_EXECUTED) {
      const payload = event.payload as {
        runId?: unknown;
        toolCallId?: unknown;
        toolName?: unknown;
        args?: unknown;
        result?: { toolCallId?: unknown; toolName?: unknown; output?: unknown };
      };
      if (typeof payload.runId !== 'string' || !chain.has(payload.runId)) continue;
      if (
        typeof payload.toolCallId !== 'string' ||
        payload.toolCallId.length === 0 ||
        typeof payload.toolName !== 'string' ||
        typeof payload.args !== 'object' ||
        payload.args === null ||
        !payload.result ||
        payload.result.toolCallId !== payload.toolCallId ||
        payload.result.toolName !== payload.toolName
      ) {
        throw unrepresentable();
      }
      pushPair(payload.toolCallId, payload.toolName, payload.args, payload.result.output);
    }
  }

  for (const approvalId of startedApprovalIds) {
    if (!finishedApprovalIds.has(approvalId)) {
      throw new Error(
        'A tool execution of the dead chain started but never recorded its outcome; its effect is unknown and the recovery cannot continue.'
      );
    }
  }
  return pairs;
};

export const resumeHistoryFromReplay = async (
  replay: RebuiltThreadView
): Promise<ModelMessage[] | null> => {
  if (replay.messages.length === 0) return null;
  return await toModelInputMessages(replay.messages, { repairInterruptedTools: false });
};

export const rebuildResumeHistoryFromEvents = async (
  threadId: string,
  excludeRunIds?: string[]
): Promise<{
  history: ModelMessage[];
  systemPrompts: string[];
  continuation: boolean;
  inputRunId?: string;
} | null> => {
  const replay = rebuildThreadViewFromEvents(threadId, { excludeRunIds });
  const history = await resumeHistoryFromReplay(replay);
  if (!history) return null;
  const exchanges = journaledExchangePairs(replay.events, excludeRunIds ?? []);
  return {
    history: [...history, ...exchanges],
    systemPrompts: replay.inputSystemPrompts,
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

    systemPrompts?: string[];
  }
): ChatTurnOptions => {
  const plan = deriveRunTurnPlan(run);
  const recordedMessages = overrides.inputMessages ?? [];
  const systemMessages = (overrides.systemPrompts ?? []).map(
    content => ({ role: 'system', content }) as ModelMessage
  );

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

    messages: [...systemMessages, ...recordedMessages] as ChatTurnOptions['messages'],
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
