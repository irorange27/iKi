import { z } from 'zod';

import { agentUsedToolOutputSchema } from './agent';

// ---------------------------------------------------------------------------
// Built-in tool output schemas
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
