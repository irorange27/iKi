import type {
  AgentRunInput,
  AgentRunKind,
  AgentRunWorkingState,
} from '@iki/backend/types/agent_run';
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

export type ExecutionPlan = {

  providerType: string;
  providerId?: string;
  model: string;

  enableTools: boolean;
  enabledTools: string[];
  availableSkillIds: string[];
  requireApproval: boolean;
  autoApproveToolRequests: boolean;
  approvalPolicy?: ApprovalPolicy;

  budget: {
    step: number;
    batch?: { max: number; continuePrompt?: string };
  };

  maxInputTokens?: number;
  maxOutputTokens?: number;
  reasoningEffort?: string;

  workspaceSelection?: ThreadWorkspaceSelection | null;

  systemPrompt: string;
  contextTokens?: number;
  skillMode: 'manual' | 'auto';

  threadId?: string;
  kind: AgentRunKind;
  parentRunId?: string;
  rootRunId?: string;

  adoptRunId?: string;

  runMetadata: Record<string, unknown>;

  transport: 'stream' | 'send' | 'approval-resume';
};

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
    requireApproval: preparedTurn.requireApproval,
    autoApproveToolRequests: preparedTurn.autoApproveToolRequests,
    ...(approvalPolicy ? { approvalPolicy } : {}),
    budget: {
      step: resolveToolCallMaxIterations(options.maxIterations),
      ...(options.autonomous
        ? {
            batch: {
              max: options.autonomous.maxIterations,
              ...(options.autonomous.continuePrompt
                ? { continuePrompt: options.autonomous.continuePrompt }
                : {}),
            },
          }
        : {}),
    },
    ...(typeof preparedTurn.maxInputTokens === 'number'
      ? { maxInputTokens: preparedTurn.maxInputTokens }
      : {}),
    ...(typeof preparedTurn.maxOutputTokens === 'number'
      ? { maxOutputTokens: preparedTurn.maxOutputTokens }
      : {}),
    ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
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

export const planToHarnessConfig = (plan: ExecutionPlan): HarnessConfig => ({
  providerType: plan.providerType,
  ...(plan.providerId ? { providerId: plan.providerId } : {}),
  model: plan.model,
  systemPrompt: plan.systemPrompt,
  enableTools: plan.enableTools,
  enabledToolNames: plan.enabledTools,
  availableSkillIds: plan.availableSkillIds,
  requireApproval: plan.requireApproval,
  autoApproveToolRequests: plan.autoApproveToolRequests,
  ...(plan.approvalPolicy ? { approvalPolicy: plan.approvalPolicy } : {}),
  maxIterations: plan.budget.step,
  ...(typeof plan.maxOutputTokens === 'number' ? { maxOutputTokens: plan.maxOutputTokens } : {}),
  ...(typeof plan.maxInputTokens === 'number' ? { maxInputTokens: plan.maxInputTokens } : {}),
  ...(plan.reasoningEffort ? { reasoningEffort: plan.reasoningEffort } : {}),
  ...(plan.threadId ? { threadId: plan.threadId } : {}),
});

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

      ...(plan.reasoningEffort ? { reasoningEffort: plan.reasoningEffort } : {}),
      ...(plan.budget.batch
        ? {
            autonomous: {
              maxIterations: plan.budget.batch.max,
              ...(plan.budget.batch.continuePrompt
                ? { continuePrompt: plan.budget.batch.continuePrompt }
                : {}),
            },
          }
        : {}),

      ...(plan.workspaceSelection !== undefined
        ? { workspaceSelection: plan.workspaceSelection }
        : {}),
      ...(typeof plan.contextTokens === 'number' ? { contextTokens: plan.contextTokens } : {}),
      skillMode: plan.skillMode,
      maxIterations: plan.budget.step,
      enableTools: plan.enableTools,
      ...params.metadataExtras,
    },
  },
  working: params.working,
});
