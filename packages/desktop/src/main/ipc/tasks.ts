import { ipcMain } from 'electron';

import * as tasksDb from '@iki/backend/db/tasks';
import {
  createProactiveTask,
  deleteProactiveTask,
  updateProactiveTask,
  type ProactiveTaskCreateInput,
  type ProactiveTaskUpdateInput,
} from '@iki/backend/tasks/proactive_task_manager';
import { isObjectRecord } from '@iki/core/utils/guards';
import { toPlainData } from '@iki/core/utils/plain_clone';
import { getErrorMessage } from '../utils/errors';
import { runProactiveTask } from '../services/tasks/proactive_tasks';

let tasksIpcRegistered = false;
const normalizeTaskCreateInput = (input: unknown): ProactiveTaskCreateInput =>
  isObjectRecord(input) ? (input as ProactiveTaskCreateInput) : ({} as ProactiveTaskCreateInput);

const normalizeTaskUpdateInput = (input: unknown): ProactiveTaskUpdateInput =>
  isObjectRecord(input) ? (input as ProactiveTaskUpdateInput) : {};

export const registerTasksIpc = (): void => {
  if (tasksIpcRegistered) return;
  tasksIpcRegistered = true;

  ipcMain.handle('tasks:list', () => toPlainData(tasksDb.getProactiveTasks()));
  ipcMain.handle('tasks:get', (_, id: string) => toPlainData(tasksDb.getProactiveTask(id)));

  ipcMain.handle('tasks:create', async (_event, input: unknown) => {
    try {
      const task = createProactiveTask(normalizeTaskCreateInput(input));
      return toPlainData({ success: true, task });
    } catch (error) {
      return toPlainData({ success: false, error: getErrorMessage(error) });
    }
  });

  ipcMain.handle('tasks:update', async (_event, id: string, updates: unknown) => {
    try {
      const task = updateProactiveTask({ id }, normalizeTaskUpdateInput(updates));
      return toPlainData({ success: true, task });
    } catch (error) {
      return toPlainData({ success: false, error: getErrorMessage(error) });
    }
  });

  ipcMain.handle('tasks:delete', async (_event, id: string) => {
    try {
      const result = deleteProactiveTask({ id });
      if (!result.deleted) {
        throw new Error('Task not found');
      }
      return toPlainData({ success: true });
    } catch (error) {
      return toPlainData({ success: false, error: getErrorMessage(error) });
    }
  });

  ipcMain.handle('tasks:run-now', async (_event, id: string) => {
    try {
      const result = await runProactiveTask(id, { reason: 'manual' });
      return toPlainData(result);
    } catch (error) {
      return toPlainData({ success: false, error: getErrorMessage(error) });
    }
  });
};
