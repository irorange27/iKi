import * as tasksDb from '../db/tasks';
import {
  DEFAULT_PROACTIVE_TASK_LIST_LIMIT,
  filterSafeProactiveTaskTools,
  inferProactiveTaskToolMode,
  MAX_PROACTIVE_TASK_LIST_LIMIT,
  normalizeProactiveTaskToolMode,
  parseProactiveTaskTools,
  type ProactiveTask,
  type ProactiveTaskToolMode,
} from '@iki/core/types/tasks';
import { createPrefixedId } from '@iki/core/utils/id';
import {
  clampIntervalMinutes,
  computeNextRunAt,
  normalizeCronExpression,
  normalizeScheduleTimezone,
  normalizeScheduleType,
  validateCronExpression,
} from './task_schedule';

export type ProactiveTaskReference = {
  id?: string | null;
  name?: string | null;
};

export type ProactiveTaskCreateInput = Omit<Partial<ProactiveTask>, 'tools'> &
  Pick<ProactiveTask, 'name' | 'prompt' | 'provider_type' | 'model'> & {
    tools?: string[] | string | null;
  };

export type ProactiveTaskUpdateInput = Omit<Partial<ProactiveTask>, 'tools'> & {
  tools?: string[] | string | null;
};

export type ProactiveTaskRecord = Omit<ProactiveTask, 'tools'> & {
  tools: string[];
  schedule_summary: string;
  tool_summary: string;
};

const trimString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const clampListLimit = (value: unknown): number => {
  const asNumber = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(asNumber)) return DEFAULT_PROACTIVE_TASK_LIST_LIMIT;
  return Math.max(1, Math.min(MAX_PROACTIVE_TASK_LIST_LIMIT, Math.trunc(asNumber)));
};

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

const normalizeProviderId = (value: unknown): string | null => {
  if (value === null) return null;
  const trimmed = trimString(value);
  return trimmed || null;
};

const formatTaskSchedule = (task: {
  schedule_type?: string;
  interval_minutes: number;
  cron_expression?: string | null;
  schedule_timezone?: string | null;
}): string =>
  task.schedule_type === 'cron'
    ? `${task.cron_expression || 'cron'}${task.schedule_timezone ? ` (${task.schedule_timezone})` : ' (local time)'}`
    : `every ${clampIntervalMinutes(task.interval_minutes)} minute(s)`;

const formatTaskToolStrategy = (task: Pick<ProactiveTask, 'tool_mode' | 'tools'>): string => {
  const toolMode = inferProactiveTaskToolMode(task);
  if (toolMode === 'auto')
    return 'Agent decides automatically using the safe built-in tool catalog.';
  if (toolMode === 'disabled') return 'Tools disabled; run as plain model reasoning only.';

  const tools = filterSafeProactiveTaskTools(parseProactiveTaskTools(task.tools));
  return tools.length > 0
    ? `Manual safe tools: ${tools.join(', ')}`
    : 'Manual tool mode configured, but no safe tools remain enabled.';
};

const toProactiveTaskRecord = (task: ProactiveTask): ProactiveTaskRecord => ({
  ...task,
  provider_id: task.provider_id ?? null,
  tools: parseProactiveTaskTools(task.tools),
  schedule_summary: formatTaskSchedule(task),
  tool_summary: formatTaskToolStrategy(task),
});

const matchesQuery = (task: ProactiveTask, query: string): boolean => {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  return [task.id, task.name, task.prompt, task.model, task.provider_type, task.provider_id || '']
    .join('\n')
    .toLowerCase()
    .includes(needle);
};

const resolveTaskByName = (name: string): ProactiveTask | null => {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;

  const matches = tasksDb
    .getProactiveTasks()
    .filter(task => task.name.trim().toLowerCase() === needle);

  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(`Multiple proactive tasks match name "${name}". Use task id instead.`);
  }

  return matches[0];
};

export const resolveProactiveTask = (reference: ProactiveTaskReference): ProactiveTask | null => {
  const byId = trimString(reference.id);
  if (byId) {
    return tasksDb.getProactiveTask(byId);
  }

  const byName = trimString(reference.name);
  if (byName) {
    return resolveTaskByName(byName);
  }

  return null;
};

