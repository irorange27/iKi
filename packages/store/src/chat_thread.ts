import { commitRows, patchRow, readRows, removeRow } from './collection';
import { deleteSessionEvents } from './session_events';
import { ChatThread } from '@iki/core/types/chat';

// Rows are read from disk defensively: legacy files still hold 0/1 counters,
// which Boolean() normalizes into the flags the type declares.
const normalize = (row: ChatThread): ChatThread => ({
  ...row,
  is_generating: Boolean(row.is_generating),
  is_favorited: Boolean(row.is_favorited),
  is_incognito: Boolean(row.is_incognito),
  enable_artifacts: Boolean(row.enable_artifacts),
});

const byUpdatedDesc = (a: ChatThread, b: ChatThread): number =>
  String(b.updated_at).localeCompare(String(a.updated_at));

export const getChatThreads = (): ChatThread[] =>
  readRows<ChatThread>('chat_threads').sort(byUpdatedDesc).map(normalize);

export const getChatThread = (id: string): ChatThread | null => {
  const row = readRows<ChatThread>('chat_threads').find(entry => entry.id === id);
  return row ? normalize(row) : null;
};

export const addChatThread = (
  thread: Partial<ChatThread> & { id: string; title: string; metadata: string }
): void => {
  const now = new Date().toISOString();
  const row: ChatThread = {
    id: thread.id,
    title: thread.title,
    model: thread.model || null,
    is_generating: thread.is_generating === true,
    reasoning_effort: thread.reasoning_effort || 'medium',
    metadata: thread.metadata,
    created_at: now,
    updated_at: now,
    client_id: thread.client_id || null,
    prompt_app_id: thread.prompt_app_id || null,
    tools: thread.tools || null,
    is_favorited: thread.is_favorited === true,
    is_incognito: thread.is_incognito === true,
    workspace_id: thread.workspace_id || null,
    enable_artifacts: thread.enable_artifacts === true,
    artifact_workspace_id: thread.artifact_workspace_id || null,
    skill_ids: thread.skill_ids || null,
  };
  const rows = readRows<ChatThread>('chat_threads').filter(entry => entry.id !== thread.id);
  rows.push(row);
  commitRows('chat_threads', rows);
};

/** Apply a partial update. `null` when nothing was given or the thread is gone. */
export const updateChatThread = (id: string, thread: Partial<ChatThread>): ChatThread | null => {
  const { id: _immutable, ...changes } = thread;
  void _immutable;
  if (Object.keys(changes).length === 0) return null;
  if (!patchRow<ChatThread>('chat_threads', 'id', id, changes)) return null;
  return getChatThread(id);
};

/** Stamp `updated_at` so recency ordering reflects the latest activity. */
export const touchChatThread = (id: string): void => {
  patchRow<ChatThread>('chat_threads', 'id', id, {});
};

export const deleteChatThread = (id: string): void => {
  deleteSessionEvents(id);
  removeRow<ChatThread>('chat_threads', 'id', id);
};
