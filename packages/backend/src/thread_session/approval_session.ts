import type { ModelMessage, ToolApprovalResponse } from '@iki/backend/message/model_history';
import type { ApprovalRecoveryContext } from './approval_types';
import type { ChatStreamTarget } from './types';

export type ApprovalBinding = {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  messageId: string;
  workspace: string | null;
};

export type PendingApprovalSession = {
  sessionId?: string;
  target: ChatStreamTarget;
  recoveryContext?: ApprovalRecoveryContext;
  history?: ModelMessage[];
  pendingApprovalIds: Set<string>;
  collectedApprovalResponses: Map<string, ToolApprovalResponse>;
  bindings: Map<string, ApprovalBinding>;
  releases: Array<() => void>;
  timeouts: Map<string, ReturnType<typeof setTimeout>>;
};