const resolveToolConfig = (params: {
  toolModeInput: unknown;
  toolsInput: unknown;
  fallbackMode: ProactiveTaskToolMode;
  existingTools?: string[];
}): { toolMode: ProactiveTaskToolMode; serializedTools: string | null } => {
  const normalizedTools = normalizeToolsInput(params.toolsInput);
  const nextToolMode =
    params.toolModeInput !== undefined
      ? normalizeProactiveTaskToolMode(params.toolModeInput, params.fallbackMode)
      : normalizedTools !== null
        ? inferProactiveTaskToolMode({ tools: normalizedTools })
        : params.fallbackMode;
  const nextToolsArray = normalizedTools !== null ? normalizedTools : (params.existingTools ?? []);

  if (nextToolMode === 'manual' && nextToolsArray.length === 0) {
    throw new Error('Manual tool mode requires at least one safe tool');
  }

  const serializedTools =
    normalizedTools === null ? null : serializeTools(validateManualTools(nextToolsArray));

  return { toolMode: nextToolMode, serializedTools };
};

export const createProactiveTask = (input: ProactiveTaskCreateInput): ProactiveTask => {
  const now = new Date();
  const id = trimString(input.id) || createPrefixedId('task');
  const name = trimString(input.name);
  const prompt = trimString(input.prompt);
  const provider_type = trimString(input.provider_type);
  const provider_id = normalizeProviderId(input.provider_id);
  const model = trimString(input.model);
  const enabled = input.enabled !== false;
  const notify = input.notify !== false;
  const schedule_type = normalizeScheduleType(input.schedule_type);
  const interval_minutes = clampIntervalMinutes(input.interval_minutes);
  const cron_expression = normalizeCronExpression(input.cron_expression);
  const schedule_timezone = normalizeScheduleTimezone(input.schedule_timezone);
  const thread_id = trimString(input.thread_id) || null;
  const { toolMode, serializedTools } = resolveToolConfig({
    toolModeInput: input.tool_mode,
    toolsInput: input.tools,
    fallbackMode: inferProactiveTaskToolMode(input),
  });

  if (!name) throw new Error('Task name is required');
  if (!prompt) throw new Error('Task prompt is required');
  if (!provider_type) throw new Error('Task provider_type is required');
  if (!model) throw new Error('Task model is required');

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
    schedule_type,
    interval_minutes,
    cron_expression,
    schedule_timezone,
    enabled,
    provider_type,
    provider_id,
    model,
    tool_mode: toolMode,
    tools: serializedTools,
    thread_id,
    notify,
    next_run_at: computeNextRunAt(
      {
        schedule_type,
        interval_minutes,
        cron_expression,
        schedule_timezone,
      },
      now.toISOString()
    ),
  });

  const created = tasksDb.getProactiveTask(id);
  if (!created) {
    throw new Error('Failed to create proactive task');
  }
  return created;
};

