import type { Plan } from './types';

interface Step {
  toolCalls?: Array<{ toolName: string; input: unknown }>;
}

const PLANNING_INSTRUCTION =
  'Before using any tools, create a structured execution plan using the `plan` tool. ' +
  'Break the task into ordered steps with clear dependencies and expected outputs.';

const PLAN_REMINDER =
  'Please create a plan first using the `plan` tool before proceeding with execution.';

const EXECUTION_INSTRUCTION_PREFIX =
  'Now execute the plan step by step. Use the `todo` tool to track progress. ' +
  'If a step fails or reveals new information, call `plan` again to revise.';

const buildExecutionInstruction = (plan: Plan): string =>
  `${EXECUTION_INSTRUCTION_PREFIX}\n\nCurrent plan:\n${renderPlanSummary(plan)}`;

const renderPlanSummary = (plan: Plan): string => {
  const lines: string[] = [`Strategy: ${plan.overallStrategy}`, ''];
  for (const step of plan.steps) {
    const deps = Array.isArray(step.dependsOn) && step.dependsOn.length > 0
      ? ` (after: ${step.dependsOn.join(', ')})`
      : '';
    lines.push(`  [ ] ${step.id}${deps}: ${step.description}`);
  }
  return lines.join('\n');
};

const findLatestPlanInSteps = (
  steps: Step[]
): { plan: Plan; stepIndex: number } | null => {
  for (let i = steps.length - 1; i >= 0; i--) {
    const toolCalls = steps[i]?.toolCalls;
    if (!toolCalls) continue;
    for (const tc of toolCalls) {
      if (tc.toolName === 'plan' && tc.input && typeof tc.input === 'object') {
        const input = tc.input as Record<string, unknown>;
        if (Array.isArray(input.steps) && typeof input.overallStrategy === 'string') {
          return {
            plan: {
              steps: input.steps as Plan['steps'],
              overallStrategy: input.overallStrategy,
            },
            stepIndex: i,
          };
        }
      }
    }
  }
  return null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createPlanThenExecutePrepareStep = (enabledTools: string[]): any => {
  const hasPlanTool = enabledTools.some(t => t.trim().toLowerCase() === 'plan');
  if (!hasPlanTool) return undefined;

  let lastInjectedPlanStepIndex = -1;

  return (options: Record<string, unknown>) => {
    const steps = (Array.isArray(options.steps) ? options.steps : []) as Step[];
    const messages = (Array.isArray(options.messages) ? options.messages : []) as unknown[];

    // Step 0: initial planning phase
    if (steps.length === 0) {
      lastInjectedPlanStepIndex = -1;
      return {
        messages: [
          ...messages,
          { role: 'user', content: PLANNING_INSTRUCTION },
        ],
      };
    }

    // Step 1+: check for plan
    const latestPlan = findLatestPlanInSteps(steps);

    if (!latestPlan) {
      return {
        messages: [
          ...messages,
          { role: 'user', content: PLAN_REMINDER },
        ],
      };
    }

    if (latestPlan.stepIndex > lastInjectedPlanStepIndex) {
      lastInjectedPlanStepIndex = latestPlan.stepIndex;
      return {
        messages: [
          ...messages,
          { role: 'user', content: buildExecutionInstruction(latestPlan.plan) },
        ],
      };
    }

    return undefined;
  };
};
