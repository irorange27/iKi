import { THREAD_SCRATCH_WORKSPACE_PREFIX } from '@iki/harness/workspaces/thread_mode';
import { THREAD_WORKTREE_WORKSPACE_PREFIX } from '@iki/harness/workspaces/worktree_ids';

export const normalizeWorkspaceId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const isThreadPrivateWorkspaceId = (workspaceId: string): boolean =>
  workspaceId.startsWith(THREAD_SCRATCH_WORKSPACE_PREFIX) ||
  workspaceId.startsWith(THREAD_WORKTREE_WORKSPACE_PREFIX);

export const normalizeModelId = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

export const normalizeProviderId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};
