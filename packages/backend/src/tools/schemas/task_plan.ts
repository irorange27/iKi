import { z } from 'zod';

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
