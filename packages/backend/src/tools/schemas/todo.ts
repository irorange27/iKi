import { z } from 'zod';

import {
  DEFAULT_TODO_LIST_LIMIT,
  MAX_EXECUTION_TASK_PLAN_ITEMS,
  requireEitherField,
  toolCallDescriptionField,
  uiSchema,
} from './shared';

const todoPlanItemInputSchema = z.object({
  id: z.string().describe('Stable todo item id').optional(),
  text: z.string().min(1).describe('Todo item text'),
  status: z.enum(['pending', 'in_progress', 'completed']).describe('Todo item status').optional(),
});

const todoListLookupInputFields = {
  id: z.string().describe('Todo list id'),
  title: z.string().describe('Todo list title'),
};

const todoListItemInputSchema = z.object({
  content: z.string().min(1).describe('Todo item text'),
  notes: z.string().describe('Optional notes for the todo item').optional(),
  completed: z.boolean().describe('Whether the item is already completed').optional(),
});

// ---------------------------------------------------------------------------
// Todo tool (execution task planning) schemas
// ---------------------------------------------------------------------------

const todoToolInputShape = {
  items: z
    .array(todoPlanItemInputSchema)
    .max(MAX_EXECUTION_TASK_PLAN_ITEMS)
    .describe(
      `Current task-plan items in execution order. Keep the execution plan to ${MAX_EXECUTION_TASK_PLAN_ITEMS} broad steps or fewer by grouping related work.`
    )
    .optional()
    .default([]),
  description: toolCallDescriptionField,
};

export const TodoToolInputSchema = z.object(todoToolInputShape);
export const TodoToolInputSchemaUi = uiSchema(todoToolInputShape);

// ---------------------------------------------------------------------------
// Todo Lists schemas
// ---------------------------------------------------------------------------

const listTodoListsInputShape = {
  query: z.string().trim().describe('Optional search text for matching todo lists').optional(),
  limit: z
    .number()
    .int()
    .describe('Maximum number of todo lists to return')
    .optional()
    .default(DEFAULT_TODO_LIST_LIMIT),
  description: toolCallDescriptionField,
};

export const ListTodoListsInputSchema = z.object(listTodoListsInputShape);
export const ListTodoListsInputSchemaUi = uiSchema(listTodoListsInputShape);

const todoListLookupShape = {
  id: todoListLookupInputFields.id.optional(),
  title: todoListLookupInputFields.title.optional(),
  description: toolCallDescriptionField,
};

export const ReadTodoListInputSchema = z.object(todoListLookupShape).superRefine(requireEitherField('id', 'title'));
export const ReadTodoListInputSchemaUi = uiSchema(todoListLookupShape);

const writeTodoListInputShape = {
  id: todoListLookupInputFields.id.optional(),
  title: todoListLookupInputFields.title.optional(),
  summary: z.string().describe('Optional short summary of the todo list').optional(),
  items: z
    .array(todoListItemInputSchema)
    .describe('Todo items to store in order')
    .optional()
    .default([]),
  description: toolCallDescriptionField,
};

export const WriteTodoListInputSchema = z.object(writeTodoListInputShape).superRefine(requireEitherField('id', 'title'));
export const WriteTodoListInputSchemaUi = uiSchema(writeTodoListInputShape);

export const DeleteTodoListInputSchema = z.object(todoListLookupShape).superRefine(requireEitherField('id', 'title'));
export const DeleteTodoListInputSchemaUi = uiSchema(todoListLookupShape);
