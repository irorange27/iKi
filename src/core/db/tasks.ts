import db from './database';
import type { ProactiveTask } from '../../shared/types/tasks';

type ProactiveTaskRow = Omit<ProactiveTask, 'enabled' | 'notify'> & {
  enabled: number | boolean;
  notify: number | boolean;
};

const nowIso = () => new Date().toISOString();

const normalizeRow = (row: ProactiveTaskRow): ProactiveTask => ({
  ...row,
  enabled: Boolean(row.enabled),
  notify: Boolean(row.notify),
});

export const getProactiveTasks = (): ProactiveTask[] => {
  const rows = db
    .prepare('SELECT * FROM proactive_tasks ORDER BY updated_at DESC')
    .all() as ProactiveTaskRow[];
  return rows.map(normalizeRow);
};

export const getProactiveTask = (id: string): ProactiveTask | null => {
  const row = db
    .prepare('SELECT * FROM proactive_tasks WHERE id = ?')
    .get(id) as ProactiveTaskRow | undefined;
  if (!row) return null;
  return normalizeRow(row);
};

export const listDueProactiveTasks = (now: string): ProactiveTask[] => {
  const rows = db
    .prepare(
      `
      SELECT * FROM proactive_tasks
      WHERE enabled = 1
        AND (next_run_at IS NULL OR next_run_at <= ?)
      ORDER BY COALESCE(next_run_at, '') ASC, updated_at DESC
    `
    )
    .all(now) as ProactiveTaskRow[];
  return rows.map(normalizeRow);
};

export const addProactiveTask = (
  task: Partial<ProactiveTask> & {
    id: string;
    name: string;
    prompt: string;
    provider_type: string;
    model: string;
  }
) => {
  const now = nowIso();
  const intervalMinutes =
    typeof task.interval_minutes === 'number' ? Math.trunc(task.interval_minutes) : 60;
  const nextRunAt =
    typeof task.next_run_at === 'string' && task.next_run_at.trim()
      ? task.next_run_at.trim()
      : new Date(Date.now() + Math.max(1, intervalMinutes) * 60_000).toISOString();
  const stmt = db.prepare(`
    INSERT INTO proactive_tasks (
      id,
      name,
      prompt,
      schedule_type,
      interval_minutes,
      enabled,
      provider_type,
      model,
      tools,
      thread_id,
      notify,
      last_run_at,
      next_run_at,
      last_status,
      last_output,
      last_error,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @name,
      @prompt,
      @schedule_type,
      @interval_minutes,
      @enabled,
      @provider_type,
      @model,
      @tools,
      @thread_id,
      @notify,
      @last_run_at,
      @next_run_at,
      @last_status,
      @last_output,
      @last_error,
      @created_at,
      @updated_at
    )
  `);

  const data = {
    id: task.id,
    name: task.name,
    prompt: task.prompt,
    schedule_type: task.schedule_type || 'interval',
    interval_minutes: intervalMinutes,
    enabled: task.enabled ? 1 : 0,
    provider_type: task.provider_type,
    model: task.model,
    tools: task.tools ?? null,
    thread_id: task.thread_id ?? null,
    notify: task.notify === false ? 0 : 1,
    last_run_at: task.last_run_at ?? null,
    next_run_at: nextRunAt,
    last_status: task.last_status ?? 'idle',
    last_output: task.last_output ?? null,
    last_error: task.last_error ?? null,
    created_at: now,
    updated_at: now,
  };

  return stmt.run(data);
};

export const updateProactiveTask = (id: string, updates: Partial<ProactiveTask>) => {
  const now = nowIso();
  const fields = Object.keys(updates)
    .filter(key => key !== 'id' && key !== 'created_at' && key !== 'updated_at')
    .map(key => `${key} = @${key}`)
    .join(', ');

  if (!fields) return null;

  const stmt = db.prepare(`
    UPDATE proactive_tasks
    SET ${fields}, updated_at = @updated_at
    WHERE id = @id
  `);

  const params: Record<string, unknown> = {
    ...updates,
    id,
    updated_at: now,
  };

  if (typeof updates.enabled === 'boolean') {
    params.enabled = updates.enabled ? 1 : 0;
  }
  if (typeof updates.notify === 'boolean') {
    params.notify = updates.notify ? 1 : 0;
  }
  if (typeof updates.interval_minutes === 'number') {
    params.interval_minutes = Math.trunc(updates.interval_minutes);
  }

  return stmt.run(params);
};

export const deleteProactiveTask = (id: string) => {
  return db.prepare('DELETE FROM proactive_tasks WHERE id = ?').run(id);
};
