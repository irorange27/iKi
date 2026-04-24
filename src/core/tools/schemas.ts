import { z } from 'zod';
import { DEFAULT_PROACTIVE_TASK_LIST_LIMIT, SAFE_PROACTIVE_TASK_TOOLS } from '../../shared/types/tasks';
import { DEFAULT_AWAITER_LIST_LIMIT } from '../../shared/types/awaiters';
import { MAX_EXECUTION_TASK_PLAN_ITEMS } from '../../shared/types/task_plan';

// Renderer tool-payload parsing imports this module via shared/chat/tool_payloads.
// Keep this file limited to shared/browser-safe dependencies so the renderer bundle never pulls
// Node-only core runtime modules into Vite.
export const DEFAULT_SEARCH_RESULT_LIMIT = 5;
export const MAX_SEARCH_RESULT_LIMIT = 10;
export const DEFAULT_FETCH_MAX_CHARS = 12000;
export const MIN_FETCH_MAX_CHARS = 500;
export const MAX_FETCH_MAX_CHARS = 80000;
export const DEFAULT_SHELL_TIMEOUT_MS = 30000;
export const DEFAULT_FILE_ENCODING = 'utf-8';
export const MAX_EDIT_FILE_OPERATIONS = 20;
export const DEFAULT_TODO_LIST_LIMIT = 20;
export const MAX_TODO_LIST_LIMIT = 100;
export const DEFAULT_PERSONAL_SKILL_LIST_LIMIT = 20;
export const MAX_PERSONAL_SKILL_LIST_LIMIT = 100;
export const DEFAULT_PERSONAL_SKILL_READ_MAX_CHARS = 20000;
export const MIN_PERSONAL_SKILL_READ_MAX_CHARS = 500;
export const MAX_PERSONAL_SKILL_READ_MAX_CHARS = 120000;
export const DEFAULT_AGENT_MAX_ITERATIONS = 8;
export const MAX_AGENT_MAX_ITERATIONS = 12;
export const MAX_AGENT_TOOL_SELECTION = 12;

const toolCallDescriptionField = z
  .string()
  .trim()
  .max(160)
  .describe('One short sentence explaining why this tool call is needed')
  .optional();

const webInputFields = {
  query: z.string().min(1).describe('Search query text'),
  limit: z.number().int().describe('Maximum number of search results'),
};

const fetchInputFields = {
  url: z.string().url().describe('HTTP/HTTPS URL to fetch'),
  maxChars: z
    .number()
    .int()
    .describe('Maximum number of characters to return from fetched content'),
};

const shellInputFields = {
  command: z.string().describe('The shell command to execute'),
  cwd: z.string().describe('The working directory in which to execute the command'),
  timeout: z.number().describe('Command timeout in milliseconds'),
};

const readFileInputFields = {
  path: z.string().describe('Absolute path or workspace-relative path to the file to read'),
  encoding: z.string().describe('File encoding'),
};

const writeFileInputFields = {
  path: z.string().describe('Absolute path or workspace-relative path to the file to write'),
  content: z.string().describe('The content to write to the file'),
  encoding: z.string().describe('File encoding'),
};

const editFileOperationInputSchema = z.object({
  oldText: z
    .string()
    .min(1)
    .describe('Exact existing text to replace. Must match the file content exactly.'),
  newText: z.string().describe('Replacement text. Use an empty string to delete the matched text.'),
  replaceAll: z
    .boolean()
    .optional()
    .default(false)
    .describe('Replace every exact match instead of requiring a single unambiguous match'),
});

const editFileInputFields = {
  path: z
    .string()
    .describe('Absolute path or workspace-relative path to the existing file to edit'),
  edits: z
    .array(editFileOperationInputSchema)
    .min(1)
    .max(MAX_EDIT_FILE_OPERATIONS)
    .describe(
      `Ordered exact-text replacement operations to apply sequentially. Provide at most ${MAX_EDIT_FILE_OPERATIONS} edits per call.`
    ),
  encoding: z.string().describe('File encoding'),
};

const listDirInputFields = {
  path: z.string().describe('Absolute path or workspace-relative path to the directory to list'),
  recursive: z.boolean().describe('Whether to list subdirectories recursively'),
};

const deleteFileInputFields = {
  path: z.string().describe('Absolute path or workspace-relative path to the file to delete'),
};

const loadSkillInputFields = {
  id: z.string().describe('Exact selected skill id to load'),
};

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

