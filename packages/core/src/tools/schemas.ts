import { z } from 'zod';

// Renderer tool-payload parsing imports these helpers through backend schema modules.
// Keep this file limited to browser-safe dependencies.

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
