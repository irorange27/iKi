import * as toolCallApprovalDb from '@iki/backend/db/tool_call_approval';
import { serializeExecutionPlan } from './execution_plan_codec';
import {
  recordSessionEvents,
  APPROVAL_REQUESTED,
  SESSION_EVENT_VERSION,
} from './session_log';
import type { ApprovalRecoveryContext } from './approval_types';

export type ApprovalBatchRequest = {
  approvalId: string;
  toolCallId?: string;
  toolCall?: { toolName: string; args: Record<string, unknown> };
};

/**
 * Project a pending approval batch into durable state: the log facts first, then
 * the session row and the per-approval rows.
 *
 * Facts precede rows on purpose (ADR 008 F1). A crash between the two leaves an
 * approval the log knows about but the tables do not — the resume refuses, which
 * is the safe direction. The reverse would authorize an execution the replay
 * cannot see.
 */
export const persistApprovalBatch = (params: {
  requests: ApprovalBatchRequest[];
  recoveryContext: ApprovalRecoveryContext;
}): void => {
  const { requests, recoveryContext } = params;
  const plan = recoveryContext.plan;

  if (plan.threadId) {
    recordSessionEvents(
      plan.threadId,
      requests.map(request => ({
        type: APPROVAL_REQUESTED,
        version: SESSION_EVENT_VERSION,
        payload: {
          approvalId: request.approvalId,
          sessionId: recoveryContext.sessionId,
          ...(recoveryContext.runId ? { runId: recoveryContext.runId } : {}),
          ...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
          ...(request.toolCall?.toolName ? { toolName: request.toolCall.toolName } : {}),
          ...(request.toolCall?.args ? { args: request.toolCall.args } : {}),
        },
      }))
    );
  }

  toolCallApprovalDb.upsertToolCallApprovalSession({
    session_id: recoveryContext.sessionId,
    thread_id: plan.threadId ?? null,
    assistant_message_id: recoveryContext.assistantMessageId,
    run_id: recoveryContext.runId ?? null,
    provider_type: plan.providerType,
    provider_id: plan.providerId ?? null,
    model: plan.model,
    system_prompt: plan.systemPrompt,
    max_input_tokens: plan.maxInputTokens ?? null,
    max_output_tokens: plan.maxOutputTokens ?? null,
    max_iterations: plan.budget.step ?? null,
    enabled_tools: JSON.stringify(plan.enabledTools),
    available_skill_ids: JSON.stringify(plan.availableSkillIds),
    workspace_selection:
      plan.workspaceSelection !== undefined ? JSON.stringify(plan.workspaceSelection) : null,
    plan_json: serializeExecutionPlan(plan),
  } as never);

  toolCallApprovalDb.upsertToolCallApprovals(
    requests.map(request => ({
      approval_id: request.approvalId,
      session_id: recoveryContext.sessionId,
      tool_call_id: request.toolCallId || null,
      tool_name: request.toolCall?.toolName || null,
      tool_args: request.toolCall ? JSON.stringify(request.toolCall.args ?? {}) : null,
      state: 'pending',
    })) as never[]
  );
};
