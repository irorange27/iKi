import fs from 'node:fs';
import path from 'node:path';

import * as chatThreadDb from '../db/chat_thread';
import * as workspaceDb from '../db/workspaces';
import type { Workspace } from '@iki/backend/types/chat';
import { getUserDataPath } from '../platform';
import { resolveThreadWorkMode } from './thread_mode';

export type ThreadWorkspaceSelection = {
  threadId: string;
  workspaceId: string | null;
  workspace: Workspace | null;
};

const THREAD_WORKSPACES_DIR = 'thread-workspaces';
const BRAIN_DIR = 'brain';

const normalizeThreadId = (threadId?: string | null): string => {
  if (typeof threadId !== 'string') return '';
  return threadId.trim();
};

const normalizeWorkspaceId = (workspaceId: unknown): string | null => {
  if (typeof workspaceId !== 'string') return null;
  const trimmed = workspaceId.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toThreadWorkspaceId = (threadId: string): string =>
  `workspace_thread_${threadId.replace(/[^a-zA-Z0-9_-]+/g, '_')}`;

const getThreadWorkspacePath = (threadId: string): string =>
  path.join(getUserDataPath(), THREAD_WORKSPACES_DIR, threadId);

const getBrainPath = (): string => path.join(getUserDataPath(), BRAIN_DIR);

const getThreadWorkspaceName = (threadId: string, title: unknown): string => {
  const trimmedTitle = typeof title === 'string' ? title.trim() : '';
  return trimmedTitle ? `${trimmedTitle} Scratch` : `Thread ${threadId} Scratch`;
};

const ensureThreadWorkspaceRecord = (threadId: string): Workspace | null => {
  const thread = chatThreadDb.getChatThread(threadId);

  const configuredWorkspaceId = normalizeWorkspaceId(thread?.workspace_id);
  if (configuredWorkspaceId) {
    const existingWorkspace = workspaceDb.getWorkspace(configuredWorkspaceId);
    if (existingWorkspace) return existingWorkspace;
  }

  // Chat/worktree-style threads have no project workspace: plain chats never
  // get an auto-created scratch dir — filesystem/shell tools report that a
  // workspace must be chosen instead.
  if (!thread || resolveThreadWorkMode(thread) !== 'work') return null;

  const workspacePath = getThreadWorkspacePath(threadId);
  fs.mkdirSync(workspacePath, { recursive: true });

  const existingByPath = workspaceDb.getWorkspaceByPath(workspacePath);
  if (existingByPath) {
    workspaceDb.updateWorkspace(existingByPath.id, {
      name: getThreadWorkspaceName(threadId, thread?.title),
      is_temporary: 1,
      show_in_list: 0,
    });
    if (thread && configuredWorkspaceId !== existingByPath.id) {
      chatThreadDb.updateChatThread(threadId, { workspace_id: existingByPath.id });
    }
    return workspaceDb.getWorkspace(existingByPath.id);
  }

  const workspaceId = toThreadWorkspaceId(threadId);
  workspaceDb.addWorkspace({
    id: workspaceId,
    path: workspacePath,
    name: getThreadWorkspaceName(threadId, thread?.title),
    is_temporary: 1,
    show_in_list: 0,
  });
  if (thread) {
    chatThreadDb.updateChatThread(threadId, { workspace_id: workspaceId });
  }
  return workspaceDb.getWorkspace(workspaceId);
};

export const getThreadWorkspaceSelection = (
  threadId?: string | null
): ThreadWorkspaceSelection | null => {
  const normalizedThreadId = normalizeThreadId(threadId);
  if (!normalizedThreadId) return null;

  const thread = chatThreadDb.getChatThread(normalizedThreadId);
  if (!thread) return null;

  const workspaceId = normalizeWorkspaceId(thread.workspace_id);
  const workspace = workspaceId ? workspaceDb.getWorkspace(workspaceId) : null;

  return {
    threadId: normalizedThreadId,
    workspaceId,
    workspace,
  };
};

export const ensureThreadWorkspaceSelection = (
  threadId?: string | null
): ThreadWorkspaceSelection | null => {
  const normalizedThreadId = normalizeThreadId(threadId);
  if (!normalizedThreadId) return null;

  const workspace = ensureThreadWorkspaceRecord(normalizedThreadId);
  const workspaceId = normalizeWorkspaceId(workspace?.id);

  return {
    threadId: normalizedThreadId,
    workspaceId,
    workspace: workspaceId ? workspace : null,
  };
};

/**
 * Turn-start snapshot used by the agent harness to freeze the workspace for a
 * whole run: later thread-state changes cannot redirect tools already running
 * under the frozen context.
 */
export const resolveThreadWorkspaceSelectionSnapshot = (
  threadId?: string | null
): ThreadWorkspaceSelection | null =>
  ensureThreadWorkspaceSelection(threadId) ?? getThreadWorkspaceSelection(threadId);

export const buildThreadWorkspaceSystemMessage = (threadId?: string | null): string => {
  const selection = ensureThreadWorkspaceSelection(threadId);
  if (!selection?.threadId || !selection.workspaceId) {
    return (
      'No workspace is selected for this conversation. Do not use filesystem or shell tools ' +
      'until the user selects a workspace in the composer.'
    );
  }

  if (!selection.workspace) {
    return (
      `This conversation is scoped to workspace "${selection.workspaceId}", ` +
      'but that workspace record is unavailable. Ask the user to reselect a workspace before using filesystem or shell tools.'
    );
  }

  const workspacePath =
    typeof selection.workspace.path === 'string' ? selection.workspace.path.trim() : '';
  const workspaceName =
    typeof selection.workspace.name === 'string' ? selection.workspace.name.trim() : '';

  if (!workspacePath) {
    return (
      `This conversation is scoped to workspace "${selection.workspaceId}", ` +
      'but its root path is empty. Ask the user to reselect a workspace before using filesystem or shell tools.'
    );
  }

  const workspaceLabel = workspaceName || selection.workspaceId;
  const brainPath = getBrainPath();
  fs.mkdirSync(brainPath, { recursive: true });
  return (
    `Current workspace: ${workspaceLabel} (${workspacePath}). ` +
    'Prefer relative paths from this root, default shell work to this directory, and do not operate outside it unless the user explicitly changes workspace. ' +
    `Additional writable app data root: ${brainPath}. Use it for continuity files such as owner.md and memory_inbox/.`
  );
};
