import { z } from 'zod';

export const DEFAULT_SEARCH_RESULT_LIMIT = 5;
export const MAX_SEARCH_RESULT_LIMIT = 10;
export const DEFAULT_FETCH_MAX_CHARS = 12000;
export const MIN_FETCH_MAX_CHARS = 500;
export const MAX_FETCH_MAX_CHARS = 80000;
export const DEFAULT_SHELL_TIMEOUT_MS = 30000;
export const DEFAULT_FILE_ENCODING = 'utf-8';
export const DEFAULT_TODO_LIST_LIMIT = 20;
export const MAX_TODO_LIST_LIMIT = 100;
export const DEFAULT_PERSONAL_SKILL_LIST_LIMIT = 20;
export const MAX_PERSONAL_SKILL_LIST_LIMIT = 100;
export const DEFAULT_PERSONAL_SKILL_READ_MAX_CHARS = 20000;
export const MIN_PERSONAL_SKILL_READ_MAX_CHARS = 500;
export const MAX_PERSONAL_SKILL_READ_MAX_CHARS = 120000;

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

const todoListItemInputSchema = z.object({
  content: z.string().min(1).describe('Todo item text'),
  notes: z.string().describe('Optional notes for the todo item').optional(),
  completed: z.boolean().describe('Whether the item is already completed').optional(),
});

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

export const WriteFileInputSchemaUi = z
  .object({
    path: writeFileInputFields.path.optional(),
    content: writeFileInputFields.content.optional(),
    encoding: writeFileInputFields.encoding.optional(),
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
