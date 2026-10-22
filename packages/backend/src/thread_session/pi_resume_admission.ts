import type { ModelMessage } from '@iki/backend/message/model_history';
import * as toolCallApprovalDb from '@iki/backend/db/tool_call_approval';
import { pausedPlanRunsOnPiToolSupply } from './turn_supply_selection';
import { prepareToolExecution } from './tool_execution';
import type { ExecutionPlan } from './execution_plan';

export type PiResumeAdmission = {
  threadId: string;
  commands: Array<{
    approvalId: string;
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
  }>;
};

/**
 * Decide whether a paused turn can resume on the Pi tool supply, and build the
 * resume commands it needs.
 *
 * Returns undefined when the paused plan was not on that supply at all — the
 * caller then refuses the resume rather than falling back, because a plan whose
 * provider row vanished mid-turn has no honest continuation. Throws when the
 * plan IS on the supply but a pending approval row is missing its execution
 * binding: that is a corrupt row, not a supply mismatch, and it must not be
 * silently skipped.
 *
 * `prepareToolExecution` runs per command before returning, so a resume that
 * cannot prepare its calls fails here rather than inside the harness.
 */
export const admitPiResume = (params: {
  plan: ExecutionPlan | undefined;
  history: ModelMessage[];
  pendingApprovalIds: Iterable<string>;
  onRefuse: () => void;
}): PiResumeAdmission | undefined => {
  const { plan, history } = params;
  if (!plan?.threadId || !pausedPlanRunsOnPiToolSupply(plan, history)) {
    return undefined;
  }

  try {
    const commands = Array.from(params.pendingApprovalIds).flatMap((approvalId: string) => {
      const row = toolCallApprovalDb.getToolCallApproval(approvalId);
      if (!row?.tool_call_id || !row.tool_name) {
        throw new Error(`Approval row ${approvalId} is missing its execution binding.`);
      }
      return [
        {
          approvalId,
          toolCallId: row.tool_call_id,
          toolName: row.tool_name,
          args: JSON.parse(row.tool_args ?? '{}') as Record<string, unknown>,
        },
      ];
    });
    for (const command of commands) {
      prepareToolExecution({ threadId: plan.threadId, approvalId: command.approvalId });
    }
    return { commands, threadId: plan.threadId };
  } catch (error) {
    params.onRefuse();
    throw error;
  }
};
