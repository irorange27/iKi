import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { getUserDataPath } from '@iki/core/platform';
import * as workspaceDb from '@iki/store/workspaces';
import type { ThreadWorkspaceSelection } from './thread_workspace';
import { THREAD_WORKTREE_WORKSPACE_PREFIX } from './worktree_ids';

export type WorkspaceIsolationMode = 'inherit' | 'share' | 'branch';

export type GitWorkspaceInspection = {
  isGitRepo: boolean;
  repoRoot: string | null;
  branch: string | null;
  headSha: string | null;
  dirty: boolean;
  dirtyFilesCount: number;
};

export type ProvisionedWorkspace = {
  mode: WorkspaceIsolationMode;
  workspaceId: string | null;
  workspacePath: string | null;
  repoRoot: string | null;
  branch: string | null;
  dirtyWarning?: string;
  workspaceSelection: ThreadWorkspaceSelection | null;
};

const GIT_TIMEOUT_MS = 30_000;

const runGit = (cwd: string, args: string[]): string =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: GIT_TIMEOUT_MS,
  }).trim();

const tryGit = (cwd: string, args: string[]): string | null => {
  try {
    return runGit(cwd, args);
  } catch {
    return null;
  }
};

const sanitizeSlug = (raw: string, fallback: string): string => {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned || fallback;
};

const branchExists = (repoRoot: string, branch: string): boolean =>
  tryGit(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]) !== null;

export const inspectGitWorkspace = (dir: string): GitWorkspaceInspection => {
  const resolved = path.resolve(dir);
  const repoRoot = tryGit(resolved, ['rev-parse', '--show-toplevel']);
  if (!repoRoot) {
    return {
      isGitRepo: false,
      repoRoot: null,
      branch: null,
      headSha: null,
      dirty: false,
      dirtyFilesCount: 0,
    };
  }

  const branch = tryGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const headSha = tryGit(repoRoot, ['rev-parse', 'HEAD']);
  const statusOutput = tryGit(repoRoot, ['status', '--porcelain']) ?? '';
  const dirtyLines = statusOutput
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  return {
    isGitRepo: true,
    repoRoot,
    branch,
    headSha,
    dirty: dirtyLines.length > 0,
    dirtyFilesCount: dirtyLines.length,
  };
};

const registerTemporaryWorkspace = (params: {
  workspaceId: string;
  workspacePath: string;
  name: string;
  threadId: string;
}): ThreadWorkspaceSelection => {
  const existing = workspaceDb.getWorkspaceByPath(params.workspacePath);
  const now = new Date().toISOString();
  if (existing) {
    workspaceDb.updateWorkspace(existing.id, {
      name: params.name,
      is_temporary: true,
      show_in_list: false,
    });
    const refreshed = workspaceDb.getWorkspace(existing.id);
    return {
      threadId: params.threadId,
      workspaceId: existing.id,
      workspace: refreshed ?? {
        ...existing,
        name: params.name,
        is_temporary: true,
        show_in_list: false,
        updated_at: now,
      },
    };
  }

  workspaceDb.addWorkspace({
    id: params.workspaceId,
    path: params.workspacePath,
    name: params.name,
    is_temporary: true,
    show_in_list: false,
  });
  const stored = workspaceDb.getWorkspace(params.workspaceId);
  return {
    threadId: params.threadId,
    workspaceId: params.workspaceId,
    workspace: stored ?? {
      id: params.workspaceId,
      path: params.workspacePath,
      name: params.name,
      is_temporary: true,
      show_in_list: false,
      created_at: now,
      updated_at: now,
    },
  };
};

