import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import * as chatThreadDb from '../db/chat_thread';
import * as workspaceDb from '../db/workspaces';
import type {
  ThreadWorktreeMergeResult,
  ThreadWorktreeRemovalResult,
  ThreadWorktreeResult,
} from '@iki/backend/types/worktree';
import { getUserDataPath } from '../platform';
import { THREAD_WORKTREE_WORKSPACE_PREFIX } from './worktree_ids';

export { THREAD_WORKTREE_WORKSPACE_PREFIX };

const WORKTREE_ROOT_DIR = 'thread-worktrees';

const GIT_TIMEOUT_MS = 30_000;

const runGit = (args: string[], cwd?: string): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = (stderr || error.message).toString().trim();
          reject(new Error(detail || 'git command failed'));
          return;
        }
        resolve(stdout.toString().trim());
      }
    );
  });

const sanitizeSegment = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 64) || 'thread';

const toWorktreeWorkspaceId = (threadId: string): string =>
  `${THREAD_WORKTREE_WORKSPACE_PREFIX}${sanitizeSegment(threadId)}`;

export const isThreadWorktreeWorkspaceId = (workspaceId: unknown): boolean =>
  typeof workspaceId === 'string' && workspaceId.startsWith(THREAD_WORKTREE_WORKSPACE_PREFIX);

const getWorktreePath = (threadId: string): string =>
  path.join(getUserDataPath(), WORKTREE_ROOT_DIR, sanitizeSegment(threadId));

const getWorktreeBranch = (threadId: string): string => `iki/${sanitizeSegment(threadId)}`;

export const isGitRepository = async (dir: string): Promise<boolean> => {
  try {
    const result = await runGit(['rev-parse', '--is-inside-work-tree'], dir);
    return result === 'true';
  } catch {
    return false;
  }
};

const normalizeWorkspaceIdInput = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const createThreadWorktree = async (
  threadId: string,
  repoWorkspaceId?: string | null
): Promise<ThreadWorktreeResult> => {
  const normalizedThreadId = typeof threadId === 'string' ? threadId.trim() : '';
  if (!normalizedThreadId) {
    return { ok: false, error: 'A thread is required to create a worktree.' };
  }

  const thread = chatThreadDb.getChatThread(normalizedThreadId);
  if (!thread) {
    return { ok: false, error: `Thread ${normalizedThreadId} not found.` };
  }

  const repoWorkspaceIdNormalized =
    normalizeWorkspaceIdInput(repoWorkspaceId) ?? normalizeWorkspaceIdInput(thread.workspace_id);
  if (!repoWorkspaceIdNormalized) {
    return { ok: false, error: 'Select a workspace folder before creating an isolated worktree.' };
  }

  const repoWorkspace = workspaceDb.getWorkspace(repoWorkspaceIdNormalized);
  if (!repoWorkspace) {
    return { ok: false, error: 'The selected workspace no longer exists.' };
  }

  if (isThreadWorktreeWorkspaceId(repoWorkspace.id)) {
    return { ok: false, error: 'This thread already works in an isolated worktree.' };
  }

  if (!(await isGitRepository(repoWorkspace.path))) {
    return { ok: false, error: `"${repoWorkspace.name}" is not a git repository.` };
  }

  const existingId = toWorktreeWorkspaceId(normalizedThreadId);
  const existing = workspaceDb.getWorkspace(existingId);
  if (existing) {
    if (thread.workspace_id !== existing.id) {
      chatThreadDb.updateChatThread(normalizedThreadId, { workspace_id: existing.id });
    }
    return {
      ok: true,
      workspace: existing,
      branch: getWorktreeBranch(normalizedThreadId),
      repoPath: repoWorkspace.path,
      created: false,
    };
  }

  const worktreePath = getWorktreePath(normalizedThreadId);
  const branch = getWorktreeBranch(normalizedThreadId);

  try {
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
    try {
      await runGit(['worktree', 'add', '-b', branch, worktreePath], repoWorkspace.path);
    } catch {

      await runGit(['worktree', 'add', worktreePath, branch], repoWorkspace.path);
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to create the git worktree.',
    };
  }

  workspaceDb.addWorkspace({
    id: existingId,
    path: worktreePath,
    name: `${repoWorkspace.name} · worktree`,
    is_temporary: 1,
    show_in_list: 0,
  });
  chatThreadDb.updateChatThread(normalizedThreadId, { workspace_id: existingId });

  const workspace = workspaceDb.getWorkspace(existingId);
  if (!workspace) {
    return { ok: false, error: 'Worktree created but the workspace row is missing.' };
  }

  return {
    ok: true,
    workspace,
    branch,
    repoPath: repoWorkspace.path,
    created: true,
  };
};

export const removeThreadWorktree = async (
  threadId: string,
  options?: { force?: boolean }
): Promise<ThreadWorktreeRemovalResult> => {
  const normalizedThreadId = typeof threadId === 'string' ? threadId.trim() : '';
  if (!normalizedThreadId) {
    return { ok: false, error: 'A thread is required to remove a worktree.' };
  }

  const workspaceId = toWorktreeWorkspaceId(normalizedThreadId);
  const workspace = workspaceDb.getWorkspace(workspaceId);
  if (!workspace) {
    return { ok: true, removed: false };
  }

  const thread = chatThreadDb.getChatThread(normalizedThreadId);
  if (thread && thread.workspace_id === workspaceId) {
    chatThreadDb.updateChatThread(normalizedThreadId, { workspace_id: null });
  }

  try {

    await runGit(
      options?.force
        ? ['worktree', 'remove', '--force', '--force', workspace.path]
        : ['worktree', 'remove', workspace.path],
      workspace.path
    );
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Worktree not removed: ${error.message}`
          : 'Worktree not removed.',
    };
  }

  workspaceDb.deleteWorkspace(workspaceId);
  return { ok: true, removed: true };
};

export const mergeThreadWorktree = async (
  threadId: string
): Promise<ThreadWorktreeMergeResult> => {
  const normalizedThreadId = typeof threadId === 'string' ? threadId.trim() : '';
  if (!normalizedThreadId) {
    return { ok: false, error: 'A thread is required to merge a worktree.' };
  }

  const workspaceId = toWorktreeWorkspaceId(normalizedThreadId);
  const workspace = workspaceDb.getWorkspace(workspaceId);
  if (!workspace) {
    return { ok: false, error: 'This thread has no isolated worktree.' };
  }

  let mainWorktreePath: string;
  try {
    const gitCommonDir = await runGit(
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      workspace.path
    );
    mainWorktreePath = path.dirname(gitCommonDir);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not locate the main checkout.',
    };
  }

  const branch = getWorktreeBranch(normalizedThreadId);

  try {
    const dirty = await runGit(['status', '--porcelain'], mainWorktreePath);
    if (dirty.trim()) {
      return {
        ok: false,
        error:
          'Your main checkout has uncommitted changes. Commit or stash them before merging the worktree branch.',
      };
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not inspect the main checkout.',
    };
  }

  try {
    await runGit(['merge', branch], mainWorktreePath);
  } catch (error) {

    await runGit(['merge', '--abort'], mainWorktreePath).catch((): undefined => undefined);
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Merge failed (conflicts were aborted): ${error.message}`
          : 'Merge failed.',
    };
  }

  return { ok: true, branch, repoPath: mainWorktreePath, merged: true };
};
