import { getDb } from './database';
import { ChatThread } from '../../shared/types/chat';
import { buildSetClause } from './utils';

type ChatThreadRow = ChatThread & {
  is_generating: number | boolean;
  is_favorited?: number;
  is_incognito?: number;
  enable_artifacts?: number;
};

export const getChatThreads = (): ChatThread[] => {
  const rows = getDb()
    .prepare('SELECT * FROM chat_threads ORDER BY updated_at DESC')
    .all() as ChatThreadRow[];
  return rows.map(row => ({
    ...row,
    is_generating: Boolean(row.is_generating),
    is_favorited: row.is_favorited || 0,
    is_incognito: row.is_incognito || 0,
    enable_artifacts: row.enable_artifacts || 0,
  }));
};

export const getChatThread = (id: string): ChatThread | null => {
  const row = getDb().prepare('SELECT * FROM chat_threads WHERE id = ?').get(id) as
    | ChatThreadRow
    | undefined;
  if (!row) return null;
  return {
    ...row,
    is_generating: Boolean(row.is_generating),
    is_favorited: row.is_favorited || 0,
    is_incognito: row.is_incognito || 0,
    enable_artifacts: row.enable_artifacts || 0,
  };
};

export const getChatThreadsByWorkspace = (workspaceId: string): ChatThread[] => {
  const rows = getDb()
    .prepare('SELECT * FROM chat_threads WHERE workspace_id = ? ORDER BY updated_at DESC')
    .all(workspaceId) as ChatThreadRow[];
  return rows.map(row => ({
    ...row,
    is_generating: Boolean(row.is_generating),
    is_favorited: row.is_favorited || 0,
    is_incognito: row.is_incognito || 0,
    enable_artifacts: row.enable_artifacts || 0,
  }));
};

export const getFavoritedChatThreads = (): ChatThread[] => {
  const rows = getDb()
    .prepare('SELECT * FROM chat_threads WHERE is_favorited = 1 ORDER BY updated_at DESC')
    .all() as ChatThreadRow[];
  return rows.map(row => ({
    ...row,
    is_generating: Boolean(row.is_generating),
    is_favorited: row.is_favorited || 0,
    is_incognito: row.is_incognito || 0,
    enable_artifacts: row.enable_artifacts || 0,
  }));
};

export const addChatThread = (
  thread: Partial<ChatThread> & { id: string; title: string; metadata: string }
) => {
  const now = new Date().toISOString();
  const stmt = getDb().prepare(`
        INSERT INTO chat_threads (
            id, title, model, is_generating, reasoning_effort, metadata, created_at, updated_at,
            client_id, prompt_app_id, tools, is_favorited, is_incognito, workspace_id,
            enable_artifacts, artifact_workspace_id, skill_ids
        ) VALUES (
            @id, @title, @model, @is_generating, @reasoning_effort, @metadata, @created_at, @updated_at,
            @client_id, @prompt_app_id, @tools, @is_favorited, @is_incognito, @workspace_id,
            @enable_artifacts, @artifact_workspace_id, @skill_ids
        )
    `);

  const data = {
    id: thread.id,
    title: thread.title,
    model: thread.model || null,
    is_generating: thread.is_generating ? 1 : 0,
    reasoning_effort: thread.reasoning_effort || 'medium',
    metadata: thread.metadata,
    created_at: now,
    updated_at: now,
    client_id: thread.client_id || null,
    prompt_app_id: thread.prompt_app_id || null,
    tools: thread.tools || null,
    is_favorited: thread.is_favorited || 0,
    is_incognito: thread.is_incognito || 0,
    workspace_id: thread.workspace_id || null,
    enable_artifacts: thread.enable_artifacts || 0,
    artifact_workspace_id: thread.artifact_workspace_id || null,
    skill_ids: thread.skill_ids || null,
  };

  return stmt.run(data);
};

const CHAT_THREAD_COLUMNS = new Set([
  'title', 'model', 'is_generating', 'reasoning_effort', 'metadata',
  'client_id', 'prompt_app_id', 'tools', 'is_favorited', 'is_incognito',
  'workspace_id', 'enable_artifacts', 'artifact_workspace_id', 'skill_ids',
]);

export const updateChatThread = (id: string, thread: Partial<ChatThread>) => {
  const now = new Date().toISOString();
  const fields = buildSetClause(thread as Record<string, unknown>, CHAT_THREAD_COLUMNS);

  if (!fields) return null;

  const stmt = getDb().prepare(`
        UPDATE chat_threads 
        SET ${fields}, updated_at = @updated_at 
        WHERE id = @id
    `);

  const params: Record<string, unknown> & { id: string; updated_at: string } = {
    ...thread,
    id,
    updated_at: now,
  };
  if (typeof params.is_generating === 'boolean') params.is_generating = params.is_generating ? 1 : 0;
  if (typeof params.is_favorited === 'boolean') params.is_favorited = params.is_favorited ? 1 : 0;
  if (typeof params.is_incognito === 'boolean') params.is_incognito = params.is_incognito ? 1 : 0;
  if (typeof params.enable_artifacts === 'boolean') {
    params.enable_artifacts = params.enable_artifacts ? 1 : 0;
  }

  return stmt.run(params);
};

export const touchChatThread = (id: string) => {
  const now = new Date().toISOString();
  return getDb().prepare('UPDATE chat_threads SET updated_at = ? WHERE id = ?').run(now, id);
};

export const deleteChatThread = (id: string) => {
  // Messages will be deleted automatically due to CASCADE
  return getDb().prepare('DELETE FROM chat_threads WHERE id = ?').run(id);
};

export const toggleFavoriteChatThread = (id: string) => {
  const thread = getChatThread(id);
  if (!thread) return null;
  return updateChatThread(id, { is_favorited: thread.is_favorited === 1 ? 0 : 1 });
};
