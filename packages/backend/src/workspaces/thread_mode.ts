import { isObjectRecord } from '@iki/backend/utils/guards';
import { THREAD_WORKTREE_WORKSPACE_PREFIX } from './worktree_ids';

/**
 * Chat/Work split (Codex-style): a thread is either a plain chat (no project
 * workspace — file/shell tools are unavailable) or a work thread bound to a
 * user-chosen project folder. The mode is stored explicitly in thread
 * metadata; threads created before the split are classified by their
 * workspace binding so nothing changes retroactively.
 */

export type ThreadWorkMode = 'chat' | 'work';

/** Scratch workspaces auto-created per thread carry this id prefix. */
export const THREAD_SCRATCH_WORKSPACE_PREFIX = 'workspace_thread_';

export const THREAD_WORK_MODE_METADATA_KEY = 'mode';

const isScratchOrWorktreeWorkspaceId = (workspaceId: string): boolean =>
  workspaceId.startsWith(THREAD_SCRATCH_WORKSPACE_PREFIX) ||
  workspaceId.startsWith(THREAD_WORKTREE_WORKSPACE_PREFIX);

/**
 * Resolve how a thread operates. Explicit `metadata.mode` wins; legacy threads
 * fall back to their workspace binding (a user folder ⇒ work, otherwise chat).
 */
export const resolveThreadWorkMode = (
  thread:
    | {
        workspace_id?: string | null;
        metadata?: string | null;
      }
    | null
    | undefined
): ThreadWorkMode => {
  if (isObjectRecord(thread) || thread) {
    const metadataRaw = typeof thread?.metadata === 'string' ? thread.metadata : '';
    if (metadataRaw.trim()) {
      try {
        const parsed: unknown = JSON.parse(metadataRaw);
        if (isObjectRecord(parsed)) {
          const mode = parsed[THREAD_WORK_MODE_METADATA_KEY];
          if (mode === 'work' || mode === 'chat') return mode;
        }
      } catch {
        // malformed metadata — fall through to workspace-based classification
      }
    }

    const workspaceId = typeof thread?.workspace_id === 'string' ? thread.workspace_id.trim() : '';
    if (workspaceId && !isScratchOrWorktreeWorkspaceId(workspaceId)) return 'work';
  }

  return 'chat';
};
