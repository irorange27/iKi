export type ProactiveTaskScheduleType = 'interval' | 'cron';
export type ProactiveTaskStatus = 'idle' | 'running' | 'success' | 'error';
export type ProactiveTaskToolMode = 'auto' | 'manual' | 'disabled';

export const DEFAULT_PROACTIVE_TASK_LIST_LIMIT = 20;
export const MAX_PROACTIVE_TASK_LIST_LIMIT = 100;
export const SAFE_PROACTIVE_TASK_TOOLS = ['web', 'fetch', 'read_file', 'list_dir'] as const;
export type SafeProactiveTaskTool = (typeof SAFE_PROACTIVE_TASK_TOOLS)[number];

const SAFE_PROACTIVE_TASK_TOOL_SET = new Set<string>(SAFE_PROACTIVE_TASK_TOOLS);

const normalizeToolList = (raw: unknown[]): string[] => {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
};

export const parseProactiveTaskTools = (raw: unknown): string[] => {
  if (Array.isArray(raw)) {
    return normalizeToolList(raw);
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? normalizeToolList(parsed) : [];
      } catch {
        return [];
      }
    }

    return normalizeToolList([trimmed]);
  }

  return [];
};

export const filterSafeProactiveTaskTools = (tools: string[]): SafeProactiveTaskTool[] =>
  tools.filter((tool): tool is SafeProactiveTaskTool => SAFE_PROACTIVE_TASK_TOOL_SET.has(tool));

export const normalizeProactiveTaskToolMode = (
  raw: unknown,
  fallback: ProactiveTaskToolMode = 'auto'
): ProactiveTaskToolMode =>
  raw === 'manual' || raw === 'disabled' || raw === 'auto' ? raw : fallback;

export const inferProactiveTaskToolMode = (task: {
  tool_mode?: unknown;
  tools?: unknown;
}): ProactiveTaskToolMode =>
  normalizeProactiveTaskToolMode(
    task.tool_mode,
    parseProactiveTaskTools(task.tools).length > 0 ? 'manual' : 'auto'
  );

export interface ProactiveTask {
  id: string;
  name: string;
  prompt: string;
  schedule_type: ProactiveTaskScheduleType;
  interval_minutes: number;
  cron_expression?: string | null;
  schedule_timezone?: string | null;
  enabled: boolean;
  provider_type: string;
  provider_id?: string | null;
  model: string;
  tool_mode: ProactiveTaskToolMode;
  tools?: string | null; // JSON string, default null
  thread_id?: string | null;
  notify: boolean;
  last_run_at?: string | null;
  next_run_at?: string | null;
  last_status?: ProactiveTaskStatus | null;
  last_output?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
}
