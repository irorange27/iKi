import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import * as chatThreadDb from '../db/chat_thread';
import * as workspaceDb from '../db/workspaces';
import type { Workspace } from '@iki/backend/types/chat';
import type {
  ThreadWorktreeRemovalResult,
  ThreadWorktreeResult,
} from '@iki/backend/types/worktree';
import { getUserDataPath } from '../platform';
import { THREAD_WORKTREE_WORKSPACE_PREFIX } from './worktree_ids';

export { THREAD_WORKTREE_WORKSPACE_PREFIX };

/**
 * Git worktree isolation (Codex-style): a thread can work in its own worktree
 * checkout on a dedicated branch, so agent edits never touch the user's local
 * checkout. The worktree is registered as a regular (temporary, hidden)
 * workspace row with the id prefix `workspace_wt_`, and the thread is assigned
 * to it — tools then operate inside the worktree through the normal workspace
 * path-boundary enforcement.
 */

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

/**
 * Create (or reuse) a git worktree for the thread based on the given repo
 * workspace, register it as a workspace row, and assign the thread to it.
 */
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
      // Branch already exists (e.g. a previous worktree was removed without
      // pruning) — attach the worktree to the existing branch instead.
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

/**
 * Detach the thread's worktree: unassign the thread, remove the checkout
 * (refuses when it holds uncommitted changes unless `force`), and drop the
 * workspace row. The worktree branch is intentionally kept so committed work
 * can be merged later.
 */
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
    // git resolves worktree registrations through the repo, so run inside the
    // worktree checkout itself.
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
