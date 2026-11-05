import { commitRows, patchRow, readRows } from './collection';
import { Workspace } from '@iki/core/types/chat';

const normalize = (row: Workspace): Workspace => ({
  ...row,
  is_temporary: row.is_temporary === true,
  show_in_list: row.show_in_list !== false,
});

const byUpdatedDesc = (a: Workspace, b: Workspace): number =>
  String(b.updated_at).localeCompare(String(a.updated_at));

export const getWorkspaces = (): Workspace[] =>
  readRows<Workspace>('workspaces').sort(byUpdatedDesc).map(normalize);

export const getWorkspace = (id: string): Workspace | null => {
  const row = readRows<Workspace>('workspaces').find(entry => entry.id === id);
  return row ? normalize(row) : null;
};

export const getWorkspaceByPath = (path: string): Workspace | null => {
  const row = readRows<Workspace>('workspaces').find(entry => entry.path === path);
  return row ? normalize(row) : null;
};

export const getVisibleWorkspaces = (): Workspace[] =>
  readRows<Workspace>('workspaces')
    .filter(row => row.show_in_list !== false)
    .sort(byUpdatedDesc)
    .map(normalize);

export const addWorkspace = (
  workspace: Partial<Workspace> & { id: string; path: string; name: string }
) => {
  const now = new Date().toISOString();
  const row = {
    id: workspace.id,
    path: workspace.path,
    name: workspace.name,
    is_temporary: workspace.is_temporary === true,
    show_in_list: workspace.show_in_list !== false,
    created_at: now,
    updated_at: now,
  };
  const rows = readRows<Workspace>('workspaces').filter(entry => entry.id !== workspace.id);
  rows.push(row as unknown as Workspace);
  commitRows('workspaces', rows);
  return { changes: 1, lastInsertRowid: 0 };
};

const WORKSPACE_COLUMNS = new Set(['path', 'name', 'is_temporary', 'show_in_list']);

export const updateWorkspace = (id: string, workspace: Partial<Workspace>) => {
  const patch = Object.fromEntries(
    Object.entries(workspace).filter(([key]) => WORKSPACE_COLUMNS.has(key))
  );
  if (Object.keys(patch).length === 0) return null;
  const changes = patchRow<Workspace>('workspaces', 'id', id, patch, WORKSPACE_COLUMNS);
  return { changes, lastInsertRowid: 0 };
};
