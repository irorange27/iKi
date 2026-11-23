import { ipcMain } from 'electron';

import { getAppConfig } from '@iki/harness/config';
import { createLogger } from '@iki/core/logger';
import { defaultToolRegistry } from '@iki/harness/tools';
import { decideToolApproval } from '@iki/core/utils/action_risk';
import { withIpcLogging } from '../utils/ipc_helpers';

let toolsIpcRegistered = false;
const toolsIpcLogger = createLogger({ module: 'tools_ipc' });
const shouldAutoApproveToolRequests = () => {
  try {
    return getAppConfig()?.general?.autoApproveToolRequests === true;
  } catch {
    return false;
  }
};

export const registerToolsIpc = (): void => {
  if (toolsIpcRegistered) return;
  toolsIpcRegistered = true;

  ipcMain.handle('tools:list', () =>
    withIpcLogging<Awaited<ReturnType<typeof defaultToolRegistry.getToolMetadata>>>(
      toolsIpcLogger,
      'ipc.tools.list',
      () => {
        const autoApprove = shouldAutoApproveToolRequests();
        return defaultToolRegistry
          .getToolMetadata()
          .map(tool => ({
            ...tool,
            needsApproval: decideToolApproval(tool, { autoApprove }) === 'ask',
          }));
      },
      { onError: () => [] }
    )
  );
};
