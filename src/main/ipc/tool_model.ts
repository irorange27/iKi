import { ipcMain } from 'electron';

import { createLogger } from '../../core/logger';
import { getToolModel, generateTitleWithAgent } from '../../core/provider/tool_model';

let toolModelIpcRegistered = false;
const toolModelIpcLogger = createLogger({ module: 'tool_model_ipc' });

export const registerToolModelIpc = (): void => {
  if (toolModelIpcRegistered) return;
  toolModelIpcRegistered = true;

  ipcMain.handle('toolModel:get', () => {
    try {
      return getToolModel();
    } catch (error: unknown) {
      toolModelIpcLogger.event({
        level: 'error',
        event: 'ipc.tool_model.get',
        outcome: 'failed',
        error,
      });
      return null;
    }
  });

  ipcMain.handle('toolModel:generateTitle', async (_event, conversationContent: string) => {
    try {
      return await generateTitleWithAgent(conversationContent);
    } catch (error: unknown) {
      toolModelIpcLogger.event({
        level: 'error',
        event: 'ipc.tool_model.generate_title',
        outcome: 'failed',
        error,
      });
      return null;
    }
  });
};
