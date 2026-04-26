import { getDb } from './database';
import { Workspace } from '../../shared/types/chat';
import { buildSetClause } from './utils';

type WorkspaceRow = Workspace & { is_temporary?: number; show_in_list?: number };

export const getWorkspaces = (): Workspace[] => {
  const rows = getDb()
    .prepare('SELECT * FROM workspaces ORDER BY updated_at DESC')
    .all() as WorkspaceRow[];
  return rows.map(row => ({
    ...row,
    is_temporary: row.is_temporary || 0,
    show_in_list: row.show_in_list !== undefined ? row.show_in_list : 1,
  }));
};

export const getWorkspace = (id: string): Workspace | null => {
  const row = getDb().prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as
    | WorkspaceRow
    | undefined;
  if (!row) return null;
  return {
    ...row,
    is_temporary: row.is_temporary || 0,
    show_in_list: row.show_in_list !== undefined ? row.show_in_list : 1,
  };
};

export const getWorkspaceByPath = (path: string): Workspace | null => {
  const row = getDb().prepare('SELECT * FROM workspaces WHERE path = ?').get(path) as
    | WorkspaceRow
    | undefined;
  if (!row) return null;
  return {
    ...row,
    is_temporary: row.is_temporary || 0,
    show_in_list: row.show_in_list !== undefined ? row.show_in_list : 1,
  };
};

export const getVisibleWorkspaces = (): Workspace[] => {
  const rows = getDb()
    .prepare('SELECT * FROM workspaces WHERE show_in_list = 1 ORDER BY updated_at DESC')
    .all() as WorkspaceRow[];
  return rows.map(row => ({
    ...row,
    is_temporary: row.is_temporary || 0,
    show_in_list: row.show_in_list || 1,
  }));
};

export const addWorkspace = (
  workspace: Partial<Workspace> & { id: string; path: string; name: string }
) => {
  const now = new Date().toISOString();
  const stmt = getDb().prepare(`
        INSERT INTO workspaces (
            id, path, name, is_temporary, show_in_list, created_at, updated_at
        ) VALUES (
            @id, @path, @name, @is_temporary, @show_in_list, @created_at, @updated_at
        )
    `);

  const data = {
    id: workspace.id,
    path: workspace.path,
    name: workspace.name,
    is_temporary: workspace.is_temporary || 0,
    show_in_list: workspace.show_in_list !== undefined ? workspace.show_in_list : 1,
    created_at: now,
    updated_at: now,
  };

  return stmt.run(data);
};

const WORKSPACE_COLUMNS = new Set([
  'path', 'name', 'is_temporary', 'show_in_list',
]);

export const updateWorkspace = (id: string, workspace: Partial<Workspace>) => {
  const now = new Date().toISOString();
  const fields = buildSetClause(workspace as Record<string, unknown>, WORKSPACE_COLUMNS);

  if (!fields) return null;

  const stmt = getDb().prepare(`
        UPDATE workspaces 
        SET ${fields}, updated_at = @updated_at 
        WHERE id = @id
    `);

  const params: Partial<Workspace> & { id: string; updated_at: string } = {
    ...workspace,
    id,
    updated_at: now,
  };
  if (params.is_temporary !== undefined) params.is_temporary = params.is_temporary ? 1 : 0;
  if (params.show_in_list !== undefined) params.show_in_list = params.show_in_list ? 1 : 0;

  return stmt.run(params);
};

export const deleteWorkspace = (id: string) => {
  return getDb().prepare('DELETE FROM workspaces WHERE id = ?').run(id);
};

export const toggleWorkspaceVisibility = (id: string) => {
  const workspace = getWorkspace(id);
  if (!workspace) return null;
  return updateWorkspace(id, { show_in_list: workspace.show_in_list === 1 ? 0 : 1 });
};