const todoPlanItemInputSchema = z.object({
  id: z.string().describe('Stable todo item id').optional(),
  text: z.string().min(1).describe('Todo item text'),
  status: z.enum(['pending', 'in_progress', 'completed']).describe('Todo item status').optional(),
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

const agentUsedToolOutputSchema = z
  .object({
    name: z.string().optional(),
    callCount: z.number().optional(),
  })
  .passthrough();

export const WebToolInputSchema = z.object({
  query: webInputFields.query,
  limit: webInputFields.limit.optional().default(DEFAULT_SEARCH_RESULT_LIMIT),
  description: toolCallDescriptionField,
});

export const WebToolInputSchemaUi = z
  .object({
    query: webInputFields.query.optional(),
    limit: webInputFields.limit.optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const FetchToolInputSchema = z.object({
  url: fetchInputFields.url,
  maxChars: fetchInputFields.maxChars.optional().default(DEFAULT_FETCH_MAX_CHARS),
  description: toolCallDescriptionField,
});

export const FetchToolInputSchemaUi = z
  .object({
    url: fetchInputFields.url.optional(),
    maxChars: fetchInputFields.maxChars.optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const ShellToolInputSchema = z.object({
  command: shellInputFields.command,
  cwd: shellInputFields.cwd.optional(),
  timeout: shellInputFields.timeout.optional().default(DEFAULT_SHELL_TIMEOUT_MS),
  description: toolCallDescriptionField,
});

export const ShellToolInputSchemaUi = z
  .object({
    command: shellInputFields.command.optional(),
    cwd: shellInputFields.cwd.optional(),
    timeout: shellInputFields.timeout.optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const ReadFileInputSchema = z.object({
  path: readFileInputFields.path,
  encoding: readFileInputFields.encoding.optional().default(DEFAULT_FILE_ENCODING),
  description: toolCallDescriptionField,
});

export const ReadFileInputSchemaUi = z
  .object({
    path: readFileInputFields.path.optional(),
    encoding: readFileInputFields.encoding.optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const WriteFileInputSchema = z.object({
  path: writeFileInputFields.path,
  content: writeFileInputFields.content,
  encoding: writeFileInputFields.encoding.optional().default(DEFAULT_FILE_ENCODING),
  description: toolCallDescriptionField,
});

export const EditFileInputSchema = z.object({
  path: editFileInputFields.path,
  edits: editFileInputFields.edits,
  encoding: editFileInputFields.encoding.optional().default(DEFAULT_FILE_ENCODING),
  description: toolCallDescriptionField,
});

export const WriteFileInputSchemaUi = z
  .object({
    path: writeFileInputFields.path.optional(),
    content: writeFileInputFields.content.optional(),
    encoding: writeFileInputFields.encoding.optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const EditFileInputSchemaUi = z
  .object({
    path: editFileInputFields.path.optional(),
    edits: z.array(editFileOperationInputSchema).optional(),
    encoding: editFileInputFields.encoding.optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const ListDirInputSchema = z.object({
  path: listDirInputFields.path,
  recursive: listDirInputFields.recursive.optional().default(false),
  description: toolCallDescriptionField,
});

export const ListDirInputSchemaUi = z
  .object({
    path: listDirInputFields.path.optional(),
    recursive: listDirInputFields.recursive.optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const DeleteFileInputSchema = z.object({
  path: deleteFileInputFields.path,
  description: toolCallDescriptionField,
});

export const LoadSkillInputSchema = z.object({
  id: loadSkillInputFields.id,
  description: toolCallDescriptionField,
});

export const ListPersonalSkillsInputSchema = z.object({
  query: z.string().trim().describe('Optional search text for matching personal skills').optional(),
  limit: z
    .number()
    .int()
    .describe('Maximum number of personal skills to return')
    .optional()
    .default(DEFAULT_PERSONAL_SKILL_LIST_LIMIT),
  description: toolCallDescriptionField,
});

export const ReadPersonalSkillInputSchema = z.object({
  id: personalSkillIdInputFields.id,
  maxChars: z
    .number()
    .int()
    .describe('Maximum number of characters to return from the personal skill file')
    .optional()
    .default(DEFAULT_PERSONAL_SKILL_READ_MAX_CHARS),
  description: toolCallDescriptionField,
});

export const WritePersonalSkillInputSchema = z.object({
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
});

export const DeletePersonalSkillInputSchema = z.object({
  id: personalSkillIdInputFields.id,
  description: toolCallDescriptionField,
});

export const ListTodoListsInputSchema = z.object({
  query: z.string().trim().describe('Optional search text for matching todo lists').optional(),
  limit: z
    .number()
    .int()
    .describe('Maximum number of todo lists to return')
    .optional()
    .default(DEFAULT_TODO_LIST_LIMIT),
  description: toolCallDescriptionField,
});

export const ListTodoListsInputSchemaUi = z
  .object({
    query: z.string().optional(),
    limit: z.number().optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const ReadTodoListInputSchema = z
  .object({
    id: todoListLookupInputFields.id.optional(),
    title: todoListLookupInputFields.title.optional(),
    description: toolCallDescriptionField,
  })
  .superRefine((value, ctx) => {
    const hasId = typeof value.id === 'string' && value.id.trim().length > 0;
    const hasTitle = typeof value.title === 'string' && value.title.trim().length > 0;
    if (!hasId && !hasTitle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['id'],
        message: 'Either id or title is required',
      });
    }
  });

export const ReadTodoListInputSchemaUi = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const WriteTodoListInputSchema = z
  .object({
    id: todoListLookupInputFields.id.optional(),
    title: todoListLookupInputFields.title.optional(),
    summary: z.string().describe('Optional short summary of the todo list').optional(),
    items: z
      .array(todoListItemInputSchema)
      .describe('Todo items to store in order')
      .optional()
      .default([]),
    description: toolCallDescriptionField,
  })
  .superRefine((value, ctx) => {
    const hasId = typeof value.id === 'string' && value.id.trim().length > 0;
    const hasTitle = typeof value.title === 'string' && value.title.trim().length > 0;
    if (!hasId && !hasTitle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['title'],
        message: 'Either id or title is required',
      });
    }
  });

export const WriteTodoListInputSchemaUi = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    summary: z.string().optional(),
    items: z.array(todoListItemInputSchema).optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const DeleteTodoListInputSchema = z
  .object({
    id: todoListLookupInputFields.id.optional(),
    title: todoListLookupInputFields.title.optional(),
    description: toolCallDescriptionField,
  })
  .superRefine((value, ctx) => {
    const hasId = typeof value.id === 'string' && value.id.trim().length > 0;
    const hasTitle = typeof value.title === 'string' && value.title.trim().length > 0;
    if (!hasId && !hasTitle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['id'],
        message: 'Either id or title is required',
      });
    }
  });

export const DeleteTodoListInputSchemaUi = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const ListProactiveTasksInputSchema = z.object({
  query: z.string().trim().describe('Optional search text for matching proactive tasks').optional(),
  limit: z
    .number()
    .int()
    .describe('Maximum number of proactive tasks to return')
    .optional()
    .default(DEFAULT_PROACTIVE_TASK_LIST_LIMIT),
  description: toolCallDescriptionField,
});

export const ListProactiveTasksInputSchemaUi = z
  .object({
    query: z.string().optional(),
    limit: z.number().optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const ReadProactiveTaskInputSchema = z
  .object({
    id: proactiveTaskLookupInputFields.id.optional(),
    name: proactiveTaskLookupInputFields.name.optional(),
    description: toolCallDescriptionField,
  })
  .superRefine((value, ctx) => {
    const hasId = typeof value.id === 'string' && value.id.trim().length > 0;
    const hasName = typeof value.name === 'string' && value.name.trim().length > 0;
    if (!hasId && !hasName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['id'],
        message: 'Either id or name is required',
      });
    }
  });

export const ReadProactiveTaskInputSchemaUi = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const WriteProactiveTaskInputSchema = z
  .object({
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
  })
  .superRefine((value, ctx) => {
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

export const WriteProactiveTaskInputSchemaUi = z
  .object({
    action: z.enum(['create', 'update']).optional(),
    id: z.string().optional(),
    currentName: z.string().optional(),
    name: z.string().optional(),
    prompt: z.string().optional(),
    schedule: proactiveTaskScheduleInputSchema.optional(),
    enabled: z.boolean().optional(),
    notify: z.boolean().optional(),
    delivery: z.enum(['current_thread', 'dedicated_thread', 'specific_thread']).optional(),
    threadId: z.string().optional(),
    providerType: z.string().optional(),
    providerId: z.string().optional(),
    model: z.string().optional(),
    toolMode: z.enum(['auto', 'manual', 'disabled']).optional(),
    tools: z.array(proactiveTaskSafeToolSchema).optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const DeleteProactiveTaskInputSchema = z
  .object({
    id: proactiveTaskLookupInputFields.id.optional(),
    name: proactiveTaskLookupInputFields.name.optional(),
    description: toolCallDescriptionField,
  })
  .superRefine((value, ctx) => {
    const hasId = typeof value.id === 'string' && value.id.trim().length > 0;
    const hasName = typeof value.name === 'string' && value.name.trim().length > 0;
    if (!hasId && !hasName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['id'],
        message: 'Either id or name is required',
      });
    }
  });

export const DeleteProactiveTaskInputSchemaUi = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const ListAwaitersInputSchema = z.object({
  query: z.string().trim().describe('Optional search text for matching awaiters').optional(),
  limit: z
    .number()
    .int()
    .describe('Maximum number of awaiters to return')
    .optional()
    .default(DEFAULT_AWAITER_LIST_LIMIT),
  description: toolCallDescriptionField,
});

export const ListAwaitersInputSchemaUi = z
  .object({
    query: z.string().optional(),
    limit: z.number().optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const ReadAwaiterInputSchema = z
  .object({
    id: awaiterLookupInputFields.id.optional(),
    title: awaiterLookupInputFields.title.optional(),
    description: toolCallDescriptionField,
  })
  .superRefine((value, ctx) => {
    const hasId = typeof value.id === 'string' && value.id.trim().length > 0;
    const hasTitle = typeof value.title === 'string' && value.title.trim().length > 0;
    if (!hasId && !hasTitle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['id'],
        message: 'Either id or title is required',
      });
    }
  });

export const ReadAwaiterInputSchemaUi = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const WriteAwaiterInputSchema = z
  .object({
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
  })
  .superRefine((value, ctx) => {
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

export const WriteAwaiterInputSchemaUi = z
  .object({
    action: z.enum(['create', 'update']).optional(),
    id: z.string().optional(),
    currentTitle: z.string().optional(),
    title: z.string().optional(),
    instruction: z.string().optional(),
    trigger: awaiterTriggerInputSchema.optional(),
    notify: z.boolean().optional(),
    threadId: z.string().optional(),
    providerType: z.string().optional(),
    providerId: z.string().optional(),
    model: z.string().optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const DeleteAwaiterInputSchema = z
  .object({
    id: awaiterLookupInputFields.id.optional(),
    title: awaiterLookupInputFields.title.optional(),
    description: toolCallDescriptionField,
  })
  .superRefine((value, ctx) => {
    const hasId = typeof value.id === 'string' && value.id.trim().length > 0;
    const hasTitle = typeof value.title === 'string' && value.title.trim().length > 0;
    if (!hasId && !hasTitle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['id'],
        message: 'Either id or title is required',
      });
    }
  });

export const DeleteAwaiterInputSchemaUi = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const DeleteFileInputSchemaUi = z
  .object({
    path: deleteFileInputFields.path.optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const LoadSkillInputSchemaUi = z
  .object({
    id: loadSkillInputFields.id.optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const ListPersonalSkillsInputSchemaUi = z
  .object({
    query: z.string().optional(),
    limit: z.number().optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const ReadPersonalSkillInputSchemaUi = z
  .object({
    id: personalSkillIdInputFields.id.optional(),
    maxChars: z.number().optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const WritePersonalSkillInputSchemaUi = z
  .object({
    id: personalSkillIdInputFields.id.optional(),
    skillName: z.string().optional(),
    skillDescription: z.string().optional(),
    instructions: z.string().optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const DeletePersonalSkillInputSchemaUi = z
  .object({
    id: personalSkillIdInputFields.id.optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const TodoToolInputSchema = z.object({
  items: z
    .array(todoPlanItemInputSchema)
    .max(MAX_EXECUTION_TASK_PLAN_ITEMS)
    .describe(
      `Current task-plan items in execution order. Keep the execution plan to ${MAX_EXECUTION_TASK_PLAN_ITEMS} broad steps or fewer by grouping related work.`
    )
    .optional()
    .default([]),
  description: toolCallDescriptionField,
});

export const TodoToolInputSchemaUi = z
  .object({
    items: z.array(todoPlanItemInputSchema).optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

export const AgentToolInputSchema = z.object({
  task: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Self-contained delegated subtask with a clear boundary and deliverable. Use for focused research, review, or synthesis work, not for the entire user request.'
    ),
  context: z
    .string()
    .trim()
    .describe(
      'Optional relevant background, constraints, scope, or already-known facts the subagent must honor.'
    )
    .optional(),
  expectedOutput: z
    .string()
    .trim()
    .describe(
      'Optional exact output contract for the parent agent, for example findings bullets, a shortlist, a comparison summary, or recommended next files.'
    )
    .optional(),
  tools: z
    .array(z.string().trim().min(1))
    .max(MAX_AGENT_TOOL_SELECTION)
    .describe(
      `Optional exact subset of currently enabled approval-free tools to expose to the delegated subagent. Narrow this when the subtask only needs a few safe tools. Provide at most ${MAX_AGENT_TOOL_SELECTION} tool names.`
    )
    .optional(),
  maxIterations: z
    .number()
    .int()
    .min(1)
    .max(MAX_AGENT_MAX_ITERATIONS)
    .describe(
      `Maximum delegated tool/reasoning steps (1-${MAX_AGENT_MAX_ITERATIONS}). Keep this proportional to the bounded subtask.`
    )
    .optional()
    .default(DEFAULT_AGENT_MAX_ITERATIONS),
  description: toolCallDescriptionField,
});

export const AgentToolInputSchemaUi = z
  .object({
    task: z.string().optional(),
    context: z.string().optional(),
    expectedOutput: z.string().optional(),
    tools: z.array(z.string()).optional(),
    maxIterations: z.number().optional(),
    description: toolCallDescriptionField,
  })
  .passthrough();

const TodoPlanItemOutputSchema = z
  .object({
    id: z.string().optional(),
    text: z.string().optional(),
    status: z.enum(['pending', 'in_progress', 'completed']).optional(),
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

export const WebToolOutputSchema = z
  .object({
    query: z.string().optional(),
    source: z.string().optional(),
    results: z
      .array(
        z
          .object({
            title: z.string().optional(),
            url: z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
    resultCount: z.number().optional(),
    warnings: z.array(z.string()).optional(),
    sourcesTried: z.array(z.string()).optional(),
  })
  .passthrough();

export const FetchToolOutputSchema = z
  .object({
    url: z.string().optional(),
    finalUrl: z.string().optional(),
    ok: z.boolean().optional(),
    status: z.number().optional(),
    statusText: z.string().optional(),
    contentType: z.string().optional(),
    title: z.string().optional(),
    content: z.string().optional(),
    truncated: z.boolean().optional(),
    error: z.string().optional(),
  })
  .passthrough();

export const ShellToolOutputSchema = z
  .object({
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    exitCode: z.number().optional(),
    isError: z.boolean().optional(),
  })
  .passthrough();

export const ReadFileOutputSchema = z
  .object({
    path: z.string().optional(),
    content: z.string().optional(),
  })
  .passthrough();

export const WriteFileOutputSchema = z
  .object({
    path: z.string().optional(),
    success: z.boolean().optional(),
  })
  .passthrough();

export const EditFileOutputSchema = z
  .object({
    path: z.string().optional(),
    success: z.boolean().optional(),
    changed: z.boolean().optional(),
    appliedEditCount: z.number().optional(),
    totalReplacements: z.number().optional(),
  })
  .passthrough();

export const ListDirOutputSchema = z.array(
  z
    .object({
      name: z.string().optional(),
      isDirectory: z.boolean().optional(),
      isFile: z.boolean().optional(),
      path: z.string().optional(),
    })
    .passthrough()
);

export const DeleteFileOutputSchema = z
  .object({
    path: z.string().optional(),
    deleted: z.boolean().optional(),
  })
  .passthrough();

export const LoadSkillOutputSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    source: z.enum(['user', 'codex']).optional(),
    content: z.string().optional(),
    truncated: z.boolean().optional(),
  })
  .passthrough();

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

export const TodoToolOutputSchema = z
  .object({
    items: z.array(TodoPlanItemOutputSchema).optional(),
    rendered: z.string().optional(),
    totalCount: z.number().optional(),
    completedCount: z.number().optional(),
    inProgressCount: z.number().optional(),
    pendingCount: z.number().optional(),
  })
  .passthrough();

export const AgentToolOutputSchema = z
  .object({
    response: z.string().optional(),
    iterations: z.number().optional(),
    toolCallCount: z.number().optional(),
    usedTools: z.array(agentUsedToolOutputSchema).optional(),
    model: z
      .object({
        providerType: z.string().optional(),
        providerId: z.string().optional(),
        model: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

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
