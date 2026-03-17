import { ipcMain } from 'electron';

import { getToolModel, generateTitleWithAgent } from '../../core/provider/tool_model';

let toolModelIpcRegistered = false;

export const registerToolModelIpc = (): void => {
  if (toolModelIpcRegistered) return;
  toolModelIpcRegistered = true;

  ipcMain.handle('toolModel:get', () => {
    try {
      return getToolModel();
    } catch (error: unknown) {
      console.error('Failed to get tool model:', error);
      return null;
    }
  });

  ipcMain.handle('toolModel:generateTitle', async (_event, conversationContent: string) => {
    try {
      return await generateTitleWithAgent(conversationContent);
    } catch (error: unknown) {
      console.error('Failed to generate title with agent:', error);
      return null;
    }
  });
};

