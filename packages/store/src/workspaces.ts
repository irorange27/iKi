import { commitRows, patchRow, readRows } from './collection';
import { Workspace } from '@iki/core/types/chat';

const normalize = (row: Workspace): Workspace => ({
  ...row,
  is_temporary: Boolean(row.is_temporary),
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
): void => {
  const now = new Date().toISOString();
  const row: Workspace = {
    id: workspace.id,
    path: workspace.path,
    name: workspace.name,
    is_temporary: workspace.is_temporary === true,
    show_in_list: workspace.show_in_list !== false,
    created_at: now,
    updated_at: now,
  };
  const rows = readRows<Workspace>('workspaces').filter(entry => entry.id !== workspace.id);
  rows.push(row);
  commitRows('workspaces', rows);
};

/** Apply a partial update. `null` when nothing was given or the workspace is gone. */
export const updateWorkspace = (id: string, workspace: Partial<Workspace>): Workspace | null => {
  const { id: _immutable, ...changes } = workspace;
  void _immutable;
  if (Object.keys(changes).length === 0) return null;
  if (!patchRow<Workspace>('workspaces', 'id', id, changes)) return null;
  return getWorkspace(id);
};
