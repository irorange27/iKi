import { z } from 'zod';
import { requireEitherField, toolCallDescriptionField, uiSchema } from '@iki/core/tools/schemas';
import { DEFAULT_PROACTIVE_TASK_LIST_LIMIT, SAFE_PROACTIVE_TASK_TOOLS } from '../types/tasks';
import { DEFAULT_AWAITER_LIST_LIMIT } from '../types/awaiters';

// ---------------------------------------------------------------------------
// App-level constants
// ---------------------------------------------------------------------------

export const DEFAULT_PERSONAL_SKILL_LIST_LIMIT = 20;
export const MAX_PERSONAL_SKILL_LIST_LIMIT = 100;
export const DEFAULT_PERSONAL_SKILL_READ_MAX_CHARS = 20000;
export const MIN_PERSONAL_SKILL_READ_MAX_CHARS = 500;
export const MAX_PERSONAL_SKILL_READ_MAX_CHARS = 120000;
export const DEFAULT_TODO_LIST_LIMIT = 20;
export const MAX_TODO_LIST_LIMIT = 100;

// ---------------------------------------------------------------------------
// App-level input field definitions
// ---------------------------------------------------------------------------

const personalSkillIdInputFields = {
  id: z
    .string()
    .describe('Exact personal skill id, for example "user:planner" or "user:team/planner"'),
};

const todoListLookupInputFields = {
  id: z.string().describe('Todo list id'),
  title: z.string().describe('Todo list title'),
};

const proactiveTaskLookupInputFields = {
  id: z.string().describe('Proactive task id'),
  name: z.string().describe('Exact proactive task name'),
};

const awaiterLookupInputFields = {
  id: z.string().describe('Awaiter id'),
  title: z.string().describe('Exact awaiter title'),
};

const todoListItemInputSchema = z.object({
  content: z.string().min(1).describe('Todo item text'),
  notes: z.string().describe('Optional notes for the todo item').optional(),
  completed: z.boolean().describe('Whether the item is already completed').optional(),
});

const proactiveTaskSafeToolSchema = z.enum(SAFE_PROACTIVE_TASK_TOOLS);

const proactiveTaskScheduleBaseFields = {
  timezone: z
    .string()
    .trim()
    .describe('Optional IANA timezone such as "Asia/Shanghai"')
    .optional(),
};

const proactiveTaskScheduleInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('interval'),
    intervalMinutes: z
      .number()
      .int()
      .min(1)
      .describe('Run every N minutes'),
  }),
  z.object({
    kind: z.literal('cron'),
    cronExpression: z
      .string()
      .trim()
      .min(1)
      .describe('Five-field cron expression'),
    ...proactiveTaskScheduleBaseFields,
  }),
  z.object({
    kind: z.literal('daily'),
    time: z
      .string()
      .trim()
      .regex(/^([01]?\d|2[0-3]):([0-5]\d)$/, 'Expected HH:MM in 24-hour time')
      .describe('Local wall-clock time in HH:MM 24-hour format'),
    ...proactiveTaskScheduleBaseFields,
  }),
  z.object({
    kind: z.literal('weekly'),
    daysOfWeek: z
      .array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']))
      .min(1)
      .describe('One or more weekdays for the recurring run'),
    time: z
      .string()
      .trim()
      .regex(/^([01]?\d|2[0-3]):([0-5]\d)$/, 'Expected HH:MM in 24-hour time')
      .describe('Local wall-clock time in HH:MM 24-hour format'),
    ...proactiveTaskScheduleBaseFields,
  }),
]);

const awaiterTriggerInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('time_at'),
    at: z
      .string()
      .trim()
      .min(1)
      .describe('Future wake time as an ISO 8601 timestamp'),
  }),
  z.object({
    kind: z.literal('time_after'),
    delayMinutes: z
      .number()
      .int()
      .min(1)
      .describe('Wake after N minutes from now'),
  }),
]);

// ---------------------------------------------------------------------------
// Personal Skills schemas
// ---------------------------------------------------------------------------

