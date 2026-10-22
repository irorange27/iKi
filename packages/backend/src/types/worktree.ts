export type ThreadWorktreeResult =
  | {
      ok: true;

      workspace: import('./chat').Workspace;
      branch: string;
      repoPath: string;

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

      merged: boolean;
    }
  | { ok: false; error: string };
