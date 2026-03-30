import { getDb } from './database';
import type { TaskPlan, TaskPlanItemDraft } from '../../shared/types/task_plan';
import { normalizeTaskPlanItems } from '../todos/task_plan';
import { normalizeWhitespace, toIsoNow } from '../../shared/utils/text';

type ThreadTodoRow = {
  thread_id: string;
  items: string;
  created_at: string;
  updated_at: string;
};

const parseThreadTodoItems = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const normalizeThreadTodoRow = (row: ThreadTodoRow): TaskPlan => ({
  thread_id: row.thread_id,
  items: normalizeTaskPlanItems(parseThreadTodoItems(row.items)),
  created_at: row.created_at,
  updated_at: row.updated_at,
});

export const getThreadTodoPlan = (threadId: string): TaskPlan | null => {
  const normalizedThreadId = normalizeWhitespace(threadId);
  if (!normalizedThreadId) return null;

  const row = getDb()
    .prepare('SELECT * FROM chat_thread_todos WHERE thread_id = ?')
    .get(normalizedThreadId) as ThreadTodoRow | undefined;

  return row ? normalizeThreadTodoRow(row) : null;
};

export const writeThreadTodoPlan = (params: {
  threadId: string;
  items?: TaskPlanItemDraft[];
}): TaskPlan => {
  const normalizedThreadId = normalizeWhitespace(params.threadId);
  if (!normalizedThreadId) {
    throw new Error('Todo tool requires an active chat thread');
  }

  const items = normalizeTaskPlanItems(Array.isArray(params.items) ? params.items : []);
  const now = toIsoNow();
  const existing = getThreadTodoPlan(normalizedThreadId);

  getDb()
    .prepare(
      `
      INSERT INTO chat_thread_todos (
        thread_id,
        items,
        created_at,
        updated_at
      ) VALUES (
        @thread_id,
        @items,
        @created_at,
        @updated_at
      )
      ON CONFLICT(thread_id) DO UPDATE SET
        items = excluded.items,
        updated_at = excluded.updated_at
    `
    )
    .run({
      thread_id: normalizedThreadId,
      items: JSON.stringify(items),
      created_at: existing?.created_at || now,
      updated_at: now,
    });

  const plan = getThreadTodoPlan(normalizedThreadId);
  if (!plan) {
    throw new Error('Todo plan was written but could not be reloaded');
  }

  return plan;
};