const listPersonalSkillsInputShape = {
  query: z.string().trim().describe('Optional search text for matching personal skills').optional(),
  limit: z
    .number()
    .int()
    .describe('Maximum number of personal skills to return')
    .optional()
    .default(DEFAULT_PERSONAL_SKILL_LIST_LIMIT),
  description: toolCallDescriptionField,
};

export const ListPersonalSkillsInputSchema = z.object(listPersonalSkillsInputShape);
export const ListPersonalSkillsInputSchemaUi = uiSchema(listPersonalSkillsInputShape);

const readPersonalSkillInputShape = {
  id: personalSkillIdInputFields.id,
  maxChars: z
    .number()
    .int()
    .describe('Maximum number of characters to return from the personal skill file')
    .optional()
    .default(DEFAULT_PERSONAL_SKILL_READ_MAX_CHARS),
  description: toolCallDescriptionField,
};

export const ReadPersonalSkillInputSchema = z.object(readPersonalSkillInputShape);
export const ReadPersonalSkillInputSchemaUi = uiSchema(readPersonalSkillInputShape);

const writePersonalSkillInputShape = {
  id: personalSkillIdInputFields.id,
  skillName: z
    .string()
    .trim()
    .describe('Optional display name to store in the skill frontmatter')
    .optional(),
  skillDescription: z
    .string()
    .trim()
    .describe('Optional short summary to store in the skill frontmatter')
    .optional(),
  instructions: z
    .string()
    .trim()
    .min(1)
    .describe('Markdown instructions body to store below the generated frontmatter'),
  description: toolCallDescriptionField,
};

export const WritePersonalSkillInputSchema = z.object(writePersonalSkillInputShape);
export const WritePersonalSkillInputSchemaUi = uiSchema(writePersonalSkillInputShape);

export const DeletePersonalSkillInputSchema = z.object({
  id: personalSkillIdInputFields.id,
  description: toolCallDescriptionField,
});

const deletePersonalSkillInputShape = {
  id: personalSkillIdInputFields.id,
  description: toolCallDescriptionField,
};

export const DeletePersonalSkillInputSchemaUi = uiSchema(deletePersonalSkillInputShape);

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

// ---------------------------------------------------------------------------
// Proactive Tasks schemas
// ---------------------------------------------------------------------------

const listProactiveTasksInputShape = {
  query: z.string().trim().describe('Optional search text for matching proactive tasks').optional(),
  limit: z
    .number()
    .int()
    .describe('Maximum number of proactive tasks to return')
    .optional()
    .default(DEFAULT_PROACTIVE_TASK_LIST_LIMIT),
  description: toolCallDescriptionField,
};

export const ListProactiveTasksInputSchema = z.object(listProactiveTasksInputShape);
export const ListProactiveTasksInputSchemaUi = uiSchema(listProactiveTasksInputShape);

const proactiveTaskLookupShape = {
  id: proactiveTaskLookupInputFields.id.optional(),
  name: proactiveTaskLookupInputFields.name.optional(),
  description: toolCallDescriptionField,
};

export const ReadProactiveTaskInputSchema = z.object(proactiveTaskLookupShape).superRefine(requireEitherField('id', 'name'));
export const ReadProactiveTaskInputSchemaUi = uiSchema(proactiveTaskLookupShape);

const writeProactiveTaskInputShape = {
  action: z
    .enum(['create', 'update'])
    .describe('Create a new proactive task or update an existing one'),
  id: proactiveTaskLookupInputFields.id.optional(),
  currentName: proactiveTaskLookupInputFields.name
    .describe('Exact existing task name when updating by name')
    .optional(),
  name: proactiveTaskLookupInputFields.name
    .describe('Display name for the task')
    .optional(),
  prompt: z
    .string()
    .trim()
    .describe('Instruction the scheduled task should execute on each run')
    .optional(),
  schedule: proactiveTaskScheduleInputSchema.describe(
    'Recurring schedule. Use daily/weekly presets instead of raw cron when possible.'
  ).optional(),
  enabled: z.boolean().describe('Whether the task should be enabled after this write').optional(),
  notify: z
    .boolean()
    .describe('Whether the desktop app should show completion/failure notifications')
    .optional(),
  delivery: z
    .enum(['current_thread', 'dedicated_thread', 'specific_thread'])
    .describe('Where scheduled messages should be posted')
    .optional(),
  threadId: z
    .string()
    .trim()
    .describe('Explicit thread id when delivery is specific_thread')
    .optional(),
  providerType: z
    .string()
    .trim()
    .describe('Optional provider type override; defaults to the current chat model')
    .optional(),
  providerId: z
    .string()
    .trim()
    .describe('Optional provider id override; defaults to the current chat provider instance')
    .optional(),
  model: z
    .string()
    .trim()
    .describe('Optional model override; defaults to the current chat model')
    .optional(),
  toolMode: z
    .enum(['auto', 'manual', 'disabled'])
    .describe('How the scheduled task may use safe tools when it runs')
    .optional(),
  tools: z
    .array(proactiveTaskSafeToolSchema)
    .describe('Safe tool allowlist when toolMode is manual')
    .optional(),
  description: toolCallDescriptionField,
};

