import { clampIntervalMinutes } from './task_schedule';
import {
  filterSafeProactiveTaskTools,
  inferProactiveTaskToolMode,
  parseProactiveTaskTools,
} from '@iki/backend/types/tasks';

export const formatTaskSchedule = (task: {
  schedule_type?: string;
  interval_minutes: number;
  cron_expression?: string | null;
  schedule_timezone?: string | null;
}): string =>
  task.schedule_type === 'cron'
    ? `${task.cron_expression || 'cron'}${task.schedule_timezone ? ` (${task.schedule_timezone})` : ' (local time)'}`
    : `every ${clampIntervalMinutes(task.interval_minutes)} minute(s)`;

export const formatTaskToolStrategy = (task: { tool_mode?: unknown; tools?: unknown }): string => {
  const toolMode = inferProactiveTaskToolMode(task);
  if (toolMode === 'auto') {
    return 'Agent decides automatically using the safe built-in tool catalog.';
  }
  if (toolMode === 'disabled') return 'Tools disabled; run as plain model reasoning only.';

  const tools = filterSafeProactiveTaskTools(parseProactiveTaskTools(task.tools));
  return tools.length > 0
    ? `Manual safe tools: ${tools.join(', ')}`
    : 'Manual tool mode configured, but no safe tools remain enabled.';
};
