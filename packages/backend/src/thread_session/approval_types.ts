import type { ModelMessage } from 'ai';
import type { AgentRunKind } from '@iki/backend/types/agent_run';
import type { AgentResult, ToolApprovalRequest } from '@iki/backend/agent';
import type { ExecutionPlan } from './execution_plan';
import type { ChatStreamTarget } from './types';

/**
 * Result of the approval-resume execution. Transient: once the resume rides
 * the shared turn driver this collapses into OuterLoopStreamResult.
 */
export type ToolLoopStreamResult = {
  awaitingApproval: boolean;
  cancelled?: boolean;
  finished?: boolean;
  partialFailure?: boolean;
  response?: string;
  usage?: AgentResult['usage'];
  handoff?: {
    summary: string;
    nextSteps: string;
    reason: string;
  };
};

/**
 * The durable recovery handle for an approval pause: the paused turn's
 * ExecutionPlan plus the identities needed to continue it. The plan rides
 * along verbatim — the resumed execution must run under the same supply,
 * tool selection, policy, budgets and turn-start world (D30) as the paused
 * one, never a re-derivation from current config.
 */
export type ApprovalRecoveryContext = {
  plan: ExecutionPlan;
  sessionId: string;
  assistantMessageId: string;
  runId?: string;
};

export type RegisterApprovalBatch = (
  approvalRequests: ToolApprovalRequest[],
  session: {
    target: ChatStreamTarget;
    history?: ModelMessage[];
    recoveryContext?: ApprovalRecoveryContext;
  }
) => void;

export const describeApprovalRequiredTools = (
  requests: Array<{ toolCall?: { toolName: string } }>
): string => {
  const toolNames = requests
    .map(request => request.toolCall?.toolName)
    .filter(
      (toolName): toolName is string => typeof toolName === 'string' && toolName.trim().length > 0
    )
    .filter((toolName, index, list) => list.indexOf(toolName) === index);

  if (toolNames.length === 0) {
    return 'Tool approval required for non-interactive chat';
  }

  return `Tool approval required for non-interactive chat: ${toolNames.join(', ')}`;
};

export const createApprovalRecoveryContext = (params: {
  plan: ExecutionPlan;
  sessionId: string;
  runId?: string;
}): ApprovalRecoveryContext | undefined => {
  const sessionId = params.sessionId.trim();
  const threadId = typeof params.plan.threadId === 'string' ? params.plan.threadId.trim() : '';
  if (!threadId || !sessionId) return undefined;

  return {
    plan: params.plan,
    sessionId,
    assistantMessageId: sessionId,
    ...(typeof params.runId === 'string' && params.runId.trim()
      ? { runId: params.runId.trim() }
      : {}),
  };
};

/** Re-identify a plan for a child run (approval resume / handoff) without
 *  touching its supply, tool selection, policy, budgets or world binding. */
export const reidentifyPlan = (
  plan: ExecutionPlan,
  identity: {
    kind: AgentRunKind;
    parentRunId?: string;
    adoptRunId?: string;
    transport?: ExecutionPlan['transport'];
  }
): ExecutionPlan => ({
  ...plan,
  kind: identity.kind,
  ...(identity.parentRunId ? { parentRunId: identity.parentRunId } : {}),
  ...(identity.adoptRunId ? { adoptRunId: identity.adoptRunId } : {}),
  ...(identity.transport ? { transport: identity.transport } : {}),
});
