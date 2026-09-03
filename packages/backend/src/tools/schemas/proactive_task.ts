import { z } from 'zod';
import { DEFAULT_PROACTIVE_TASK_LIST_LIMIT, SAFE_PROACTIVE_TASK_TOOLS } from '../../types/tasks';

import { requireEitherField, toolCallDescriptionField, uiSchema } from './shared';

const proactiveTaskLookupInputFields = {
  id: z.string().describe('Proactive task id'),
  name: z.string().describe('Exact proactive task name'),
};

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
