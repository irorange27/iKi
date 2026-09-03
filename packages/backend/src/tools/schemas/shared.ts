import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared Zod helpers (moved from core/tools/schemas)
// ---------------------------------------------------------------------------

export function uiSchema<T extends Record<string, z.ZodTypeAny>>(shape: T) {
  const ui: Record<string, z.ZodTypeAny> = {};
  for (const key of Object.keys(shape)) {
    const field = shape[key];
    ui[key] = (field instanceof z.ZodDefault ? field.removeDefault() : field) as z.ZodTypeAny;
    ui[key] = (ui[key] as z.ZodTypeAny).optional();
  }
  return z.object(ui).passthrough();
}

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
  .describe(
    'REQUIRED in practice: one short sentence (max 160 chars) stating WHY you are calling this tool right now. ' +
      'This is shown to the user in the UI as the tool-call title — always include it, even when the reason seems obvious.'
  )
  .optional();

// ---------------------------------------------------------------------------
// Built-in tool constants
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
// App-level constants
// ---------------------------------------------------------------------------

export const DEFAULT_PERSONAL_SKILL_LIST_LIMIT = 20;
export const MAX_PERSONAL_SKILL_LIST_LIMIT = 100;
export const DEFAULT_PERSONAL_SKILL_READ_MAX_CHARS = 20000;
export const MIN_PERSONAL_SKILL_READ_MAX_CHARS = 500;
export const MAX_PERSONAL_SKILL_READ_MAX_CHARS = 120000;
export const DEFAULT_TODO_LIST_LIMIT = 20;
export const MAX_TODO_LIST_LIMIT = 100;
