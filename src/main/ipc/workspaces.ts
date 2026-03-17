import { ipcMain } from 'electron';

import * as workspaceDb from '../../core/db/workspaces';

let workspacesIpcRegistered = false;

export const registerWorkspacesIpc = (): void => {
  if (workspacesIpcRegistered) return;
  workspacesIpcRegistered = true;

  ipcMain.handle('workspaces:list', () => workspaceDb.getWorkspaces());
  ipcMain.handle('workspaces:get', (_event, id) => workspaceDb.getWorkspace(id));
  ipcMain.handle('workspaces:getByPath', (_event, path) => workspaceDb.getWorkspaceByPath(path));
  ipcMain.handle('workspaces:getVisible', () => workspaceDb.getVisibleWorkspaces());
  ipcMain.handle('workspaces:create', (_event, workspace) => {
    const workspaceId =
      workspace.id || `workspace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    workspaceDb.addWorkspace({
      id: workspaceId,
      path: workspace.path,
      name: workspace.name,
      is_temporary: workspace.is_temporary || 0,
      show_in_list: workspace.show_in_list !== undefined ? workspace.show_in_list : 1,
    });
    return workspaceDb.getWorkspace(workspaceId);
  });
  ipcMain.handle('workspaces:update', (_event, id, workspace) =>
    workspaceDb.updateWorkspace(id, workspace)
  );
  ipcMain.handle('workspaces:delete', (_event, id) => workspaceDb.deleteWorkspace(id));
  ipcMain.handle('workspaces:toggleVisibility', (_event, id) =>
    workspaceDb.toggleWorkspaceVisibility(id)
  );
};

