import type { ApprovalPolicy } from '@iki/core/utils/action_risk';
import type { ThreadWorkMode } from '@iki/core/types/chat';
import { THREAD_WORKTREE_WORKSPACE_PREFIX } from './worktree_ids';

export type { ThreadWorkMode };

export type { ApprovalPolicy };

export const THREAD_APPROVAL_POLICY_KEY = 'approvalPolicy';

const THREAD_APPROVAL_POLICIES: readonly ApprovalPolicy[] = [
  'never',
  'trustWorkspace',
  'askRisky',
  'always',
];

export const parseApprovalPolicy = (value: unknown): ApprovalPolicy | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return THREAD_APPROVAL_POLICIES.find(policy => policy.toLowerCase() === trimmed) ?? null;
};

export const THREAD_SCRATCH_WORKSPACE_PREFIX = 'workspace_thread_';

const isScratchOrWorktreeWorkspaceId = (workspaceId: string): boolean =>
  workspaceId.startsWith(THREAD_SCRATCH_WORKSPACE_PREFIX) ||
  workspaceId.startsWith(THREAD_WORKTREE_WORKSPACE_PREFIX);

export const resolveThreadWorkMode = (
  thread: { workspace_id?: string | null; work_mode?: ThreadWorkMode | null } | null | undefined
): ThreadWorkMode => {
  if (!thread) return 'chat';

  if (thread.work_mode === 'work' || thread.work_mode === 'chat') return thread.work_mode;

  const workspaceId = typeof thread.workspace_id === 'string' ? thread.workspace_id.trim() : '';
  if (workspaceId && !isScratchOrWorktreeWorkspaceId(workspaceId)) return 'work';

  return 'chat';
};
