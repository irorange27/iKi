import { z } from 'zod';
import { DEFAULT_AWAITER_LIST_LIMIT } from '../../types/awaiters';

import { requireEitherField, toolCallDescriptionField, uiSchema } from './shared';

const awaiterLookupInputFields = {
  id: z.string().describe('Awaiter id'),
  title: z.string().describe('Exact awaiter title'),
};

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
