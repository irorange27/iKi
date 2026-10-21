import { ipcMain } from 'electron';

import { getAppConfig } from '@iki/backend/config';
import { createLogger } from '@iki/backend/logger';
import { defaultToolRegistry } from '@iki/backend/tools';
import { decideToolApproval } from '@iki/backend/utils/action_risk';

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
      // Annotate, never rewrite: the renderer and the auto router both need
      // "does this tool need a decision?", but neither gets to change what the
      // tool declared. The old rewrite (`applyToolApprovalPolicyList`) forced
      // `needsApproval: true` to `false` here — a second approval policy that
      // could lower a tool's floor (#166).
      const autoApprove = shouldAutoApproveToolRequests();
      return defaultToolRegistry
        .getToolMetadata()
        .map(tool => ({
          ...tool,
          needsApproval: decideToolApproval(tool, { autoApprove }) === 'ask',
        }));
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
