import { z } from 'zod';

// Renderer tool-payload parsing imports this module via @iki/backend/chat/tool_payloads.
// Keep this file limited to core/browser-safe dependencies so the renderer bundle never pulls
// Node-only core runtime modules into Vite.

// ---------------------------------------------------------------------------
// Harness constants
// ---------------------------------------------------------------------------

export const MAX_EXECUTION_TASK_PLAN_ITEMS = 5;
export const DEFAULT_SEARCH_RESULT_LIMIT = 5;
export const MAX_SEARCH_RESULT_LIMIT = 10;
export const DEFAULT_FETCH_MAX_CHARS = 12000;
export const MIN_FETCH_MAX_CHARS = 500;
export const MAX_FETCH_MAX_CHARS = 80000;
export const DEFAULT_SHELL_TIMEOUT_MS = 30000;
export const DEFAULT_FILE_ENCODING = 'utf-8';
export const MAX_EDIT_FILE_OPERATIONS = 20;
export const DEFAULT_AGENT_MAX_ITERATIONS = 8;
export const MAX_AGENT_MAX_ITERATIONS = 12;
export const MAX_AGENT_TOOL_SELECTION = 12;

// ---------------------------------------------------------------------------
// Helpers to reduce repetition in Ui variants and shared refinements
// ---------------------------------------------------------------------------

/**
 * Build a "UI" variant of a ZodObject shape.
 *
 * Every field becomes optional (defaults are stripped first) and the object
 * gets `.passthrough()` so unknown renderer fields don't cause parse failures.
 */
export function uiSchema<T extends Record<string, z.ZodTypeAny>>(shape: T) {
  const ui: Record<string, z.ZodTypeAny> = {};
  for (const key of Object.keys(shape)) {
    const field = shape[key];
    ui[key] = (field instanceof z.ZodDefault ? field.removeDefault() : field) as z.ZodTypeAny;
    ui[key] = (ui[key] as z.ZodTypeAny).optional();
  }
  return z.object(ui).passthrough();
}

/**
 * SuperRefine callback that requires *at least one* of two named string fields
 * to be present and non-empty.
 */
export function requireEitherField(a: string, b: string, message?: string) {
  return (value: Record<string, unknown>, ctx: z.RefinementCtx): void => {
    const hasA = typeof value[a] === 'string' && (value[a] as string).trim().length > 0;
    const hasB = typeof value[b] === 'string' && (value[b] as string).trim().length > 0;
    if (!hasA && !hasB) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [a],
        message: message ?? `Either ${a} or ${b} is required`,
      });
    }
  };
}

export const toolCallDescriptionField = z
  .string()
  .trim()
  .max(160)
  .describe('One short sentence explaining why this tool call is needed')
  .optional();

// ---------------------------------------------------------------------------
// Harness input field definitions
// ---------------------------------------------------------------------------

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
    .describe('Text to replace. Include 1-3 lines of surrounding context to make the match unambiguous.'),
  newText: z.string().describe('Replacement text. Use an empty string to delete the matched text.'),
  replaceAll: z
    .boolean()
    .optional()
    .default(false)
    .describe('Replace every match instead of requiring a single unambiguous match'),
  contextBefore: z
    .string()
    .optional()
    .describe('A few lines of text immediately before the target. Anchors the search when similar text appears in multiple places.'),
  contextAfter: z
    .string()
    .optional()
    .describe('A few lines of text immediately after the target. Anchors the search when similar text appears in multiple places.'),
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

const todoPlanItemInputSchema = z.object({
  id: z.string().describe('Stable todo item id').optional(),
  text: z.string().min(1).describe('Todo item text'),
  status: z.enum(['pending', 'in_progress', 'completed']).describe('Todo item status').optional(),
});

