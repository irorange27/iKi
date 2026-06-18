import { z } from 'zod';

import { createLogger } from '@iki/core/logger';
import { BaseTool } from '@iki/core/tools/base';
import { zodSchemaToJsonSchema } from '@iki/core/tools/json_schema';
import { MAX_PLAN_STEPS, PlanToolInputSchema, PlanToolOutputSchema } from '@iki/core/tools/schemas';

const planLogger = createLogger({ module: 'plan_tool' });

type PlanStepInput = z.infer<typeof PlanToolInputSchema>['steps'][number];

const validateDependencyExists = (steps: PlanStepInput[], dependsOn: string[]): void => {
  const ids = new Set(steps.map(s => s.id));
  for (const dep of dependsOn) {
    if (!ids.has(dep)) {
      throw new Error(`Step depends on "${dep}" but no step with that id exists`);
    }
  }
};

const validateNoCircularDeps = (steps: PlanStepInput[]): void => {
  const idToIndex = new Map<string, number>();
  steps.forEach((s, i) => idToIndex.set(s.id, i));

  for (const step of steps) {
    for (const dep of step.dependsOn) {
      const depIndex = idToIndex.get(dep);
      if (depIndex === undefined) continue; // validated separately
      const stepIndex = idToIndex.get(step.id);
      if (stepIndex !== undefined && depIndex >= stepIndex) {
        throw new Error(
          `Circular or out-of-order dependency: "${step.id}" depends on "${dep}" but "${dep}" appears at or after "${step.id}" in the step list`
        );
      }
    }
  }
};

const renderPlanMarkdown = (steps: PlanStepInput[], overallStrategy: string): string => {
  const lines: string[] = [`## Strategy\n\n${overallStrategy}\n`];
  lines.push('## Execution Plan\n');

  for (const step of steps) {
    const deps = step.dependsOn.length > 0 ? ` (after: ${step.dependsOn.join(', ')})` : '';
    const tools = step.suggestedTools.length > 0 ? `\n  Tools: ${step.suggestedTools.join(', ')}` : '';
    const strategyNote = step.strategy ? `\n  Approach: ${step.strategy}` : '';

    lines.push(
      `### ${step.id}${deps}`,
      `**Goal:** ${step.description}`,
      `**Expected output:** ${step.expectedOutput}${tools}${strategyNote}`,
      ''
    );
  }

  return lines.join('\n');
};

export class PlanTool extends BaseTool<typeof PlanToolInputSchema> {
  override name = 'plan';
  override type = 'function';
  override displayName = 'Plan';
  override autoAllowed = true;
  override needsApproval = false;
  override description =
    'Create a structured execution plan BEFORE running other tools. ' +
    'Decompose the task into ordered steps with dependencies and expected outputs. ' +
    `Provide at most ${MAX_PLAN_STEPS} broad steps. ` +
    'Call this FIRST. Call again to revise the plan if execution reveals new information or a step fails.';
  override paramSchema = PlanToolInputSchema;
  override outputSchema = zodSchemaToJsonSchema(PlanToolOutputSchema, { title: 'plan_output' });

  protected override async handler(
    args: z.infer<typeof PlanToolInputSchema>
  ): Promise<z.infer<typeof PlanToolOutputSchema>> {
    for (const step of args.steps) {
      validateDependencyExists(args.steps, step.dependsOn);
    }
    validateNoCircularDeps(args.steps);

    const rendered = renderPlanMarkdown(args.steps, args.overallStrategy);

    planLogger.event({
      level: 'info',
      event: 'plan.created',
      data: { stepCount: args.steps.length },
    });

    return {
      steps: args.steps.map(s => ({
        id: s.id,
        description: s.description,
        expectedOutput: s.expectedOutput,
        dependsOn: s.dependsOn,
        suggestedTools: s.suggestedTools,
        strategy: s.strategy ?? null,
      })),
      overallStrategy: args.overallStrategy,
      rendered,
      stepCount: args.steps.length,
    };
  }
}
