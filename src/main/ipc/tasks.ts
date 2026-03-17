import { ipcMain } from 'electron';

import * as tasksDb from '../../core/db/tasks';
import type { ProactiveTask } from '../../shared/types/tasks';
import { isObjectRecord } from '../../shared/utils/guards';
import { getErrorMessage } from '../utils/errors';
import { runProactiveTask } from '../services/tasks/proactive_tasks';

let tasksIpcRegistered = false;

const createRuntimeId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const clampIntervalMinutes = (value: unknown): number => {
  const asNumber = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(asNumber)) return 60;
  return Math.min(60 * 24 * 7, Math.max(1, Math.trunc(asNumber)));
};

const addMinutes = (base: Date, minutes: number): string => {
  const next = new Date(base.getTime());
  next.setMinutes(next.getMinutes() + minutes);
  return next.toISOString();
};

const normalizeToolsJson = (raw: unknown): string | null => {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const tools = raw
      .filter((t): t is string => typeof t === 'string')
      .map(t => t.trim())
      .filter(Boolean);
    return tools.length > 0 ? JSON.stringify(tools) : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    // If it's already JSON we trust it; otherwise treat as a single tool name.
    if (trimmed.startsWith('[')) return trimmed;
    return JSON.stringify([trimmed]);
  }
  return null;
};

const normalizeTaskInput = (input: unknown): Partial<ProactiveTask> =>
  (isObjectRecord(input) ? (input as Partial<ProactiveTask>) : {});

export const registerTasksIpc = (): void => {
  if (tasksIpcRegistered) return;
  tasksIpcRegistered = true;

  ipcMain.handle('tasks:list', () => tasksDb.getProactiveTasks());
  ipcMain.handle('tasks:get', (_, id: string) => tasksDb.getProactiveTask(id));

  ipcMain.handle('tasks:create', async (_event, input: unknown) => {
    try {
      const taskInput = normalizeTaskInput(input);
      const now = new Date();
      const id =
        typeof taskInput.id === 'string' && taskInput.id.trim()
          ? taskInput.id.trim()
          : createRuntimeId('task');
      const name = typeof taskInput.name === 'string' ? taskInput.name.trim() : '';
      const prompt = typeof taskInput.prompt === 'string' ? taskInput.prompt.trim() : '';
      const provider_type =
        typeof taskInput.provider_type === 'string' ? taskInput.provider_type.trim() : '';
      const model = typeof taskInput.model === 'string' ? taskInput.model.trim() : '';
      const enabled = taskInput.enabled !== false;
      const notify = taskInput.notify !== false;
      const interval_minutes = clampIntervalMinutes(taskInput.interval_minutes);
      const schedule_type = 'interval' as const;
      const tools = normalizeToolsJson(taskInput.tools);
      const thread_id =
        typeof taskInput.thread_id === 'string' && taskInput.thread_id.trim()
          ? taskInput.thread_id.trim()
          : null;

      if (!name) throw new Error('Task name is required');
      if (!prompt) throw new Error('Task prompt is required');
      if (!provider_type) throw new Error('Task provider_type is required');
      if (!model) throw new Error('Task model is required');

      tasksDb.addProactiveTask({
        id,
        name,
        prompt,
        provider_type,
        model,
        enabled,
        notify,
        schedule_type,
        interval_minutes,
        tools,
        thread_id,
        // First run is scheduled from "now".
        next_run_at: addMinutes(now, interval_minutes),
      });

      return { success: true, task: tasksDb.getProactiveTask(id) };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('tasks:update', async (_event, id: string, updates: unknown) => {
    try {
      const existing = tasksDb.getProactiveTask(id);
      if (!existing) throw new Error('Task not found');

      const taskUpdates = normalizeTaskInput(updates);
      const now = new Date();
      const nextUpdates: Partial<ProactiveTask> = { ...taskUpdates };

      if (typeof taskUpdates.tools !== 'undefined') {
        nextUpdates.tools = normalizeToolsJson(taskUpdates.tools);
      }

      if (typeof taskUpdates.interval_minutes !== 'undefined') {
        const interval = clampIntervalMinutes(taskUpdates.interval_minutes);
        nextUpdates.interval_minutes = interval;

        // When schedule changes, reset next run from "now" (if enabled).
        const enabledAfter =
          typeof taskUpdates.enabled === 'boolean' ? taskUpdates.enabled : existing.enabled;
        if (enabledAfter) {
          nextUpdates.next_run_at = addMinutes(now, interval);
        }
      }

      if (typeof taskUpdates.enabled === 'boolean') {
        // If enabling a previously disabled task, schedule from now.
        if (taskUpdates.enabled && !existing.enabled) {
          const interval = clampIntervalMinutes(
            typeof taskUpdates.interval_minutes !== 'undefined'
              ? taskUpdates.interval_minutes
              : existing.interval_minutes
          );
          nextUpdates.next_run_at = addMinutes(now, interval);
        }
      }

      tasksDb.updateProactiveTask(id, nextUpdates);

      return { success: true, task: tasksDb.getProactiveTask(id) };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('tasks:delete', async (_event, id: string) => {
    try {
      tasksDb.deleteProactiveTask(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  });

  ipcMain.handle('tasks:run-now', async (_event, id: string) => {
    const result = await runProactiveTask(id, { reason: 'manual' });
    return result;
  });
};