const agentUsedToolOutputSchema = z
  .object({
    name: z.string().optional(),
    callCount: z.number().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Web tool schemas
// ---------------------------------------------------------------------------

const webToolInputShape = {
  query: webInputFields.query,
  limit: webInputFields.limit.optional().default(DEFAULT_SEARCH_RESULT_LIMIT),
  description: toolCallDescriptionField,
};

export const WebToolInputSchema = z.object(webToolInputShape);
export const WebToolInputSchemaUi = uiSchema(webToolInputShape);

// ---------------------------------------------------------------------------
// Fetch tool schemas
// ---------------------------------------------------------------------------

const fetchToolInputShape = {
  url: fetchInputFields.url,
  maxChars: fetchInputFields.maxChars.optional().default(DEFAULT_FETCH_MAX_CHARS),
  description: toolCallDescriptionField,
};

export const FetchToolInputSchema = z.object(fetchToolInputShape);
export const FetchToolInputSchemaUi = uiSchema(fetchToolInputShape);

// ---------------------------------------------------------------------------
// Shell tool schemas
// ---------------------------------------------------------------------------

const shellToolInputShape = {
  command: shellInputFields.command,
  cwd: shellInputFields.cwd.optional(),
  timeout: shellInputFields.timeout.optional().default(DEFAULT_SHELL_TIMEOUT_MS),
  description: toolCallDescriptionField,
};

export const ShellToolInputSchema = z.object(shellToolInputShape);
export const ShellToolInputSchemaUi = uiSchema(shellToolInputShape);

// ---------------------------------------------------------------------------
// Read file schemas
// ---------------------------------------------------------------------------

const readFileInputShape = {
  path: readFileInputFields.path,
  encoding: readFileInputFields.encoding.optional().default(DEFAULT_FILE_ENCODING),
  description: toolCallDescriptionField,
};

export const ReadFileInputSchema = z.object(readFileInputShape);
export const ReadFileInputSchemaUi = uiSchema(readFileInputShape);

// ---------------------------------------------------------------------------
// Write file schemas
// ---------------------------------------------------------------------------

const writeFileInputShape = {
  path: writeFileInputFields.path,
  content: writeFileInputFields.content,
  encoding: writeFileInputFields.encoding.optional().default(DEFAULT_FILE_ENCODING),
  description: toolCallDescriptionField,
};

export const WriteFileInputSchema = z.object(writeFileInputShape);
export const WriteFileInputSchemaUi = uiSchema(writeFileInputShape);

// ---------------------------------------------------------------------------
// Edit file schemas
// ---------------------------------------------------------------------------

const editFileInputShape = {
  path: editFileInputFields.path,
  edits: editFileInputFields.edits,
  encoding: editFileInputFields.encoding.optional().default(DEFAULT_FILE_ENCODING),
  description: toolCallDescriptionField,
};

export const EditFileInputSchema = z.object(editFileInputShape);
export const EditFileInputSchemaUi = uiSchema(editFileInputShape);

// ---------------------------------------------------------------------------
// List directory schemas
// ---------------------------------------------------------------------------

const listDirInputShape = {
  path: listDirInputFields.path,
  recursive: listDirInputFields.recursive.optional().default(false),
  description: toolCallDescriptionField,
};

export const ListDirInputSchema = z.object(listDirInputShape);
export const ListDirInputSchemaUi = uiSchema(listDirInputShape);

// ---------------------------------------------------------------------------
// Delete file schemas
// ---------------------------------------------------------------------------

export const DeleteFileInputSchema = z.object({
  path: deleteFileInputFields.path,
  description: toolCallDescriptionField,
});

const deleteFileInputShape = {
  path: deleteFileInputFields.path,
  description: toolCallDescriptionField,
};

export const DeleteFileInputSchemaUi = uiSchema(deleteFileInputShape);

// ---------------------------------------------------------------------------
// Load skill (harness-level skill activation) schemas
// ---------------------------------------------------------------------------

export const LoadSkillInputSchema = z.object({
  id: loadSkillInputFields.id,
  description: toolCallDescriptionField,
});

const loadSkillInputShape = {
  id: loadSkillInputFields.id,
  description: toolCallDescriptionField,
};

export const LoadSkillInputSchemaUi = uiSchema(loadSkillInputShape);

// ---------------------------------------------------------------------------
// Agent (sub-agent) tool schemas
// ---------------------------------------------------------------------------

const agentToolInputShape = {
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
};

export const AgentToolInputSchema = z.object(agentToolInputShape);
export const AgentToolInputSchemaUi = uiSchema(agentToolInputShape);

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
// Plan tool schemas
// ---------------------------------------------------------------------------

const planToolStepShape = {
  id: z.string().trim().min(1).describe('Short, stable identifier for this step (e.g. "analyze-files")'),
  description: z.string().min(1).describe('What this step does and why'),
  expectedOutput: z.string().min(1).describe('Concrete deliverable or result expected from this step'),
  dependsOn: z
    .array(z.string().trim().min(1))
    .max(20)
    .describe('IDs of steps that must complete before this one')
    .optional()
    .default([]),
  suggestedTools: z
    .array(z.string().trim().min(1))
    .max(20)
    .describe('Tools likely needed for this step')
    .optional()
    .default([]),
  strategy: z.string().trim().min(1).describe('Brief approach note -- how to tackle this step').optional(),
};

export const MAX_PLAN_STEPS = 10;

const planToolInputShape = {
  steps: z
    .array(z.object(planToolStepShape))
    .min(1)
    .max(MAX_PLAN_STEPS)
    .describe(
      `Ordered execution steps. First steps should have no dependencies. Max ${MAX_PLAN_STEPS} steps -- group related work into broader steps if needed.`
    ),
  overallStrategy: z
    .string()
    .min(1)
    .describe('High-level approach: key decisions, constraints, and order of operations'),
};

export const PlanToolInputSchema = z.object(planToolInputShape);

// ---------------------------------------------------------------------------
// Harness output schemas
// ---------------------------------------------------------------------------

const TodoPlanItemOutputSchema = z
  .object({
    id: z.string().optional(),
    text: z.string().optional(),
    status: z.enum(['pending', 'in_progress', 'completed']).optional(),
  })
  .passthrough();

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
    diff: z.string().optional(),
    error: z.boolean().optional(),
    message: z.string().optional(),
    recovery: z
      .object({
        suggestion: z.string().optional(),
        fileSnippet: z.string().optional(),
        retryHint: z.string().optional(),
      })
      .passthrough()
      .optional(),
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

const planStepOutputSchema = z
  .object({
    id: z.string().optional(),
    description: z.string().optional(),
    expectedOutput: z.string().optional(),
    dependsOn: z.array(z.string()).optional(),
    suggestedTools: z.array(z.string()).optional(),
    strategy: z.string().nullable().optional(),
  })
  .passthrough();

export const PlanToolOutputSchema = z
  .object({
    steps: z.array(planStepOutputSchema).optional(),
    overallStrategy: z.string().optional(),
    rendered: z.string().optional(),
    stepCount: z.number().optional(),
  })
  .passthrough();
