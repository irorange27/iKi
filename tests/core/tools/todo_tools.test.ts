import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/db/todos', () => ({
  deleteTodoList: vi.fn(),
  getTodoListById: vi.fn(),
  getTodoListByTitle: vi.fn(),
  listTodoLists: vi.fn(),
  writeTodoList: vi.fn(),
}));

import * as todoDb from '../../../src/core/db/todos';
import {
  DeleteTodoListTool,
  ListTodoListsTool,
  ReadTodoListTool,
  WriteTodoListTool,
} from '../../../src/core/tools/todo_tools';

describe('todo tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists todo lists and returns the result count', async () => {
    vi.mocked(todoDb.listTodoLists).mockReturnValue([
      {
        id: 'todo_1',
        title: 'Today',
        summary: null,
        item_count: 2,
        completed_count: 1,
        pending_count: 1,
        created_at: '2026-03-20T10:00:00.000Z',
        updated_at: '2026-03-20T10:00:00.000Z',
      },
    ]);

    const tool = new ListTodoListsTool();
    const result = await tool.execute({ query: 'today', limit: 5 });

    expect(todoDb.listTodoLists).toHaveBeenCalledWith({ query: 'today', limit: 5 });
    expect(result).toEqual({
      lists: [expect.objectContaining({ title: 'Today' })],
      resultCount: 1,
    });
  });

  it('reads a todo list by title', async () => {
    vi.mocked(todoDb.getTodoListByTitle).mockReturnValue({
      id: 'todo_2',
      title: 'Inbox',
      summary: null,
      item_count: 1,
      completed_count: 0,
      pending_count: 1,
      created_at: '2026-03-20T10:00:00.000Z',
      updated_at: '2026-03-20T10:00:00.000Z',
      items: [],
    });

    const tool = new ReadTodoListTool();
    const result = await tool.execute({ title: 'Inbox' });

    expect(todoDb.getTodoListByTitle).toHaveBeenCalledWith('Inbox');
    expect(result).toEqual({
      list: expect.objectContaining({ title: 'Inbox' }),
    });
  });

  it('forwards write requests to the todo db helper', async () => {
    vi.mocked(todoDb.writeTodoList).mockReturnValue({
      action: 'created',
      list: {
        id: 'todo_3',
        title: 'Today',
        summary: 'Plan',
        item_count: 1,
        completed_count: 0,
        pending_count: 1,
        created_at: '2026-03-20T10:00:00.000Z',
        updated_at: '2026-03-20T10:00:00.000Z',
        items: [],
      },
    });

    const tool = new WriteTodoListTool();
    const result = await tool.execute({
      title: 'Today',
      summary: 'Plan',
      items: [{ content: 'Ship feature' }],
    });

    expect(todoDb.writeTodoList).toHaveBeenCalledWith({
      id: undefined,
      title: 'Today',
      summary: 'Plan',
      items: [{ content: 'Ship feature' }],
    });
    expect(result).toEqual({
      action: 'created',
      list: expect.objectContaining({ title: 'Today' }),
    });
  });

  it('throws when delete does not find a todo list', async () => {
    vi.mocked(todoDb.deleteTodoList).mockReturnValue({
      deleted: false,
      listId: null,
      title: null,
    });

    const tool = new DeleteTodoListTool();
    await expect(tool.execute({ title: 'Missing' })).rejects.toThrow(/not found/i);
  });

  it('publishes auto-mode metadata for list/read/write todo tools but not delete', () => {
    expect(new ListTodoListsTool().toAgentTool().autoAllowed).toBe(true);
    expect(new ReadTodoListTool().toAgentTool().autoAllowed).toBe(true);
    expect(new WriteTodoListTool().toAgentTool().autoAllowed).toBe(true);
    expect(new DeleteTodoListTool().toAgentTool().autoAllowed).toBe(false);
  });
});
