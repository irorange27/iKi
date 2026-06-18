import { ipcMain } from 'electron';
import { resetWorkflowOptimizationState } from '../services/workflow/workflow_optimizer';

let workflowIpcRegistered = false;

export const registerWorkflowIpc = (): void => {
  if (workflowIpcRegistered) return;
  workflowIpcRegistered = true;

  ipcMain.handle('workflow:reset-auto-skills', () => {
    try {
      resetWorkflowOptimizationState();
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to reset workflow data';
      return { success: false, error: message };
    }
  });
};
