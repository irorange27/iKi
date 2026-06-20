import { ipcMain } from 'electron';

import { getAppConfig } from '@iki/backend/config';
import { createLogger } from '@iki/backend/logger';
import { defaultToolRegistry } from '@iki/backend/tools';
import { applyToolApprovalPolicyList } from '@iki/backend/utils/tool_approval';

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

  ipcMain.handle('tools:list', () => {
    try {
      return applyToolApprovalPolicyList(defaultToolRegistry.getToolMetadata(), {
        autoApproveToolRequests: shouldAutoApproveToolRequests(),
      });
    } catch (error: unknown) {
      toolsIpcLogger.event({
        level: 'error',
        event: 'ipc.tools.list',
        outcome: 'failed',
        error,
      });
      return [];
    }
  });
};
