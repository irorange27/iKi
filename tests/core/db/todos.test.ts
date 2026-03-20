import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock('../../../src/core/db/database', () => ({
  getDb: getDbMock,
}));

type TodoListState = {
  list: null | {
    id: string;
    title: string;
    title_key: string;
    summary: string | null;
    created_at: string;
    updated_at: string;
  };
  items: Array<{
    id: string;
    list_id: string;
    content: string;
    notes: string | null;
    status: string;
    sort_order: number;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
  }>;
};

const buildSummaryRow = (state: TodoListState) => {
  if (!state.list) return undefined;
  const items = state.items.filter(item => item.list_id === state.list?.id);
  const completed = items.filter(item => item.status === 'completed').length;

  return {
    id: state.list.id,
    title: state.list.title,
    summary: state.list.summary,
    created_at: state.list.created_at,
    updated_at: state.list.updated_at,
    item_count: items.length,
    completed_count: completed,
    pending_count: items.length - completed,
  };
};

const createFakeDb = (initial?: Partial<TodoListState>) => {
  const state: TodoListState = {
    list: initial?.list ?? null,
    items: initial?.items ?? [],
  };

  const prepare = vi.fn((sql: string) => {
    if (sql.includes('FROM todo_lists l')) {
      return {
        get: vi.fn((params: Record<string, unknown>) => {
          const summary = buildSummaryRow(state);
          if (!summary) return undefined;
          if (typeof params.id === 'string' && params.id === summary.id) return summary;
          if (
            typeof params.titleKey === 'string' &&
            params.titleKey === state.list?.title_key
          ) {
            return summary;
          }
          return undefined;
        }),
        all: vi.fn((params?: Record<string, unknown>) => {
          const summary = buildSummaryRow(state);
          if (!summary) return [];
          if (params?.pattern) {
            const pattern = String(params.pattern).replaceAll('%', '').toLowerCase();
            const haystack = `${summary.title} ${summary.summary || ''}`.toLowerCase();
            return haystack.includes(pattern) ? [summary] : [];
          }
          return [summary];
        }),
      };
    }

    if (sql.includes('SELECT *') && sql.includes('FROM todo_items')) {
      return {
        all: vi.fn((listId: string) =>
          state.items.filter(item => item.list_id === listId).sort((a, b) => a.sort_order - b.sort_order)
        ),
      };
    }

    if (sql.includes('INSERT INTO todo_lists')) {
      return {
        run: vi.fn((params: TodoListState['list']) => {
          state.list = { ...params };
          return { changes: 1 };
        }),
      };
    }

    if (sql.includes('UPDATE todo_lists')) {
      return {
        run: vi.fn((params: Record<string, unknown>) => {
          if (!state.list) return { changes: 0 };
          state.list = {
            ...state.list,
            title: String(params.title),
            title_key: String(params.title_key),
            summary: (params.summary as string | null) ?? null,
            updated_at: String(params.updated_at),
          };
          return { changes: 1 };
        }),
      };
    }

    if (sql.includes('DELETE FROM todo_items')) {
      return {
        run: vi.fn((listId: string) => {
          state.items = state.items.filter(item => item.list_id !== listId);
          return { changes: 1 };
        }),
      };
    }

    if (sql.includes('INSERT INTO todo_items')) {
      return {
        run: vi.fn((params: TodoListState['items'][number]) => {
          state.items.push({ ...params });
          return { changes: 1 };
        }),
      };
    }

    if (sql.includes('DELETE FROM todo_lists')) {
      return {
        run: vi.fn((id: string) => {
          const changed = state.list?.id === id ? 1 : 0;
          if (changed) {
            state.list = null;
            state.items = [];
          }
          return { changes: changed };
        }),
      };
    }

    throw new Error(`Unhandled SQL in fake db: ${sql}`);
  });

  const db = {
    prepare,
    transaction: (fn: () => unknown) => () => fn(),
  };

  getDbMock.mockReturnValue(db as never);
  return { state, prepare };
};

describe('todo db helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a todo list and preserves ordered item state', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T10:00:00.000Z'));
    createFakeDb();

    const { writeTodoList } = await import('../../../src/core/db/todos');
    const result = writeTodoList({
      title: 'Today',
      summary: 'Focus on shipping',
      items: [
        { content: 'Implement ToDoList', completed: false },
        { content: 'Write tests', completed: true, notes: 'Cover DB + tools' },
      ],
    });

    expect(result.action).toBe('created');
    expect(result.list.title).toBe('Today');
    expect(result.list.summary).toBe('Focus on shipping');
    expect(result.list.item_count).toBe(2);
    expect(result.list.completed_count).toBe(1);
    expect(result.list.pending_count).toBe(1);
    expect(result.list.items.map(item => item.content)).toEqual([
      'Implement ToDoList',
      'Write tests',
    ]);
    expect(result.list.items[1]?.status).toBe('completed');
    expect(result.list.items[1]?.notes).toBe('Cover DB + tools');
  });

  it('updates an existing title-matched list and replaces prior items', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T11:00:00.000Z'));
    createFakeDb({
      list: {
        id: 'todo_list_1',
        title: 'Today',
        title_key: 'today',
        summary: 'Old',
        created_at: '2026-03-20T09:00:00.000Z',
        updated_at: '2026-03-20T09:00:00.000Z',
      },
      items: [
        {
          id: 'todo_item_1',
          list_id: 'todo_list_1',
          content: 'Old task',
          notes: null,
          status: 'pending',
          sort_order: 0,
          completed_at: null,
          created_at: '2026-03-20T09:00:00.000Z',
          updated_at: '2026-03-20T09:00:00.000Z',
        },
      ],
    });

    const { writeTodoList } = await import('../../../src/core/db/todos');
    const result = writeTodoList({
      title: 'Today',
      summary: 'New',
      items: [{ content: 'New task', completed: true }],
    });

    expect(result.action).toBe('updated');
    expect(result.list.id).toBe('todo_list_1');
    expect(result.list.summary).toBe('New');
    expect(result.list.items).toHaveLength(1);
    expect(result.list.items[0]?.content).toBe('New task');
    expect(result.list.items[0]?.status).toBe('completed');
  });

  it('lists and deletes todo lists by title', async () => {
    createFakeDb({
      list: {
        id: 'todo_list_2',
        title: 'Inbox',
        title_key: 'inbox',
        summary: 'Captured tasks',
        created_at: '2026-03-20T08:00:00.000Z',
        updated_at: '2026-03-20T08:30:00.000Z',
      },
      items: [],
    });

    const { deleteTodoList, listTodoLists } = await import('../../../src/core/db/todos');
    expect(listTodoLists({ query: 'inbox' })).toEqual([
      expect.objectContaining({
        id: 'todo_list_2',
        title: 'Inbox',
      }),
    ]);

    expect(deleteTodoList({ title: 'Inbox' })).toEqual({
      deleted: true,
      listId: 'todo_list_2',
      title: 'Inbox',
    });
  });
});
