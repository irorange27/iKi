import type { ModelMessage, ToolApprovalResponse } from '@iki/backend/message/model_history';
import type { ApprovalRecoveryContext } from './approval_types';
import type { ChatStreamTarget } from './types';

/**
 * Everything the executor needs to run one approved call.
 *
 * This lives in memory only. A pause that does not survive a restart does not
 * need a table. The proposal is still written to `session_events` as an
 * `approval_requested` fact before the human is asked — that fact is the audit
 * record of what was proposed — but resuming a pause after a crash is not a
 * supported state, so nothing reads it back to rebuild a session.
 */
export type ApprovalBinding = {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  messageId: string;
  workspace: string | null;
};

/** A paused turn awaiting a human decision. */
export type PendingApprovalSession = {
  sessionId?: string;
  target: ChatStreamTarget;
  recoveryContext?: ApprovalRecoveryContext;
  history?: ModelMessage[];
  pendingApprovalIds: Set<string>;
  collectedApprovalResponses: Map<string, ToolApprovalResponse>;
  bindings: Map<string, ApprovalBinding>;
  /** Drops the executor's binding registry entries when this session ends. */
  releases: Array<() => void>;
  timeouts: Map<string, ReturnType<typeof setTimeout>>;
};
