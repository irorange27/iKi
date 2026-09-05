/**
 * Dependency-free worktree id conventions. Kept separate from git_worktree.ts
 * so renderer code can import the id prefix without pulling the db layer into
 * the browser bundle.
 */

export const THREAD_WORKTREE_WORKSPACE_PREFIX = 'workspace_wt_';