export const WriteProactiveTaskInputSchema = z.object(writeProactiveTaskInputShape).superRefine((value, ctx) => {
    const hasId = typeof value.id === 'string' && value.id.trim().length > 0;
    const hasCurrentName = typeof value.currentName === 'string' && value.currentName.trim().length > 0;
    const hasName = typeof value.name === 'string' && value.name.trim().length > 0;
    const hasPrompt = typeof value.prompt === 'string' && value.prompt.trim().length > 0;

    if (value.action === 'create') {
      if (!hasName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['name'],
          message: 'name is required when action=create',
        });
      }
      if (!hasPrompt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['prompt'],
          message: 'prompt is required when action=create',
        });
      }
      if (!value.schedule) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['schedule'],
          message: 'schedule is required when action=create',
        });
      }
    }

    if (value.action === 'update' && !hasId && !hasCurrentName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['id'],
        message: 'Either id or currentName is required when action=update',
      });
    }

    if (value.delivery === 'specific_thread') {
      const hasThreadId = typeof value.threadId === 'string' && value.threadId.trim().length > 0;
      if (!hasThreadId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['threadId'],
          message: 'threadId is required when delivery=specific_thread',
        });
      }
    }

    if (value.toolMode === 'manual' && (!value.tools || value.tools.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tools'],
        message: 'tools are required when toolMode=manual',
      });
    }
  });

export const WriteProactiveTaskInputSchemaUi = uiSchema(writeProactiveTaskInputShape);

export const DeleteProactiveTaskInputSchema = z.object(proactiveTaskLookupShape).superRefine(requireEitherField('id', 'name'));
export const DeleteProactiveTaskInputSchemaUi = uiSchema(proactiveTaskLookupShape);

// ---------------------------------------------------------------------------
// Awaiters schemas
// ---------------------------------------------------------------------------

const listAwaitersInputShape = {
  query: z.string().trim().describe('Optional search text for matching awaiters').optional(),
  limit: z
    .number()
    .int()
    .describe('Maximum number of awaiters to return')
    .optional()
    .default(DEFAULT_AWAITER_LIST_LIMIT),
  description: toolCallDescriptionField,
};

export const ListAwaitersInputSchema = z.object(listAwaitersInputShape);
export const ListAwaitersInputSchemaUi = uiSchema(listAwaitersInputShape);

const awaiterLookupShape = {
  id: awaiterLookupInputFields.id.optional(),
  title: awaiterLookupInputFields.title.optional(),
  description: toolCallDescriptionField,
};

export const ReadAwaiterInputSchema = z.object(awaiterLookupShape).superRefine(requireEitherField('id', 'title'));
export const ReadAwaiterInputSchemaUi = uiSchema(awaiterLookupShape);

