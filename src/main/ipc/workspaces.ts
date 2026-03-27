import * as fs from 'node:fs/promises';
import path from 'node:path';
import { dialog, ipcMain } from 'electron';

import * as workspaceDb from '../../core/db/workspaces';
import { createPrefixedId } from '../../shared/utils/id';

let workspacesIpcRegistered = false;

export const registerWorkspacesIpc = (): void => {
  if (workspacesIpcRegistered) return;
  workspacesIpcRegistered = true;

  const createWorkspaceId = () => createPrefixedId('workspace');

  const normalizeDirectoryPath = async (inputPath: string): Promise<string> => {
    const resolvedPath = path.resolve(inputPath);
    try {
      return await fs.realpath(resolvedPath);
    } catch {
      return resolvedPath;
    }
  };

  const createWorkspaceFromPath = async (rawPath: string) => {
    const normalizedPath = await normalizeDirectoryPath(rawPath);
    const existing = workspaceDb.getWorkspaceByPath(normalizedPath);
    if (existing) {
      if (existing.show_in_list !== 1) {
        workspaceDb.updateWorkspace(existing.id, { show_in_list: 1 });
        return workspaceDb.getWorkspace(existing.id);
      }
      return existing;
    }

    const workspaceId = createWorkspaceId();
    const workspaceName = path.basename(normalizedPath) || normalizedPath;
    workspaceDb.addWorkspace({
      id: workspaceId,
      path: normalizedPath,
      name: workspaceName,
      is_temporary: 0,
      show_in_list: 1,
    });
    return workspaceDb.getWorkspace(workspaceId);
  };

  ipcMain.handle('workspaces:list', () => workspaceDb.getWorkspaces());
  ipcMain.handle('workspaces:get', (_event, id) => workspaceDb.getWorkspace(id));
  ipcMain.handle('workspaces:getByPath', (_event, path) => workspaceDb.getWorkspaceByPath(path));
  ipcMain.handle('workspaces:getVisible', () => workspaceDb.getVisibleWorkspaces());
  ipcMain.handle('workspaces:pickDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose workspace folder',
      buttonLabel: 'Use as Workspace',
    });

    if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
      return null;
    }

    return await createWorkspaceFromPath(result.filePaths[0]);
  });
  ipcMain.handle('workspaces:create', (_event, workspace) => {
    const workspaceId = workspace.id || createWorkspaceId();
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
