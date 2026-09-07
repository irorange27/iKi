export type ThreadWorktreeResult =
  | {
      ok: true;
      /** The worktree workspace row (id prefixed `workspace_wt_`). */
      workspace: import('./chat').Workspace;
      branch: string;
      repoPath: string;
      /** false when the worktree already existed and was reused. */
      created: boolean;
    }
  | { ok: false; error: string };

export type ThreadWorktreeRemovalResult =
  | { ok: true; removed: boolean }
  | { ok: false; error: string };

export type ThreadWorktreeMergeResult =
  | {
      ok: true;
      branch: string;
      repoPath: string;
      /** The worktree remains in place; call removeThreadWorktree to clean up. */
      merged: boolean;
    }
  | { ok: false; error: string };
