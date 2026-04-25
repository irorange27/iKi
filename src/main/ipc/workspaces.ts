import * as fs from 'node:fs/promises';
import path from 'node:path';
import { dialog, ipcMain } from 'electron';

import * as workspaceDb from '../../core/db/workspaces';
import { getThreadWorkspaceSelection } from '../../core/workspaces/thread_workspace';
import { createPrefixedId } from '../../shared/utils/id';

const AGENT_INSTRUCTIONS_FILE = 'IKI.md';

const AGENT_INSTRUCTIONS_TEMPLATE = [
  '# IKI',
  '',
  '<!-- Standing instructions for iKi. Edit this file to guide how iKi should behave in this project. -->',
  '',
  '## Behavior',
  '',
  '- (Add your guidelines here. Keep them concise and actionable.)',
  '',
  '## Boundaries',
  '',
  '- (Add boundaries or rules iKi should follow.)',
  '',
].join('\n');

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

  ipcMain.handle('workspaces:init-agent-instructions', async (_event, threadId: string) => {
    try {
      const selection = getThreadWorkspaceSelection(threadId);
      const workspacePath = selection?.workspace?.path;
      if (!workspacePath) {
        return { ok: false, error: 'No active workspace for this thread. Select a workspace first.' };
      }

      const filePath = path.join(workspacePath, AGENT_INSTRUCTIONS_FILE);

      try {
        await fs.access(filePath);
        return { ok: false, error: `${AGENT_INSTRUCTIONS_FILE} already exists. Edit it directly to customize instructions.` };
      } catch {
        // File doesn't exist — proceed to create
      }

      await fs.writeFile(filePath, AGENT_INSTRUCTIONS_TEMPLATE, 'utf8');
      return { ok: true, path: filePath };
    } catch (error) {
      return {
        ok: false,
        error: `Failed to create ${AGENT_INSTRUCTIONS_FILE}: ${(error as Error).message}`,
      };
    }
  });
};
