import { describe, expect, it } from 'vitest';

import { PlanTool } from '@iki/core/tools/plan_tools';

describe('PlanTool', () => {
  const tool = new PlanTool();

  it('has the expected metadata', () => {
    expect(tool.name).toBe('plan');
    expect(tool.type).toBe('function');
    expect(tool.displayName).toBe('Plan');
    expect(tool.autoAllowed).toBe(true);
    expect(tool.needsApproval).toBe(false);
    expect(tool.description).toContain('structured execution plan');
  });

  it('accepts a valid plan and returns formatted output', async () => {
    const result = (await tool.execute({
      steps: [
        {
          id: 'analyze',
          description: 'Read and analyze the relevant source files',
          expectedOutput: 'Summary of key findings',
          dependsOn: [],
          suggestedTools: ['read_file', 'list_dir'],
          strategy: 'Start from entry point and trace dependencies',
        },
        {
          id: 'implement',
          description: 'Implement the changes',
          expectedOutput: 'Modified code files',
          dependsOn: ['analyze'],
          suggestedTools: ['edit_file', 'write_file'],
        },
        {
          id: 'verify',
          description: 'Run tests to verify changes',
          expectedOutput: 'Passing test results',
          dependsOn: ['implement'],
          suggestedTools: ['shell'],
          strategy: 'Run pnpm test and check for regressions',
        },
      ],
      overallStrategy: 'Understand the codebase first, then make targeted changes, finally verify.',
    })) as Record<string, unknown>;

    expect(result.stepCount).toBe(3);
    expect(Array.isArray(result.steps)).toBe(true);
    expect((result.steps as Array<Record<string, unknown>>)[0]?.id).toBe('analyze');
    expect(typeof result.rendered).toBe('string');
    expect(result.rendered as string).toContain('## Strategy');
    expect(result.rendered as string).toContain('## Execution Plan');
    expect(result.rendered as string).toContain('analyze');
    expect(result.rendered as string).toContain('implement');
    expect(result.rendered as string).toContain('verify');
  });

  it('rejects empty steps array via Zod validation', async () => {
    await expect(
      tool.execute({
        steps: [],
        overallStrategy: 'Do nothing.',
      })
    ).rejects.toThrow();
  });

  it('rejects more than 10 steps via Zod validation', async () => {
    const steps = Array.from({ length: 11 }, (_, i) => ({
      id: `step_${i}`,
      description: `Step ${i}`,
      expectedOutput: `Output ${i}`,
    }));

    await expect(
      tool.execute({
        steps,
        overallStrategy: 'Do everything.',
      })
    ).rejects.toThrow();
  });

  it('rejects circular dependencies', async () => {
    await expect(
      tool.execute({
        steps: [
          {
            id: 'a',
            description: 'Step A',
            expectedOutput: 'Result A',
            dependsOn: ['b'],
          },
          {
            id: 'b',
            description: 'Step B',
            expectedOutput: 'Result B',
            dependsOn: ['a'],
          },
        ],
        overallStrategy: 'Circular dependency test.',
      })
    ).rejects.toThrow(/circular/i);
  });

  it('rejects self-dependency', async () => {
    await expect(
      tool.execute({
        steps: [
          {
            id: 'a',
            description: 'Step A',
            expectedOutput: 'Result A',
            dependsOn: ['a'],
          },
        ],
        overallStrategy: 'Self-dependency test.',
      })
    ).rejects.toThrow(/circular/i);
  });

  it('rejects dependsOn referencing non-existent step id', async () => {
    await expect(
      tool.execute({
        steps: [
          {
            id: 'a',
            description: 'Step A',
            expectedOutput: 'Result A',
            dependsOn: ['nonexistent'],
          },
        ],
        overallStrategy: 'Missing dependency test.',
      })
    ).rejects.toThrow(/no step with that id/i);
  });

  it('accepts a plan without optional fields', async () => {
    const result = (await tool.execute({
      steps: [
        {
          id: 'single',
          description: 'Just one step',
          expectedOutput: 'Done',
        },
      ],
      overallStrategy: 'Keep it simple.',
    })) as Record<string, unknown>;

    expect(result.stepCount).toBe(1);
    expect(Array.isArray(result.steps)).toBe(true);
    expect((result.steps as Array<Record<string, unknown>>)[0]?.dependsOn).toEqual([]);
    expect((result.steps as Array<Record<string, unknown>>)[0]?.suggestedTools).toEqual([]);
  });

  it('renders markdown includes dependency annotations', async () => {
    const result = (await tool.execute({
      steps: [
        {
          id: 'first',
          description: 'First step',
          expectedOutput: 'Foundation',
        },
        {
          id: 'second',
          description: 'Second step',
          expectedOutput: 'Built on foundation',
          dependsOn: ['first'],
        },
      ],
      overallStrategy: 'Sequential execution.',
    })) as Record<string, unknown>;

    expect(result.rendered as string).toContain('after: first');
  });
});