export const updateProactiveTask = (
  reference: ProactiveTaskReference,
  updates: ProactiveTaskUpdateInput
): ProactiveTask => {
  const existing = resolveProactiveTask(reference);
  if (!existing) throw new Error('Task not found');

  const now = new Date();
  const nextUpdates: Partial<ProactiveTask> = {};
  const hasName = Object.prototype.hasOwnProperty.call(updates, 'name');
  const hasPrompt = Object.prototype.hasOwnProperty.call(updates, 'prompt');
  const hasProviderType = Object.prototype.hasOwnProperty.call(updates, 'provider_type');
  const hasProviderId = Object.prototype.hasOwnProperty.call(updates, 'provider_id');
  const hasModel = Object.prototype.hasOwnProperty.call(updates, 'model');
  const hasThreadId = Object.prototype.hasOwnProperty.call(updates, 'thread_id');
  const hasNotify = Object.prototype.hasOwnProperty.call(updates, 'notify');
  const hasEnabled = Object.prototype.hasOwnProperty.call(updates, 'enabled');
  const hasScheduleType = Object.prototype.hasOwnProperty.call(updates, 'schedule_type');
  const hasIntervalMinutes = Object.prototype.hasOwnProperty.call(updates, 'interval_minutes');
  const hasCronExpression = Object.prototype.hasOwnProperty.call(updates, 'cron_expression');
  const hasScheduleTimezone = Object.prototype.hasOwnProperty.call(updates, 'schedule_timezone');
  const hasToolMode = Object.prototype.hasOwnProperty.call(updates, 'tool_mode');
  const hasTools = Object.prototype.hasOwnProperty.call(updates, 'tools');

  if (hasName) {
    const name = trimString(updates.name);
    if (!name) throw new Error('Task name is required');
    nextUpdates.name = name;
  }
  if (hasPrompt) {
    const prompt = trimString(updates.prompt);
    if (!prompt) throw new Error('Task prompt is required');
    nextUpdates.prompt = prompt;
  }
  if (hasProviderType) {
    const providerType = trimString(updates.provider_type);
    if (!providerType) throw new Error('Task provider_type is required');
    nextUpdates.provider_type = providerType;
  }
  if (hasProviderId) {
    nextUpdates.provider_id = normalizeProviderId(updates.provider_id);
  }
  if (hasModel) {
    const model = trimString(updates.model);
    if (!model) throw new Error('Task model is required');
    nextUpdates.model = model;
  }
  if (hasThreadId) {
    nextUpdates.thread_id = trimString(updates.thread_id) || null;
  }
  if (hasNotify && typeof updates.notify === 'boolean') {
    nextUpdates.notify = updates.notify;
  }
  if (hasEnabled && typeof updates.enabled === 'boolean') {
    nextUpdates.enabled = updates.enabled;
  }

  const scheduleType = hasScheduleType
    ? normalizeScheduleType(updates.schedule_type)
    : normalizeScheduleType(existing.schedule_type);
  const intervalMinutes = hasIntervalMinutes
    ? clampIntervalMinutes(updates.interval_minutes)
    : existing.interval_minutes;
  const cronExpression = hasCronExpression
    ? normalizeCronExpression(updates.cron_expression)
    : existing.cron_expression ?? null;
  const scheduleTimezone = hasScheduleTimezone
    ? normalizeScheduleTimezone(updates.schedule_timezone)
    : existing.schedule_timezone ?? null;

  if (hasScheduleType) {
    nextUpdates.schedule_type = scheduleType;
  }
  if (hasIntervalMinutes) {
    nextUpdates.interval_minutes = intervalMinutes;
  }
  if (hasCronExpression) {
    nextUpdates.cron_expression = cronExpression;
  }
  if (hasScheduleTimezone) {
    nextUpdates.schedule_timezone = scheduleTimezone;
  }

  if (scheduleType === 'interval' && (hasScheduleType || hasCronExpression || hasScheduleTimezone)) {
    nextUpdates.cron_expression = null;
    nextUpdates.schedule_timezone = null;
  }

  const existingToolMode = inferProactiveTaskToolMode(existing);
  const existingTools = parseProactiveTaskTools(existing.tools);
  if (hasToolMode || hasTools) {
    const { toolMode, serializedTools } = resolveToolConfig({
      toolModeInput: hasToolMode ? updates.tool_mode : undefined,
      toolsInput: hasTools ? updates.tools : undefined,
      fallbackMode: existingToolMode,
      existingTools,
    });
    nextUpdates.tool_mode = toolMode;
    if (hasTools) {
      nextUpdates.tools = serializedTools;
    }
  }

  const enabledAfter = hasEnabled && typeof updates.enabled === 'boolean' ? updates.enabled : existing.enabled;
  const enablingFromDisabled = hasEnabled && updates.enabled === true && !existing.enabled;
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
    nextUpdates.next_run_at = computeNextRunAt(
      {
        schedule_type: scheduleType,
        interval_minutes: intervalMinutes,
        cron_expression: scheduleType === 'cron' ? cronExpression : null,
        schedule_timezone: scheduleType === 'cron' ? scheduleTimezone : null,
      },
      now.toISOString()
    );
  }

  if (Object.keys(nextUpdates).length === 0) {
    throw new Error('No task updates were provided');
  }

  tasksDb.updateProactiveTask(existing.id, nextUpdates);
  const updated = tasksDb.getProactiveTask(existing.id);
  if (!updated) {
    throw new Error('Failed to update proactive task');
  }
  return updated;
};

export const listProactiveTaskRecords = (params?: {
  query?: string;
  limit?: number;
}): ProactiveTaskRecord[] => {
  const query = trimString(params?.query);
  const limit = clampListLimit(params?.limit);

  return tasksDb
    .getProactiveTasks()
    .filter(task => matchesQuery(task, query))
    .slice(0, limit)
    .map(toProactiveTaskRecord);
};

export const readProactiveTaskRecord = (
  reference: ProactiveTaskReference
): ProactiveTaskRecord | null => {
  const task = resolveProactiveTask(reference);
  return task ? toProactiveTaskRecord(task) : null;
};

export const deleteProactiveTask = (
  reference: ProactiveTaskReference
): { deleted: boolean; taskId: string | null; taskName: string | null } => {
  const task = resolveProactiveTask(reference);
  if (!task) {
    return { deleted: false, taskId: null, taskName: null };
  }

  tasksDb.deleteProactiveTask(task.id);
  return { deleted: true, taskId: task.id, taskName: task.name };
};

export const getProactiveTaskRecord = toProactiveTaskRecord;
