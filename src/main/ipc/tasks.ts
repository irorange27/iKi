import { ipcMain } from 'electron';

import * as tasksDb from '../../core/db/tasks';
import {
  filterSafeProactiveTaskTools,
  inferProactiveTaskToolMode,
  normalizeProactiveTaskToolMode,
  parseProactiveTaskTools,
  type ProactiveTask,
} from '../../shared/types/tasks';
import { isObjectRecord } from '../../shared/utils/guards';
import { toIpcSerializable } from '../../shared/utils/ipc_serialization';
import { getErrorMessage } from '../utils/errors';
import { runProactiveTask } from '../services/tasks/proactive_tasks';
import {
  clampIntervalMinutes,
  computeNextRunAt,
  normalizeCronExpression,
  normalizeScheduleTimezone,
  normalizeScheduleType,
  validateCronExpression,
} from '../services/tasks/task_schedule';

let tasksIpcRegistered = false;

const createRuntimeId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const computeNextRunAtFromNow = (
  schedule: {
    schedule_type: ProactiveTask['schedule_type'];
    interval_minutes: number;
    cron_expression?: string | null;
    schedule_timezone?: string | null;
  },
  now: Date
) => computeNextRunAt(schedule, now.toISOString());

const normalizeToolsInput = (raw: unknown): string[] | null => {
  if (raw === null || typeof raw === 'undefined') return null;
  return parseProactiveTaskTools(raw);
};

const serializeTools = (tools: string[] | null): string | null =>
  tools === null ? null : JSON.stringify(tools);

const validateManualTools = (tools: string[]) => {
  const safeTools = filterSafeProactiveTaskTools(tools);
  const invalidTools = tools.filter(
    tool => !safeTools.includes(tool as (typeof safeTools)[number])
  );

  if (invalidTools.length > 0) {
    throw new Error(`Unsupported proactive task tools: ${invalidTools.join(', ')}`);
  }

  return safeTools;
};

const normalizeTaskInput = (input: unknown): Partial<ProactiveTask> =>
  isObjectRecord(input) ? (input as Partial<ProactiveTask>) : {};

