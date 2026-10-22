import { createLogger } from '@iki/backend/logger';
import type { ModelMessage, ToolApprovalResponse } from '@iki/backend/message/model_history';

import * as agentRunDb from '@iki/backend/db/agent_runs';
import * as toolCallApprovalDb from '@iki/backend/db/tool_call_approval';
import { parseJsonStringArray } from '@iki/backend/utils/json';
import { deriveRunTurnPlan, resumeHistoryFromReplay } from './run_rehydrator';
import { parseExecutionPlan } from './execution_plan_codec';
import { rebuildThreadViewFromEvents } from './session_log';
import { parseStoredWorkspaceSelection } from '../workspaces/thread_workspace';
import type { ExecutionPlan } from './execution_plan';
import type { RecoveredApprovalSession } from './approval_types';

/**
 * Rebuild a pending approval session from persisted state after a restart.
 *
 * Returns the recovered session, or null when the log cannot prove the history
 * the paused turn was built on. The caller owns registration and timeouts: this
 * function only reads.
 */
export const recoverApprovalSession = async (
  approvalId: string
): Promise<Omit<RecoveredApprovalSession, 'target'> | null> => {
  if (!approvalId || typeof approvalId !== 'string') return null;
  const needle = approvalId.trim();
  if (!needle) return null;

  const approvalRecord = toolCallApprovalDb.getToolCallApproval(needle);
  if (!approvalRecord) return null;

  const approvalSession = toolCallApprovalDb.getToolCallApprovalSession(approvalRecord.session_id);
  if (!approvalSession) return null;

  const activeApprovals = toolCallApprovalDb.getActiveToolCallApprovalsBySession(
    approvalSession.session_id
  );
  if (activeApprovals.length === 0) return null;

  const fallbackToolNames = Array.from(
    new Set(
      activeApprovals
        .map(record => (typeof record.tool_name === 'string' ? record.tool_name.trim() : ''))
        .filter(Boolean)
    )
  );
  const storedRunId =
    typeof approvalSession.run_id === 'string' ? approvalSession.run_id.trim() : '';
  const activeApprovalIds = activeApprovals.map(record => record.approval_id);

  const threadId = approvalSession.thread_id ?? null;
  if (!threadId) return null;

  const replay = rebuildThreadViewFromEvents(threadId);
  const replayApprovalIds = new Set(replay.approvals.map(approval => approval.approvalId));
  const unrecordedApprovals = activeApprovalIds.filter(id => !replayApprovalIds.has(id));

  const replayHistory = await resumeHistoryFromReplay(replay);

  const replayWithSystem = replayHistory
    ? [
        ...replay.inputSystemPrompts.map(content => ({ role: 'system', content }) as ModelMessage),
        ...replayHistory,
      ]
    : null;
  const inputMessages =
    unrecordedApprovals.length === 0 && replayWithSystem ? replayWithSystem : null;
  if (!inputMessages || inputMessages.length === 0) {
    createLogger({ module: 'chat_approval' }).event({
      level: 'warn',
      event: 'chat.approval.resume_history',
      outcome: 'denied',
      entity: { thread_id: threadId },
      message:
        'Approval resume refused: the session log has no history or misses the pending approvals.',
      data: {
        run_id: storedRunId || null,
        unrecorded_approval_ids: unrecordedApprovals,
      },
    });
    return null;
  }

  const replayPlan = storedRunId
    ? replay.turns.find(turn => turn.runId === storedRunId)?.plan
    : undefined;
  const parsedPlan = replayPlan ?? parseExecutionPlan(approvalSession.plan_json);
  const runSnapshot = !parsedPlan && storedRunId ? agentRunDb.getAgentRun(storedRunId) : null;
  const derivedPlan = deriveRunTurnPlan(runSnapshot, {
    providerType: approvalSession.provider_type,
    providerId: approvalSession.provider_id,
    model: approvalSession.model,
    systemPrompt: approvalSession.system_prompt,
    enabledTools: parseJsonStringArray(approvalSession.enabled_tools),
    availableSkillIds: parseJsonStringArray(approvalSession.available_skill_ids),
    maxIterations: approvalSession.max_iterations ?? undefined,
  });
  const resolvedToolNames =
    derivedPlan.enabledTools.length > 0
      ? derivedPlan.enabledTools
      : Array.from(
          new Set(
            [...fallbackToolNames, ...activeApprovals.map(record => record.tool_name ?? '')]
              .map(toolName => (typeof toolName === 'string' ? toolName.trim() : ''))
              .filter(Boolean)
          )
        );

  const pendingApprovalIds = new Set(activeApprovals.map(record => record.approval_id));
  const collectedApprovalResponses = new Map<string, ToolApprovalResponse>();
  for (const record of activeApprovals) {
    if (record.state !== 'answered' || !record.decision) continue;
    collectedApprovalResponses.set(record.approval_id, {
      type: 'tool-approval-response',
      approvalId: record.approval_id,
      approved: record.decision === 'approved',
      reason:
        typeof record.decision_reason === 'string' && record.decision_reason.trim()
          ? record.decision_reason
          : record.decision === 'approved'
            ? 'User approved tool execution.'
            : 'User rejected tool execution.',
    });
  }

  const plan: ExecutionPlan = parsedPlan ?? {
    providerType: derivedPlan.providerType,
    ...(derivedPlan.providerId ? { providerId: derivedPlan.providerId } : {}),
    model: derivedPlan.model,

    enableTools: true,
    enabledTools: resolvedToolNames,
    availableSkillIds: derivedPlan.availableSkillIds,
    requireApproval: derivedPlan.requireApproval ?? true,
    autoApproveToolRequests: false,
    ...(derivedPlan.approvalPolicy ? { approvalPolicy: derivedPlan.approvalPolicy } : {}),

    budget: {
      step: derivedPlan.maxIterations,
      ...(derivedPlan.autonomous
        ? {
            batch: {
              max: derivedPlan.autonomous.maxIterations,
              ...(derivedPlan.autonomous.continuePrompt
                ? { continuePrompt: derivedPlan.autonomous.continuePrompt }
                : {}),
            },
          }
        : {}),
    },

    ...(derivedPlan.reasoningEffort ? { reasoningEffort: derivedPlan.reasoningEffort } : {}),
    ...(typeof approvalSession.max_input_tokens === 'number'
      ? { maxInputTokens: approvalSession.max_input_tokens }
      : {}),
    ...(typeof approvalSession.max_output_tokens === 'number'
      ? { maxOutputTokens: approvalSession.max_output_tokens }
      : {}),
    systemPrompt: derivedPlan.systemPrompt,
    skillMode: 'manual',
    threadId,
    kind: 'chat-turn',
    runMetadata: {},
    transport: 'approval-resume',
    workspaceSelection: parseStoredWorkspaceSelection(approvalSession.workspace_selection),
  };

  return {
    sessionId: approvalSession.session_id,
    history: inputMessages,
    recoveryContext: {
      plan,
      sessionId: approvalSession.session_id,
      assistantMessageId: approvalSession.assistant_message_id,
      ...(storedRunId ? { runId: storedRunId } : {}),
    },
    pendingApprovalIds,
    collectedApprovalResponses,
  };
};
