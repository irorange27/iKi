import type { ModelMessage, ToolApprovalResponse } from '@iki/backend/message/model_history';
import type { ApprovalRecoveryContext } from './approval_types';
import type { ChatStreamTarget } from './types';

/** A paused turn awaiting a human decision, live in memory or rebuilt from the log. */
export type PendingApprovalSession = {
  sessionId?: string;
  target: ChatStreamTarget;
  recoveryContext?: ApprovalRecoveryContext;
  history?: ModelMessage[];
  pendingApprovalIds: Set<string>;
  collectedApprovalResponses: Map<string, ToolApprovalResponse>;
  timeouts: Map<string, ReturnType<typeof setTimeout>>;
};
