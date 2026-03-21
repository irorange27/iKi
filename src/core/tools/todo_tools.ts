import { z } from 'zod';

import {
  deleteTodoList,
  getTodoListById,
  getTodoListByTitle,
  listTodoLists,
  writeTodoList,
} from '../db/todos';
import { BaseTool } from './base';
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
  name = 'list_todo_lists';
  displayName = 'List Todo Lists';
  type = 'function';
  autoAllowed = true;
  needsApproval = false;
  description =
    'List persistent todo lists with summary counts so you can find the right checklist to inspect or update.';

  paramSchema = ListTodoListsInputSchema;

  protected async handler(args: z.infer<typeof this.paramSchema>) {
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
  name = 'read_todo_list';
  displayName = 'Read Todo List';
  type = 'function';
  autoAllowed = true;
  needsApproval = false;
  description = 'Read a persistent todo list and all of its items by id or title.';

  paramSchema = ReadTodoListInputSchema;

  protected async handler(args: z.infer<typeof this.paramSchema>) {
    const list = resolveTodoList(args);
    if (!list) {
      throw new Error('Todo list not found');
    }

    return { list };
  }
}

export class WriteTodoListTool extends BaseTool {
  name = 'write_todo_list';
  displayName = 'Write Todo List';
  type = 'function';
  autoAllowed = true;
  needsApproval = true;
  description =
    'Create or replace a persistent structured todo list. Prefer this over writing ad hoc todo files when the user wants a maintained checklist.';

  paramSchema = WriteTodoListInputSchema;

  protected async handler(args: z.infer<typeof this.paramSchema>) {
    return writeTodoList({
      id: args.id,
      title: args.title,
      summary: args.summary,
      items: args.items,
    });
  }
}

export class DeleteTodoListTool extends BaseTool {
  name = 'delete_todo_list';
  displayName = 'Delete Todo List';
  type = 'function';
  needsApproval = true;
  description = 'Delete a persistent todo list by id or title.';

  paramSchema = DeleteTodoListInputSchema;

  protected async handler(args: z.infer<typeof this.paramSchema>) {
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