export const registerTasksIpc = (): void => {
  if (tasksIpcRegistered) return;
  tasksIpcRegistered = true;

  ipcMain.handle('tasks:list', () => toIpcSerializable(tasksDb.getProactiveTasks()));
  ipcMain.handle('tasks:get', (_, id: string) => toIpcSerializable(tasksDb.getProactiveTask(id)));

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
      const schedule_type = normalizeScheduleType(taskInput.schedule_type);
      const interval_minutes = clampIntervalMinutes(taskInput.interval_minutes);
      const cron_expression = normalizeCronExpression(taskInput.cron_expression);
      const schedule_timezone = normalizeScheduleTimezone(taskInput.schedule_timezone);
      const normalizedTools = normalizeToolsInput(taskInput.tools);
      const tool_mode = normalizeProactiveTaskToolMode(
        taskInput.tool_mode,
        inferProactiveTaskToolMode(taskInput)
      );
      const tools =
        normalizedTools === null ? null : serializeTools(validateManualTools(normalizedTools));
      const thread_id =
        typeof taskInput.thread_id === 'string' && taskInput.thread_id.trim()
          ? taskInput.thread_id.trim()
          : null;

      if (!name) throw new Error('Task name is required');
      if (!prompt) throw new Error('Task prompt is required');
      if (!provider_type) throw new Error('Task provider_type is required');
      if (!model) throw new Error('Task model is required');
      if (tool_mode === 'manual' && (!normalizedTools || normalizedTools.length === 0)) {
        throw new Error('Manual tool mode requires at least one safe tool');
      }

      if (schedule_type === 'cron') {
        if (!cron_expression) throw new Error('Cron expression is required');
        const cronError = validateCronExpression(cron_expression, schedule_timezone);
        if (cronError) {
          throw new Error(`Invalid cron expression: ${cronError}`);
        }
      }

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
        cron_expression,
        schedule_timezone,
        tool_mode,
        tools,
        thread_id,
        // First run is scheduled from "now".
        next_run_at: computeNextRunAtFromNow(
          {
            schedule_type,
            interval_minutes,
            cron_expression,
            schedule_timezone,
          },
          now
        ),
      });

      return toIpcSerializable({ success: true, task: tasksDb.getProactiveTask(id) });
    } catch (error) {
      return toIpcSerializable({ success: false, error: getErrorMessage(error) });
    }
  });

  ipcMain.handle('tasks:update', async (_event, id: string, updates: unknown) => {
    try {
      const existing = tasksDb.getProactiveTask(id);
      if (!existing) throw new Error('Task not found');

      const taskUpdates = normalizeTaskInput(updates);
      const now = new Date();
      const nextUpdates: Partial<ProactiveTask> = { ...taskUpdates };
      const hasScheduleType = typeof taskUpdates.schedule_type === 'string';
      const scheduleType = hasScheduleType
        ? normalizeScheduleType(taskUpdates.schedule_type)
        : normalizeScheduleType(existing.schedule_type);
      const hasCronExpression = Object.prototype.hasOwnProperty.call(
        taskUpdates,
        'cron_expression'
      );
      const hasScheduleTimezone = Object.prototype.hasOwnProperty.call(
        taskUpdates,
        'schedule_timezone'
      );
      const hasIntervalMinutes = typeof taskUpdates.interval_minutes !== 'undefined';
      const hasToolMode = Object.prototype.hasOwnProperty.call(taskUpdates, 'tool_mode');
      const hasTools = Object.prototype.hasOwnProperty.call(taskUpdates, 'tools');

      const existingToolMode = inferProactiveTaskToolMode(existing);
      const normalizedExistingTools = parseProactiveTaskTools(existing.tools);
      const normalizedUpdatedTools = hasTools ? normalizeToolsInput(taskUpdates.tools) : null;
      const nextToolMode = hasToolMode
        ? normalizeProactiveTaskToolMode(taskUpdates.tool_mode, existingToolMode)
        : hasTools
          ? inferProactiveTaskToolMode({ tools: normalizedUpdatedTools })
          : existingToolMode;
      const nextToolsArray =
        normalizedUpdatedTools !== null ? normalizedUpdatedTools : normalizedExistingTools;

      if (hasTools) {
        nextUpdates.tools = serializeTools(validateManualTools(nextToolsArray));
      }

      if (hasToolMode || hasTools) {
        nextUpdates.tool_mode = nextToolMode;
      }

      if (nextToolMode === 'manual' && nextToolsArray.length === 0) {
        throw new Error('Manual tool mode requires at least one safe tool');
      }

      if (hasScheduleType) {
        nextUpdates.schedule_type = scheduleType;
      }

      if (hasCronExpression) {
        nextUpdates.cron_expression = normalizeCronExpression(taskUpdates.cron_expression);
      }

      if (hasScheduleTimezone) {
        nextUpdates.schedule_timezone = normalizeScheduleTimezone(taskUpdates.schedule_timezone);
      }

      if (hasIntervalMinutes) {
        nextUpdates.interval_minutes = clampIntervalMinutes(taskUpdates.interval_minutes);
      }

      const enabledUpdate = typeof taskUpdates.enabled === 'boolean';
      const enabledAfter = enabledUpdate ? taskUpdates.enabled : existing.enabled;
      const enablingFromDisabled = enabledUpdate && taskUpdates.enabled && !existing.enabled;
      const intervalMinutes =
        typeof nextUpdates.interval_minutes === 'number'
          ? nextUpdates.interval_minutes
          : existing.interval_minutes;
      const cronExpression =
        (hasCronExpression ? nextUpdates.cron_expression : existing.cron_expression) ?? null;
      const scheduleTimezone =
        (hasScheduleTimezone ? nextUpdates.schedule_timezone : existing.schedule_timezone) ?? null;

      if (
        scheduleType === 'interval' &&
        (hasScheduleType || hasCronExpression || hasScheduleTimezone)
      ) {
        nextUpdates.cron_expression = null;
        nextUpdates.schedule_timezone = null;
      }

      const scheduleChanged =
        (scheduleType === 'interval' && (hasScheduleType || hasIntervalMinutes)) ||
        (scheduleType === 'cron' && (hasScheduleType || hasCronExpression || hasScheduleTimezone));

      if (scheduleType === 'cron' && (scheduleChanged || enablingFromDisabled)) {
        if (!cronExpression) throw new Error('Cron expression is required');
        const cronError = validateCronExpression(cronExpression, scheduleTimezone);
        if (cronError) {
          throw new Error(`Invalid cron expression: ${cronError}`);
        }
      }

      if ((scheduleChanged || enablingFromDisabled) && enabledAfter) {
        nextUpdates.next_run_at = computeNextRunAtFromNow(
          {
            schedule_type: scheduleType,
            interval_minutes: intervalMinutes,
            cron_expression: scheduleType === 'cron' ? cronExpression : null,
            schedule_timezone: scheduleType === 'cron' ? scheduleTimezone : null,
          },
          now
        );
      }

      tasksDb.updateProactiveTask(id, nextUpdates);

      return toIpcSerializable({ success: true, task: tasksDb.getProactiveTask(id) });
    } catch (error) {
      return toIpcSerializable({ success: false, error: getErrorMessage(error) });
    }
  });

  ipcMain.handle('tasks:delete', async (_event, id: string) => {
    try {
      tasksDb.deleteProactiveTask(id);
      return toIpcSerializable({ success: true });
    } catch (error) {
      return toIpcSerializable({ success: false, error: getErrorMessage(error) });
    }
  });

  ipcMain.handle('tasks:run-now', async (_event, id: string) => {
    const result = await runProactiveTask(id, { reason: 'manual' });
    return toIpcSerializable(result);
  });
};
