import type { TaskPlanItem, TaskPlanItemDraft, TaskPlanItemStatus } from '../../shared/types/task_plan';
import { normalizeWhitespace } from '../../shared/utils/text';

export const MAX_TASK_PLAN_ITEMS = 20;

const VALID_TASK_PLAN_STATUSES = new Set<TaskPlanItemStatus>([
  'pending',
  'in_progress',
  'completed',
]);

const normalizeTaskPlanStatus = (value: unknown): TaskPlanItemStatus => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return VALID_TASK_PLAN_STATUSES.has(normalized as TaskPlanItemStatus)
    ? (normalized as TaskPlanItemStatus)
    : 'pending';
};

export const normalizeTaskPlanItems = (items: TaskPlanItemDraft[]): TaskPlanItem[] => {
  if (items.length > MAX_TASK_PLAN_ITEMS) {
    throw new Error(`Max ${MAX_TASK_PLAN_ITEMS} todos allowed`);
  }

  const normalizedItems = items.map((item, index) => {
    const id = normalizeWhitespace(item.id) || String(index + 1);
    const text = normalizeWhitespace(item.text);
    const status = normalizeTaskPlanStatus(item.status);

    if (!text) {
      throw new Error(`Item ${id}: text required`);
    }

    return {
      id,
      text,
      status,
    };
  });

  const inProgressCount = normalizedItems.filter(item => item.status === 'in_progress').length;
  if (inProgressCount > 1) {
    throw new Error('Only one task can be in_progress at a time');
  }

  return normalizedItems;
};

export const summarizeTaskPlan = (items: TaskPlanItem[]) => {
  const completedCount = items.filter(item => item.status === 'completed').length;
  const inProgressCount = items.filter(item => item.status === 'in_progress').length;
  const pendingCount = items.length - completedCount - inProgressCount;

  return {
    totalCount: items.length,
    completedCount,
    inProgressCount,
    pendingCount,
  };
};

export const renderTaskPlan = (items: TaskPlanItem[]): string => {
  if (items.length === 0) {
    return 'No todos.';
  }

  const lines = items.map(item => {
    const marker =
      item.status === 'completed' ? '[x]' : item.status === 'in_progress' ? '[>]' : '[ ]';
    return `${marker} #${item.id}: ${item.text}`;
  });
  const summary = summarizeTaskPlan(items);
  lines.push(`\n(${summary.completedCount}/${summary.totalCount} completed)`);
  return lines.join('\n');
};
