import { ipcMain } from 'electron';

import * as tasksDb from '../../core/db/tasks';
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

export const registerTasksIpc = (): void => {
  if (tasksIpcRegistered) return;
  tasksIpcRegistered = true;

  ipcMain.handle('tasks:list', () => tasksDb.getProactiveTasks());
  ipcMain.handle('tasks:get', (_, id: string) => tasksDb.getProactiveTask(id));

  ipcMain.handle('tasks:create', async (_event, input: any) => {
    try {
      const now = new Date();
      const id = typeof input?.id === 'string' && input.id.trim() ? input.id.trim() : createRuntimeId('task');
      const name = typeof input?.name === 'string' ? input.name.trim() : '';
      const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
      const provider_type = typeof input?.provider_type === 'string' ? input.provider_type.trim() : '';
      const model = typeof input?.model === 'string' ? input.model.trim() : '';
      const enabled = input?.enabled !== false;
      const notify = input?.notify !== false;
      const interval_minutes = clampIntervalMinutes(input?.interval_minutes);
      const schedule_type = 'interval' as const;
      const tools = normalizeToolsJson(input?.tools);
      const thread_id =
        typeof input?.thread_id === 'string' && input.thread_id.trim() ? input.thread_id.trim() : null;

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

  ipcMain.handle('tasks:update', async (_event, id: string, updates: any) => {
    try {
      const existing = tasksDb.getProactiveTask(id);
      if (!existing) throw new Error('Task not found');

      const now = new Date();
      const nextUpdates: Record<string, unknown> = { ...updates };

      if (typeof updates?.tools !== 'undefined') {
        nextUpdates.tools = normalizeToolsJson(updates.tools);
      }

      if (typeof updates?.interval_minutes !== 'undefined') {
        const interval = clampIntervalMinutes(updates.interval_minutes);
        nextUpdates.interval_minutes = interval;

        // When schedule changes, reset next run from "now" (if enabled).
        const enabledAfter =
          typeof updates?.enabled === 'boolean' ? updates.enabled : existing.enabled;
        if (enabledAfter) {
          nextUpdates.next_run_at = addMinutes(now, interval);
        }
      }

      if (typeof updates?.enabled === 'boolean') {
        // If enabling a previously disabled task, schedule from now.
        if (updates.enabled && !existing.enabled) {
          const interval = clampIntervalMinutes(
            typeof updates?.interval_minutes !== 'undefined'
              ? updates.interval_minutes
              : existing.interval_minutes
          );
          nextUpdates.next_run_at = addMinutes(now, interval);
        }
      }

      tasksDb.updateProactiveTask(id, nextUpdates as any);

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