const writeAwaiterInputShape = {
  action: z.enum(['create', 'update']).describe('Create a new awaiter or update an existing one'),
  id: awaiterLookupInputFields.id.optional(),
  currentTitle: awaiterLookupInputFields.title
    .describe('Exact existing awaiter title when updating by title')
    .optional(),
  title: awaiterLookupInputFields.title.describe('Display title for the awaiter').optional(),
  instruction: z
    .string()
    .trim()
    .describe('Instruction the future wake should execute when it fires')
    .optional(),
  trigger: awaiterTriggerInputSchema
    .describe('One-shot wake trigger. Phase 1 supports only time-based triggers.')
    .optional(),
  notify: z
    .boolean()
    .describe('Whether the desktop app should show a completion/failure notification')
    .optional(),
  threadId: z
    .string()
    .trim()
    .describe('Optional thread id override; defaults to the current thread')
    .optional(),
  providerType: z
    .string()
    .trim()
    .describe('Optional provider type override; defaults to the current chat model')
    .optional(),
  providerId: z
    .string()
    .trim()
    .describe('Optional provider id override; defaults to the current chat provider instance')
    .optional(),
  model: z
    .string()
    .trim()
    .describe('Optional model override; defaults to the current chat model')
    .optional(),
  description: toolCallDescriptionField,
};

export const WriteAwaiterInputSchema = z.object(writeAwaiterInputShape).superRefine((value, ctx) => {
    const hasId = typeof value.id === 'string' && value.id.trim().length > 0;
    const hasCurrentTitle =
      typeof value.currentTitle === 'string' && value.currentTitle.trim().length > 0;
    const hasTitle = typeof value.title === 'string' && value.title.trim().length > 0;
    const hasInstruction =
      typeof value.instruction === 'string' && value.instruction.trim().length > 0;

    if (value.action === 'create') {
      if (!hasTitle) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['title'],
          message: 'title is required when action=create',
        });
      }
      if (!hasInstruction) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['instruction'],
          message: 'instruction is required when action=create',
        });
      }
      if (!value.trigger) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['trigger'],
          message: 'trigger is required when action=create',
        });
      }
    }

    if (value.action === 'update' && !hasId && !hasCurrentTitle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['id'],
        message: 'Either id or currentTitle is required when action=update',
      });
    }
  });

export const WriteAwaiterInputSchemaUi = uiSchema(writeAwaiterInputShape);

export const DeleteAwaiterInputSchema = z.object(awaiterLookupShape).superRefine(requireEitherField('id', 'title'));
export const DeleteAwaiterInputSchemaUi = uiSchema(awaiterLookupShape);

// ---------------------------------------------------------------------------
// App-level output schemas
// ---------------------------------------------------------------------------

const PersonalSkillSummaryOutputSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    source: z.literal('user').optional(),
    path: z.string().optional(),
  })
  .passthrough();

export const ListPersonalSkillsOutputSchema = z
  .object({
    rootPath: z.string().optional(),
    skills: z.array(PersonalSkillSummaryOutputSchema).optional(),
    resultCount: z.number().optional(),
  })
  .passthrough();

export const ReadPersonalSkillOutputSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    source: z.literal('user').optional(),
    filePath: z.string().optional(),
    content: z.string().optional(),
    truncated: z.boolean().optional(),
  })
  .passthrough();

export const WritePersonalSkillOutputSchema = z
  .object({
    action: z.enum(['created', 'updated']).optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    source: z.literal('user').optional(),
    filePath: z.string().optional(),
    content: z.string().optional(),
  })
  .passthrough();

export const DeletePersonalSkillOutputSchema = z
  .object({
    deleted: z.boolean().optional(),
    id: z.string().optional(),
    filePath: z.string().optional(),
  })
  .passthrough();