export const provisionIsolatedWorkspace = (params: {
  mode: WorkspaceIsolationMode;
  threadId: string;
  ownerId: string;
  label: string;
  parentSelection: ThreadWorkspaceSelection | null;
  baseDir?: string;
  branchPrefix?: string;
}): ProvisionedWorkspace => {
  const { mode, threadId, ownerId, label, parentSelection } = params;

  if (mode === 'inherit') {
    const inheritedSelection: ThreadWorkspaceSelection | null = parentSelection
      ? {
          threadId,
          workspaceId: parentSelection.workspaceId,
          workspace: parentSelection.workspace,
        }
      : null;
    const parentPath = parentSelection?.workspace?.path?.trim() || null;
    const gitInfo = parentPath ? inspectGitWorkspace(parentPath) : null;
    return {
      mode: 'inherit',
      workspaceId: inheritedSelection?.workspaceId ?? null,
      workspacePath: parentPath,
      repoRoot: gitInfo?.repoRoot ?? null,
      branch: gitInfo?.branch ?? null,
      workspaceSelection: inheritedSelection,
    };
  }

  const parentPath = parentSelection?.workspace?.path?.trim();
  if (!parentPath) {
    throw new Error(
      `Workspace mode "${mode}" requires the parent session to have an active workspace directory.`
    );
  }

  const inspection = inspectGitWorkspace(parentPath);
  if (!inspection.isGitRepo || !inspection.repoRoot) {
    throw new Error(
      `Workspace mode "${mode}" requires a Git repository, but "${parentPath}" is not inside a Git repo.`
    );
  }
  if (!inspection.headSha) {
    throw new Error(
      `Workspace mode "${mode}" requires at least one Git commit (HEAD is unborn) in "${inspection.repoRoot}".`
    );
  }

  const safeOwner = sanitizeSlug(ownerId, 'swarm');
  const safeLabel = sanitizeSlug(label, 'worker');
  const suffix = randomUUID().slice(0, 6);
  const baseRoot = params.baseDir?.trim()
    ? path.resolve(params.baseDir)
    : path.join(getUserDataPath(), 'swarm-worktrees');
  const targetDir = path.join(baseRoot, safeOwner, `${safeLabel}-${suffix}`);
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });

  const prefix = (params.branchPrefix?.trim() || 'iki/swarm').replace(/\/+$/g, '');
  let branch = `${prefix}/${safeOwner}/${safeLabel}`;
  if (branchExists(inspection.repoRoot, branch)) {
    branch = `${branch}-${suffix}`;
  }

  const dirtyWarning = inspection.dirty
    ? `Parent repository has ${inspection.dirtyFilesCount} uncommitted change(s); isolated ${mode} workspace starts from committed HEAD (${inspection.headSha.slice(0, 8)}).`
    : undefined;

  if (mode === 'share') {
    runGit(inspection.repoRoot, ['worktree', 'add', '-b', branch, targetDir, 'HEAD']);
  } else {
    try {
      runGit(inspection.repoRoot, ['clone', '--local', '--no-hardlinks', inspection.repoRoot, targetDir]);
    } catch {
      runGit(inspection.repoRoot, ['clone', inspection.repoRoot, targetDir]);
    }
    runGit(targetDir, ['checkout', '-b', branch]);
  }

  const workspaceId = `${THREAD_WORKTREE_WORKSPACE_PREFIX}${safeOwner}_${safeLabel}_${suffix}`;
  const selection = registerTemporaryWorkspace({
    workspaceId,
    workspacePath: targetDir,
    name: `${label} (${mode})`,
    threadId,
  });

  return {
    mode,
    workspaceId: selection.workspaceId,
    workspacePath: targetDir,
    repoRoot: inspection.repoRoot,
    branch,
    ...(dirtyWarning ? { dirtyWarning } : {}),
    workspaceSelection: selection,
  };
};

export const cleanupIsolatedWorkspace = (params: {
  mode: WorkspaceIsolationMode;
  repoRoot?: string | null;
  workspacePath?: string | null;
  workspaceId?: string | null;
  branch?: string | null;
  deleteBranch?: boolean;
}): void => {
  if (params.mode === 'inherit') return;

  const targetPath = params.workspacePath?.trim();
  const repoRoot = params.repoRoot?.trim();

  if (params.mode === 'share' && targetPath && repoRoot) {
    const removed = tryGit(repoRoot, ['worktree', 'remove', '--force', targetPath]);
    if (removed === null && fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
    tryGit(repoRoot, ['worktree', 'prune']);
    if (params.deleteBranch && params.branch?.trim()) {
      tryGit(repoRoot, ['branch', '-D', params.branch.trim()]);
    }
  } else if (targetPath && fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }

  if (params.workspaceId?.trim()) {
    workspaceDb.deleteWorkspace(params.workspaceId.trim());
  }
};
