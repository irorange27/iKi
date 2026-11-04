import { ipcMain } from 'electron';

import { createLogger } from '@iki/backend/logger';
import {
  getToolModel,
  generateTitle,
  testToolModelLatency,
} from '@iki/backend/provider/tool_model';
import { getErrorMessage } from '@iki/backend/utils/errors';
import type { ToolModelLatencyTestResult } from '@iki/backend/types/electron_api';
import { withIpcLogging } from '../utils/ipc_helpers';

let toolModelIpcRegistered = false;
const toolModelIpcLogger = createLogger({ module: 'tool_model_ipc' });

export const registerToolModelIpc = (): void => {
  if (toolModelIpcRegistered) return;
  toolModelIpcRegistered = true;

  ipcMain.handle('toolModel:get', () =>
    withIpcLogging<unknown>(toolModelIpcLogger, 'ipc.tool_model.get', () => getToolModel(), {
      onError: () => null,
    })
  );

  ipcMain.handle('toolModel:generateTitle', (_event, conversationContent: string) =>
    withIpcLogging<string | null>(
      toolModelIpcLogger,
      'ipc.tool_model.generate_title',
      () => generateTitle(conversationContent),
      { onError: () => null }
    )
  );

  ipcMain.handle(
    'toolModel:testLatency',
    async (_event, config?: { providerId?: string; providerType?: string; model?: string } | null) =>
      withIpcLogging<ToolModelLatencyTestResult>(
        toolModelIpcLogger,
        'ipc.tool_model.test_latency',
        async () => {
          const result = await testToolModelLatency(config ?? null);
          return {
            success: true,
            ...(result.providerId ? { providerId: result.providerId } : {}),
            providerType: result.providerType,
            model: result.model,
            responseTimeMs: result.responseTimeMs,
          };
        },
        { onError: error => ({ success: false, error: getErrorMessage(error) }) }
      )
  );
};
