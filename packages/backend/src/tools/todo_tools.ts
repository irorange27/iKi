import { z } from 'zod';

import {
  deleteTodoList,
  getTodoListById,
  getTodoListByTitle,
  listTodoLists,
  writeTodoList,
} from '../db/todos';
import { BaseTool } from '@iki/backend/tools/base';
import {
  DEFAULT_TODO_LIST_LIMIT,
  DeleteTodoListInputSchema,
  ListTodoListsInputSchema,
  MAX_TODO_LIST_LIMIT,
  ReadTodoListInputSchema,
  WriteTodoListInputSchema,
} from './schemas';

const clampLimit = (value: number): number =>
  Math.max(1, Math.min(MAX_TODO_LIST_LIMIT, Math.trunc(value || DEFAULT_TODO_LIST_LIMIT)));

const resolveTodoList = (args: { id?: string; title?: string }) => {
  const byId = typeof args.id === 'string' ? args.id.trim() : '';
  if (byId) return getTodoListById(byId);

  const byTitle = typeof args.title === 'string' ? args.title.trim() : '';
  if (byTitle) return getTodoListByTitle(byTitle);

  return null;
};

export class ListTodoListsTool extends BaseTool {
  override name = 'list_todo_lists';
  override displayName = 'List Todo Lists';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = false;
  override description =
    'List persistent todo lists with summary counts so you can find the right checklist to inspect or update.';

  override paramSchema = ListTodoListsInputSchema;

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const lists = listTodoLists({
      query: args.query,
      limit: clampLimit(args.limit || DEFAULT_TODO_LIST_LIMIT),
    });

    return {
      lists,
      resultCount: lists.length,
    };
  }
}

export class ReadTodoListTool extends BaseTool {
  override name = 'read_todo_list';
  override displayName = 'Read Todo List';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = false;
  override description = 'Read a persistent todo list and all of its items by id or title.';

  override paramSchema = ReadTodoListInputSchema;

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const list = resolveTodoList(args);
    if (!list) {
      throw new Error('Todo list not found');
    }

    return { list };
  }
}

export class WriteTodoListTool extends BaseTool {
  override name = 'write_todo_list';
  override displayName = 'Write Todo List';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = true;
  override description =
    'Create or replace a persistent structured todo list. Prefer this over writing ad hoc todo files when the user wants a maintained checklist.';

  override paramSchema = WriteTodoListInputSchema;

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    return writeTodoList({
      id: args.id,
      title: args.title,
      summary: args.summary,
      items: args.items,
    });
  }
}

export class DeleteTodoListTool extends BaseTool {
  override name = 'delete_todo_list';
  override displayName = 'Delete Todo List';
  override type = 'function';
  override needsApproval = true;
  override description = 'Delete a persistent todo list by id or title.';

  override paramSchema = DeleteTodoListInputSchema;

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const result = deleteTodoList({
      id: args.id,
      title: args.title,
    });

    if (!result.deleted) {
      throw new Error('Todo list not found');
    }

    return result;
  }
}