const TodoItemOutputSchema = z
  .object({
    id: z.string().optional(),
    list_id: z.string().optional(),
    content: z.string().optional(),
    notes: z.string().nullable().optional(),
    status: z.enum(['pending', 'completed']).optional(),
    sort_order: z.number().optional(),
    completed_at: z.string().nullable().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();

const TodoListSummaryOutputSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    summary: z.string().nullable().optional(),
    item_count: z.number().optional(),
    completed_count: z.number().optional(),
    pending_count: z.number().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();

const TodoListOutputSchema = TodoListSummaryOutputSchema.extend({
  items: z.array(TodoItemOutputSchema).optional(),
}).passthrough();

export const ListTodoListsOutputSchema = z
  .object({
    lists: z.array(TodoListSummaryOutputSchema).optional(),
    resultCount: z.number().optional(),
  })
  .passthrough();

export const ReadTodoListOutputSchema = z
  .object({
    list: TodoListOutputSchema.optional(),
  })
  .passthrough();

export const WriteTodoListOutputSchema = z
  .object({
    action: z.enum(['created', 'updated']).optional(),
    list: TodoListOutputSchema.optional(),
  })
  .passthrough();

export const DeleteTodoListOutputSchema = z
  .object({
    deleted: z.boolean().optional(),
    listId: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
  })
  .passthrough();

const ProactiveTaskRecordOutputSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    prompt: z.string().optional(),
    schedule_type: z.enum(['interval', 'cron']).optional(),
    interval_minutes: z.number().optional(),
    cron_expression: z.string().nullable().optional(),
    schedule_timezone: z.string().nullable().optional(),
    schedule_summary: z.string().optional(),
    enabled: z.boolean().optional(),
    provider_type: z.string().optional(),
    provider_id: z.string().nullable().optional(),
    model: z.string().optional(),
    tool_mode: z.enum(['auto', 'manual', 'disabled']).optional(),
    tools: z.array(z.string()).optional(),
    tool_summary: z.string().optional(),
    thread_id: z.string().nullable().optional(),
    notify: z.boolean().optional(),
    last_run_at: z.string().nullable().optional(),
    next_run_at: z.string().nullable().optional(),
    last_status: z.enum(['idle', 'running', 'success', 'error']).nullable().optional(),
    last_output: z.string().nullable().optional(),
    last_error: z.string().nullable().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();

export const ListProactiveTasksOutputSchema = z
  .object({
    tasks: z.array(ProactiveTaskRecordOutputSchema).optional(),
    resultCount: z.number().optional(),
  })
  .passthrough();

export const ReadProactiveTaskOutputSchema = z
  .object({
    task: ProactiveTaskRecordOutputSchema.nullable().optional(),
  })
  .passthrough();

export const WriteProactiveTaskOutputSchema = z
  .object({
    action: z.enum(['created', 'updated']).optional(),
    task: ProactiveTaskRecordOutputSchema.optional(),
  })
  .passthrough();

export const DeleteProactiveTaskOutputSchema = z
  .object({
    deleted: z.boolean().optional(),
    taskId: z.string().nullable().optional(),
    taskName: z.string().nullable().optional(),
  })
  .passthrough();

const AwaiterTriggerOutputSchema = z
  .object({
    kind: z.enum(['time_at', 'time_after']).optional(),
    at: z.string().optional(),
    delay_minutes: z.number().optional(),
  })
  .passthrough();

const AwaiterRecordOutputSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    instruction: z.string().optional(),
    status: z
      .enum(['armed', 'waking', 'completed', 'cancelled', 'failed', 'expired'])
      .optional(),
    thread_id: z.string().optional(),
    origin_run_id: z.string().nullable().optional(),
    origin_checkpoint_id: z.string().nullable().optional(),
    trigger_kind: z.enum(['time_at', 'time_after']).optional(),
    trigger_spec: AwaiterTriggerOutputSchema.nullable().optional(),
    trigger_summary: z.string().optional(),
    delivery_mode: z.enum(['thread']).optional(),
    notify: z.boolean().optional(),
    provider_type: z.string().optional(),
    provider_id: z.string().nullable().optional(),
    model: z.string().optional(),
    next_wake_at: z.string().nullable().optional(),
    last_wake_at: z.string().nullable().optional(),
    last_error: z.string().nullable().optional(),
    expires_at: z.string().nullable().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();

export const ListAwaitersOutputSchema = z
  .object({
    awaiters: z.array(AwaiterRecordOutputSchema).optional(),
    resultCount: z.number().optional(),
  })
  .passthrough();

export const ReadAwaiterOutputSchema = z
  .object({
    awaiter: AwaiterRecordOutputSchema.nullable().optional(),
  })
  .passthrough();

export const WriteAwaiterOutputSchema = z
  .object({
    action: z.enum(['created', 'updated']).optional(),
    awaiter: AwaiterRecordOutputSchema.optional(),
  })
  .passthrough();

export const DeleteAwaiterOutputSchema = z
  .object({
    deleted: z.boolean().optional(),
    awaiterId: z.string().nullable().optional(),
    awaiterTitle: z.string().nullable().optional(),
  })
  .passthrough();
