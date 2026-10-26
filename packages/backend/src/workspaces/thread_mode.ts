import type { ApprovalPolicy } from '@iki/backend/utils/action_risk';
import { isObjectRecord } from '@iki/backend/utils/guards';
import { THREAD_WORKTREE_WORKSPACE_PREFIX } from './worktree_ids';

export type ThreadWorkMode = 'chat' | 'work';

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

const THREAD_WORK_MODE_METADATA_KEY = 'mode';

const isScratchOrWorktreeWorkspaceId = (workspaceId: string): boolean =>
  workspaceId.startsWith(THREAD_SCRATCH_WORKSPACE_PREFIX) ||
  workspaceId.startsWith(THREAD_WORKTREE_WORKSPACE_PREFIX);

export const resolveThreadWorkMode = (
  thread:
    | {
        workspace_id?: string | null;
        metadata?: string | null;
      }
    | null
    | undefined
): ThreadWorkMode => {
  if (isObjectRecord(thread) || thread) {
    const metadataRaw = typeof thread?.metadata === 'string' ? thread.metadata : '';
    if (metadataRaw.trim()) {
      try {
        const parsed: unknown = JSON.parse(metadataRaw);
        if (isObjectRecord(parsed)) {
          const mode = parsed[THREAD_WORK_MODE_METADATA_KEY];
          if (mode === 'work' || mode === 'chat') return mode;
        }
      } catch {
    // Intentionally ignored: the caller cannot act on it.
  }
    }

    const workspaceId = typeof thread?.workspace_id === 'string' ? thread.workspace_id.trim() : '';
    if (workspaceId && !isScratchOrWorktreeWorkspaceId(workspaceId)) return 'work';
  }

  return 'chat';
};
