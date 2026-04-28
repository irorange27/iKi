/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it } from 'vitest';

import { createPlanThenExecutePrepareStep } from '../../../../src/core/agent/plan/plan_prepare_step';

describe('createPlanThenExecutePrepareStep', () => {
  it('returns undefined when plan tool is not in enabledTools', () => {
    const result = createPlanThenExecutePrepareStep(['read_file', 'write_file']);
    expect(result).toBeUndefined();
  });

  it('returns undefined when enabledTools is empty', () => {
    const result = createPlanThenExecutePrepareStep([]);
    expect(result).toBeUndefined();
  });

  it('returns a function when plan tool is in enabledTools', () => {
    const result = createPlanThenExecutePrepareStep(['plan', 'read_file']);
    expect(typeof result).toBe('function');
  });

  it('injects planning instruction on step 0', () => {
    const prepareStep = createPlanThenExecutePrepareStep(['plan']);
    const result = prepareStep!({ steps: [], messages: [] });

    expect(result?.messages).toHaveLength(1);
    expect((result?.messages![0] as { role: string; content: string }).role).toBe('user');
    expect((result?.messages![0] as { role: string; content: string }).content).toContain(
      'structured execution plan'
    );
  });

  it('resets internal state on step 0 (new turn boundary)', () => {
    const prepareStep = createPlanThenExecutePrepareStep(['plan']);

    // First turn: step 0, then step 1 with plan
    prepareStep!({ steps: [], messages: [] });
    prepareStep!({
      steps: [{ toolCalls: [{ toolName: 'plan', input: { steps: [], overallStrategy: 's' } }] }],
      messages: [],
    });

    // Second turn: step 0 again — should inject planning instruction again
    const result = prepareStep!({ steps: [], messages: [{ role: 'user', content: 'old' }] });

    expect(result?.messages).toHaveLength(2); // old message + planning instruction
    expect((result?.messages![1] as { role: string; content: string }).content).toContain(
      'structured execution plan'
    );
  });

  it('injects plan reminder when no plan found after step 0', () => {
    const prepareStep = createPlanThenExecutePrepareStep(['plan']);

    // Step 1 with tool calls but no 'plan' tool call
    const result = prepareStep!({
      steps: [{ toolCalls: [{ toolName: 'read_file', input: { path: '/tmp/x' } }] }],
      messages: [],
    });

    expect(result?.messages).toHaveLength(1);
    expect((result?.messages![0] as { role: string; content: string }).content).toContain(
      'create a plan first'
    );
  });

  it('injects execution instruction when plan is found', () => {
    const prepareStep = createPlanThenExecutePrepareStep(['plan']);

    const result = prepareStep!({
      steps: [
        {
          toolCalls: [
            {
              toolName: 'plan',
              input: {
                steps: [
                  {
                    id: 'analyze',
                    description: 'Analyze the code',
                    expectedOutput: 'Findings',
                  },
                ],
                overallStrategy: 'Understand first, then act.',
              },
            },
          ],
        },
      ],
      messages: [{ role: 'user', content: 'existing' }],
    });

    expect(result?.messages).toHaveLength(2); // existing + execution instruction
    const added = result?.messages![1] as { role: string; content: string };
    expect(added.role).toBe('user');
    expect(added.content).toContain('Now execute the plan');
    expect(added.content).toContain('analyze');
    expect(added.content).toContain('Understand first, then act.');
  });

  it('returns undefined on subsequent steps when plan has not changed', () => {
    const prepareStep = createPlanThenExecutePrepareStep(['plan']);

    const step = {
      toolCalls: [
        {
          toolName: 'plan',
          input: {
            steps: [{ id: 's', description: 'Step', expectedOutput: 'Result' }],
            overallStrategy: 'Do it.',
          },
        },
      ],
    };

    // First time plan is seen
    const first = prepareStep!({ steps: [step], messages: [] });
    expect(first).toBeDefined();
    expect(first?.messages?.length).toBe(1);

    // Same plan again — should return undefined
    const second = prepareStep!({ steps: [step], messages: [] });
    expect(second).toBeUndefined();
  });

  it('injects execution instruction again when plan is revised', () => {
    const prepareStep = createPlanThenExecutePrepareStep(['plan']);

    const plan1 = {
      toolCalls: [
        {
          toolName: 'plan',
          input: {
            steps: [{ id: 'a', description: 'Step A', expectedOutput: 'Result A' }],
            overallStrategy: 'Version 1.',
          },
        },
      ],
    };

    const plan2 = {
      toolCalls: [
        {
          toolName: 'plan',
          input: {
            steps: [
              { id: 'a', description: 'Step A revised', expectedOutput: 'Result A revised' },
              { id: 'b', description: 'Step B added', expectedOutput: 'Result B' },
            ],
            overallStrategy: 'Version 2.',
          },
        },
      ],
    };

    // First plan
    const first = prepareStep!({ steps: [plan1], messages: [] });
    expect(first).toBeDefined();
    expect((first?.messages![0] as { content: string }).content).toContain('Version 1');

    // Revised plan in a later step (plan1 then plan2)
    const second = prepareStep!({
      steps: [plan1, plan2],
      messages: [],
    });
    expect(second).toBeDefined();
    expect((second?.messages![0] as { content: string }).content).toContain('Version 2');
    expect((second?.messages![0] as { content: string }).content).toContain('Step A revised');
    expect((second?.messages![0] as { content: string }).content).toContain('Step B added');
  });

  it('finds the latest plan when multiple plan calls exist in steps', () => {
    const prepareStep = createPlanThenExecutePrepareStep(['plan']);

    // Steps 0-2, with plan in step 0, then a revision in step 2.  Step 1 has no plan.
    // We call prepareStep directly with all 3 steps populated — simulating
    // the state right before the 4th step would fire.
    const result = prepareStep!({
      steps: [
        {
          toolCalls: [
            {
              toolName: 'plan',
              input: {
                steps: [{ id: 'old', description: 'Old', expectedOutput: 'Old' }],
                overallStrategy: 'Original.',
              },
            },
          ],
        },
        { toolCalls: [{ toolName: 'read_file', input: { path: '/x' } }] },
        {
          toolCalls: [
            {
              toolName: 'plan',
              input: {
                steps: [{ id: 'new', description: 'New', expectedOutput: 'New' }],
                overallStrategy: 'Revised.',
              },
            },
          ],
        },
      ],
      messages: [],
    });

    expect(result).toBeDefined();
    expect((result?.messages![0] as { content: string }).content).toContain('Revised');
    expect((result?.messages![0] as { content: string }).content).toContain('new');
    // Should NOT contain the old plan content
    expect((result?.messages![0] as { content: string }).content).not.toContain('Original');
  });

  it('preserves existing messages when injecting instructions', () => {
    const prepareStep = createPlanThenExecutePrepareStep(['plan']);

    const existingMessages = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'User message' },
    ];

    const result = prepareStep!({
      steps: [],
      messages: existingMessages,
    });

    expect(result?.messages).toHaveLength(3); // 2 existing + 1 injected
    expect(result?.messages![0]).toEqual(existingMessages[0]);
    expect(result?.messages![1]).toEqual(existingMessages[1]);
    expect((result?.messages![2] as { role: string }).role).toBe('user');
  });
});
