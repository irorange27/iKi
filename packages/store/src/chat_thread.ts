import { commitRows, patchRow, readRows, removeRow } from './collection';
import { deleteSessionEvents } from './session_events';
import { ChatThread } from '@iki/core/types/chat';

const normalize = (row: ChatThread): ChatThread => ({
  ...row,
  is_generating: Boolean(row.is_generating),
  is_favorited: row.is_favorited === true,
  is_incognito: row.is_incognito === true,
  enable_artifacts: row.enable_artifacts === true,
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
) => {
  const now = new Date().toISOString();
  const row = {
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
  return { changes: 1, lastInsertRowid: 0 };
};

const CHAT_THREAD_COLUMNS = new Set([
  'title', 'model', 'is_generating', 'reasoning_effort', 'metadata',
  'client_id', 'prompt_app_id', 'tools', 'is_favorited', 'is_incognito',
  'workspace_id', 'enable_artifacts', 'artifact_workspace_id', 'skill_ids',
]);

export const updateChatThread = (id: string, thread: Partial<ChatThread>) => {
  const patch = Object.fromEntries(
    Object.entries(thread).filter(([key]) => CHAT_THREAD_COLUMNS.has(key))
  );
  if (Object.keys(patch).length === 0) return null;
  const changes = patchRow<ChatThread>('chat_threads', 'id', id, patch, CHAT_THREAD_COLUMNS);
  return { changes, lastInsertRowid: 0 };
};

export const touchChatThread = (id: string) => ({
  changes: patchRow<ChatThread>('chat_threads', 'id', id, {}, new Set()),
  lastInsertRowid: 0,
});

export const deleteChatThread = (id: string) => {
  deleteSessionEvents(id);
  return { changes: removeRow<ChatThread>('chat_threads', 'id', id), lastInsertRowid: 0 };
};
