import { ipcMain } from 'electron';

import { createLogger } from '../../core/logger';
import {
  getToolModel,
  generateTitleWithAgent,
  testToolModelLatency,
} from '../../core/provider/tool_model';
import { getErrorMessage } from '../../shared/utils/errors';

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

  ipcMain.handle(
    'toolModel:testLatency',
    async (_event, config?: { providerType?: string; model?: string } | null) => {
      try {
        const result = await testToolModelLatency(config ?? null);
        return {
          success: true,
          providerType: result.providerType,
          model: result.model,
          responseTimeMs: result.responseTimeMs,
        };
      } catch (error: unknown) {
        toolModelIpcLogger.event({
          level: 'error',
          event: 'ipc.tool_model.test_latency',
          outcome: 'failed',
          error,
        });
        return {
          success: false,
          error: getErrorMessage(error),
        };
      }
    }
  );
};
