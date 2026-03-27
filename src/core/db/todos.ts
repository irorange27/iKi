import { getDb } from './database';
import type {
  TodoItem,
  TodoItemStatus,
  TodoList,
  TodoListItemDraft,
  TodoListSummary,
} from '../../shared/types/todos';
import { createPrefixedId } from '../../shared/utils/id';

type TodoListRow = {
  id: string;
  title: string;
  summary?: string | null;
  created_at: string;
  updated_at: string;
  item_count?: number | null;
  completed_count?: number | null;
  pending_count?: number | null;
};

type TodoItemRow = Omit<TodoItem, 'status'> & {
  status: string;
};

const DEFAULT_TODO_LIST_LIMIT = 20;
const MAX_TODO_LIST_LIMIT = 100;

const nowIso = () => new Date().toISOString();

const normalizeText = (value: unknown): string =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';

const normalizeOptionalText = (value: unknown): string | null => {
  const normalized = normalizeText(value);
  return normalized ? normalized : null;
};

const normalizeTitleKey = (title: string): string => normalizeText(title).toLowerCase();

const normalizeStatus = (value: unknown): TodoItemStatus =>
  value === 'completed' ? 'completed' : 'pending';

const clampLimit = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_TODO_LIST_LIMIT;
  return Math.max(1, Math.min(MAX_TODO_LIST_LIMIT, Math.trunc(parsed)));
};

