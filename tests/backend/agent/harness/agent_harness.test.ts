import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

import { AgentHarness } from '@iki/backend/agent/harness';
import type { TurnEvent, TurnOutput } from '@iki/backend/agent/harness/harness_types';
import { FauxModelProvider, fauxText, fauxToolCall } from '@iki/backend/agent/testing/faux_model';
import { createTool } from '@iki/core/tools';

// ── Helpers ──────────────────────────────────────────────────────────

async function drainTurn(
  harness: AgentHarness,
  prompt: string,
  opts?: { toolsOverride?: Parameters<AgentHarness['turn']>[0]['toolsOverride'] },
): Promise<{ events: TurnEvent[]; output: TurnOutput }> {
  const events: TurnEvent[] = [];
  let output: TurnOutput | undefined;
  for await (const event of harness.turn({ prompt, ...opts })) {
    events.push(event);
    if (event.event === 'done') output = event.output;
  }
  return { events, output: output! };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('AgentHarness', () => {
  it('completes a text-only turn', async () => {
    const faux = new FauxModelProvider([fauxText('Hello, world!')]);
    const harness = new AgentHarness({
      providerType: 'faux',
      model: 'faux-model',
      systemPrompt: 'You are a test agent.',
      enableTools: false,
      enabledToolNames: [],
      availableSkillIds: [],
      guardActive: false,
      maxIterations: 1,
      modelFactory: () => faux,
    });

    const { events, output } = await drainTurn(harness, 'Say hello');

    // Should have message_update step(s) + done event
    const steps = events.filter(e => e.event === 'step');
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.some(s => s.step.type === 'message_update')).toBe(true);

    // Final output
    expect(output.text).toBe('Hello, world!');
    expect(output.requiresApproval).toBe(false);
  });

  it('completes a tool-call turn', async () => {
    const echoTool = createTool({
      name: 'echo',
      type: 'function',
      description: 'Echoes input',
      paramSchema: z.object({ text: z.string() }),
      handler: async (args: { text: string }) => `Echo: ${args.text}`,
    });

    const faux = new FauxModelProvider([
      fauxToolCall('echo', { text: 'test' }, { textBefore: 'Let me echo.' }),
      fauxText('Done.'),
    ]);

    const harness = new AgentHarness({
      providerType: 'faux',
      model: 'faux-model',
      systemPrompt: 'Test agent.',
      enableTools: true,
      enabledToolNames: [],
      availableSkillIds: [],
      guardActive: false,
      maxIterations: 10,
      modelFactory: () => faux,
    });

    const { events, output } = await drainTurn(harness, 'Echo test', { toolsOverride: [echoTool] });

    const types = events.filter(e => e.event === 'step').map(e => e.step.type);
    expect(types).toContain('tool_execution_start');
    expect(types).toContain('tool_execution_end');
    expect(types).toContain('message_update');

    // Verify text content from message_update steps
    const texts = events
      .filter(e => e.event === 'step' && e.step.type === 'message_update')
      .map(e => (e.step as { text: string }).text)
      .join('');
    expect(texts).toContain('Done');
    expect(output.requiresApproval).toBe(false);
  });

  it('detects handoff and includes handoff data in output', async () => {
    const handoffTool = createTool({
      name: 'handoff',
      type: 'function',
      description: 'Hand off',
      paramSchema: z.object({
        summary: z.string(),
        next_steps: z.string(),
        reason: z.string(),
      }),
      handler: async () => 'handoff initiated',
    });

    const faux = new FauxModelProvider([
      fauxToolCall('handoff', {
        summary: 'Research done',
        next_steps: 'Write report',
        reason: 'delegation',
      }),
      fauxText('Handing off.'),
    ]);

    const harness = new AgentHarness({
      providerType: 'faux',
      model: 'faux-model',
      systemPrompt: 'Test agent.',
      enableTools: true,
      enabledToolNames: ['handoff'],
      availableSkillIds: [],
      guardActive: false,
      maxIterations: 3,
      modelFactory: () => faux,
    });

    const { events, output } = await drainTurn(harness, 'Research then handoff');

    const handoffSteps = events.filter(e => e.event === 'step' && e.step.type === 'handoff');
    expect(handoffSteps.length).toBe(1);

    expect(output.handoff).toBeDefined();
    expect(output.handoff!.summary).toBe('Research done');
    expect(output.handoff!.nextSteps).toBe('Write report');
  });

  it('tracks history across turns', async () => {
    const faux = new FauxModelProvider([
      fauxText('First response.'),
      fauxText('Second response.'),
    ]);

    const harness = new AgentHarness({
      providerType: 'faux',
      model: 'faux-model',
      systemPrompt: 'Test agent.',
      enableTools: false,
      enabledToolNames: [],
      availableSkillIds: [],
      guardActive: false,
      maxIterations: 1,
      modelFactory: () => faux,
    });

    await drainTurn(harness, 'First message');
    const history = harness.getHistory();
    expect(history.length).toBeGreaterThan(0);

    await drainTurn(harness, 'Second message');
    const history2 = harness.getHistory();
    expect(history2.length).toBeGreaterThan(history.length);
  });

  it('accepts runTracker from caller and exposes via getRunTracker', async () => {
    const faux = new FauxModelProvider([fauxText('ok')]);
    const harness = new AgentHarness({
      providerType: 'faux',
      model: 'faux-model',
      systemPrompt: 'Test agent.',
      enableTools: false,
      enabledToolNames: [],
      availableSkillIds: [],
      guardActive: false,
      maxIterations: 1,
      modelFactory: () => faux,
    });

    const mockTracker = {
      id: 'mock-run-id',
      syncModelMessages: vi.fn(),
    } as any;

    const events: TurnEvent[] = [];
    for await (const event of harness.turn({ prompt: 'test', runTracker: mockTracker })) {
      events.push(event);
    }

    // runTracker should be the one we passed in
    expect(harness.getRunTracker()).toBe(mockTracker);
    expect(mockTracker.syncModelMessages).toHaveBeenCalled();

    // Default: null when not provided
    const harness2 = new AgentHarness({
      providerType: 'faux',
      model: 'faux-model',
      systemPrompt: 'Test agent.',
      enableTools: false,
      enabledToolNames: [],
      availableSkillIds: [],
      guardActive: false,
      maxIterations: 1,
      modelFactory: () => faux,
    });
    expect(harness2.getRunTracker()).toBeNull();
  });
});
