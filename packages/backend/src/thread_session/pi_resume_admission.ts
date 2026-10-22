import type { ModelMessage } from '@iki/backend/message/model_history';
import type { ApprovalBinding } from './approval_session';
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
  bindings: Map<string, ApprovalBinding>;
  onRefuse: () => void;
}): PiResumeAdmission | undefined => {
  const { plan, history } = params;
  if (!plan?.threadId || !pausedPlanRunsOnPiToolSupply(plan, history)) {
    return undefined;
  }

  try {
    const commands = Array.from(params.pendingApprovalIds).flatMap((approvalId: string) => {
      const binding = params.bindings.get(approvalId);
      if (!binding) {
        throw new Error(`Approval ${approvalId} is missing its execution binding.`);
      }
      return [
        {
          approvalId,
          toolCallId: binding.toolCallId,
          toolName: binding.toolName,
          args: binding.args,
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
