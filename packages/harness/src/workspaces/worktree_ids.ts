export const THREAD_WORKTREE_WORKSPACE_PREFIX = 'workspace_wt_';

export const isThreadWorktreeWorkspaceId = (workspaceId: unknown): boolean =>
  typeof workspaceId === 'string' && workspaceId.startsWith(THREAD_WORKTREE_WORKSPACE_PREFIX);