const normalizeTodoListRow = (row: TodoListRow): TodoListSummary => ({
  id: row.id,
  title: row.title,
  summary: row.summary ?? null,
  item_count: Number(row.item_count ?? 0),
  completed_count: Number(row.completed_count ?? 0),
  pending_count: Number(row.pending_count ?? 0),
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const normalizeTodoItemRow = (row: TodoItemRow): TodoItem => ({
  ...row,
  notes: row.notes ?? null,
  status: normalizeStatus(row.status),
  sort_order: Number(row.sort_order ?? 0),
  completed_at: row.completed_at ?? null,
});

const TODO_LIST_SUMMARY_SELECT = `
  SELECT
    l.id,
    l.title,
    l.summary,
    l.created_at,
    l.updated_at,
    COUNT(i.id) AS item_count,
    COALESCE(SUM(CASE WHEN i.status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_count,
    COALESCE(SUM(CASE WHEN i.status != 'completed' THEN 1 ELSE 0 END), 0) AS pending_count
  FROM todo_lists l
  LEFT JOIN todo_items i ON i.list_id = l.id
`;

const getTodoItemsForList = (listId: string): TodoItem[] => {
  const rows = getDb()
    .prepare(
      `
      SELECT *
      FROM todo_items
      WHERE list_id = ?
      ORDER BY sort_order ASC, created_at ASC
    `
    )
    .all(listId) as TodoItemRow[];

  return rows.map(normalizeTodoItemRow);
};

const getTodoListSummaryByClause = (
  clause: string,
  params: Record<string, unknown>
): TodoListSummary | null => {
  const row = getDb()
    .prepare(
      `
      ${TODO_LIST_SUMMARY_SELECT}
      ${clause}
      GROUP BY l.id
      ORDER BY l.updated_at DESC
      LIMIT 1
    `
    )
    .get(params) as TodoListRow | undefined;

  return row ? normalizeTodoListRow(row) : null;
};

const normalizeDraftItems = (items: TodoListItemDraft[]): TodoListItemDraft[] =>
  items.map(item => ({
    content: normalizeText(item.content),
    notes: normalizeOptionalText(item.notes),
    completed: Boolean(item.completed),
  }));

const resolveExistingTodoList = (params: { id?: string | null; title?: string | null }) => {
  const id = normalizeText(params.id);
  if (id) {
    return getTodoListSummaryByClause('WHERE l.id = @id', { id });
  }

  const title = normalizeText(params.title);
  if (title) {
    return getTodoListSummaryByClause('WHERE l.title_key = @titleKey', {
      titleKey: normalizeTitleKey(title),
    });
  }

  return null;
};

const insertTodoItems = (listId: string, items: TodoListItemDraft[], timestamp: string) => {
  const insertItem = getDb().prepare(`
    INSERT INTO todo_items (
      id,
      list_id,
      content,
      notes,
      status,
      sort_order,
      completed_at,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @list_id,
      @content,
      @notes,
      @status,
      @sort_order,
      @completed_at,
      @created_at,
      @updated_at
    )
  `);

  for (const [index, item] of items.entries()) {
    insertItem.run({
      id: createPrefixedId('todo_item'),
      list_id: listId,
      content: item.content,
      notes: item.notes ?? null,
      status: item.completed ? 'completed' : 'pending',
      sort_order: index,
      completed_at: item.completed ? timestamp : null,
      created_at: timestamp,
      updated_at: timestamp,
    });
  }
};

export const listTodoLists = (options?: { query?: string; limit?: number }): TodoListSummary[] => {
  const query = normalizeText(options?.query);
  const limit = clampLimit(options?.limit);

  const rows = getDb()
    .prepare(
      `
      ${TODO_LIST_SUMMARY_SELECT}
      ${query ? 'WHERE l.title LIKE @pattern OR COALESCE(l.summary, \'\') LIKE @pattern' : ''}
      GROUP BY l.id
      ORDER BY l.updated_at DESC
      LIMIT @limit
    `
    )
    .all(
      query
        ? {
            pattern: `%${query}%`,
            limit,
          }
        : { limit }
    ) as TodoListRow[];

  return rows.map(normalizeTodoListRow);
};

export const getTodoListById = (id: string): TodoList | null => {
  const summary = resolveExistingTodoList({ id });
  if (!summary) return null;
  return {
    ...summary,
    items: getTodoItemsForList(summary.id),
  };
};

export const getTodoListByTitle = (title: string): TodoList | null => {
  const summary = resolveExistingTodoList({ title });
  if (!summary) return null;
  return {
    ...summary,
    items: getTodoItemsForList(summary.id),
  };
};

export const writeTodoList = (input: {
  id?: string | null;
  title?: string | null;
  summary?: string | null;
  items?: TodoListItemDraft[];
}): { action: 'created' | 'updated'; list: TodoList } => {
  const normalizedId = normalizeText(input.id);
  const normalizedTitle = normalizeText(input.title);
  const summary = normalizeOptionalText(input.summary);
  const items = normalizeDraftItems(Array.isArray(input.items) ? input.items : []);

  if (!normalizedId && !normalizedTitle) {
    throw new Error('Todo list id or title is required');
  }
  if (items.some(item => !item.content)) {
    throw new Error('Todo item content is required');
  }

  const existing = resolveExistingTodoList({
    id: normalizedId || null,
    title: normalizedTitle || null,
  });
  const timestamp = nowIso();
  const nextTitle = normalizedTitle || existing?.title || '';
  const nextTitleKey = normalizeTitleKey(nextTitle);

  if (!nextTitle) {
    throw new Error('Todo list title is required');
  }

  const database = getDb();
  const transaction = database.transaction(() => {
    if (existing) {
      database
        .prepare(
          `
          UPDATE todo_lists
          SET title = @title,
              title_key = @title_key,
              summary = @summary,
              updated_at = @updated_at
          WHERE id = @id
        `
        )
        .run({
          id: existing.id,
          title: nextTitle,
          title_key: nextTitleKey,
          summary,
          updated_at: timestamp,
        });

      database.prepare('DELETE FROM todo_items WHERE list_id = ?').run(existing.id);
      insertTodoItems(existing.id, items, timestamp);
      return { action: 'updated' as const, listId: existing.id };
    }

    const listId = normalizedId || createPrefixedId('todo_list');
    database
      .prepare(
        `
        INSERT INTO todo_lists (
          id,
          title,
          title_key,
          summary,
          created_at,
          updated_at
        ) VALUES (
          @id,
          @title,
          @title_key,
          @summary,
          @created_at,
          @updated_at
        )
      `
      )
      .run({
        id: listId,
        title: nextTitle,
        title_key: nextTitleKey,
        summary,
        created_at: timestamp,
        updated_at: timestamp,
      });

    insertTodoItems(listId, items, timestamp);
    return { action: 'created' as const, listId };
  });

  try {
    const result = transaction();
    const list = getTodoListById(result.listId);
    if (!list) {
      throw new Error('Todo list was written but could not be reloaded');
    }
    return {
      action: result.action,
      list,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('todo_lists.title_key')) {
      throw new Error(`Todo list title "${nextTitle}" already exists`);
    }
    throw error;
  }
};

export const deleteTodoList = (params: { id?: string | null; title?: string | null }) => {
  const existing = resolveExistingTodoList(params);
  if (!existing) {
    return { deleted: false, listId: null, title: null };
  }

  const result = getDb().prepare('DELETE FROM todo_lists WHERE id = ?').run(existing.id);
  return {
    deleted: (result.changes || 0) > 0,
    listId: existing.id,
    title: existing.title,
  };
};
