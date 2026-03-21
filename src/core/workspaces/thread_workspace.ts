import * as chatThreadDb from '../db/chat_thread';
import * as workspaceDb from '../db/workspaces';
import type { Workspace } from '../../shared/types/chat';

export type ThreadWorkspaceSelection = {
  threadId: string;
  workspaceId: string | null;
  workspace: Workspace | null;
};

const normalizeThreadId = (threadId?: string | null): string => {
  if (typeof threadId !== 'string') return '';
  return threadId.trim();
};

const normalizeWorkspaceId = (workspaceId: unknown): string | null => {
  if (typeof workspaceId !== 'string') return null;
  const trimmed = workspaceId.trim();
  return trimmed.length > 0 ? trimmed : null;
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

export const buildThreadWorkspaceSystemMessage = (threadId?: string | null): string => {
  const selection = getThreadWorkspaceSelection(threadId);
  if (!selection?.workspaceId) return '';

  if (!selection.workspace) {
    return (
      `This conversation is scoped to workspace "${selection.workspaceId}", ` +
      'but that workspace record is unavailable. Ask the user to reselect a workspace before using filesystem or shell tools.'
    );
  }

  const workspacePath = typeof selection.workspace.path === 'string' ? selection.workspace.path.trim() : '';
  const workspaceName = typeof selection.workspace.name === 'string' ? selection.workspace.name.trim() : '';

  if (!workspacePath) {
    return (
      `This conversation is scoped to workspace "${selection.workspaceId}", ` +
      'but its root path is empty. Ask the user to reselect a workspace before using filesystem or shell tools.'
    );
  }

  const workspaceLabel = workspaceName || selection.workspaceId;
  return (
    `Current workspace: ${workspaceLabel} (${workspacePath}). ` +
    'Prefer relative paths from this root, default shell work to this directory, and do not operate outside it unless the user explicitly changes workspace.'
  );
};
