import type { ModelMessage } from '../message/model_history';
import type { AgentRunKind } from '@iki/backend/types/agent_run';
import type { ToolApprovalRequest } from '@iki/backend/agent';
import type { ExecutionPlan } from './execution_plan';
import type { ChatStreamTarget } from './types';

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

export const reidentifyPlan = (
  plan: ExecutionPlan,
  identity: {
    kind: AgentRunKind;
    parentRunId?: string;
    adoptRunId?: string;
    transport?: ExecutionPlan['transport'];
  }
): ExecutionPlan => {
  const child: ExecutionPlan = {
    ...plan,
    kind: identity.kind,
    ...(identity.parentRunId ? { parentRunId: identity.parentRunId } : {}),
    ...(identity.transport ? { transport: identity.transport } : {}),
  };
  delete child.adoptRunId;
  if (identity.adoptRunId) child.adoptRunId = identity.adoptRunId;
  return child;
};
