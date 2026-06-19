import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createTool } from '@iki/core/tools';
import { createSimpleAgentRunner } from '@iki/backend/agent/runners/simple_agent_runner';
import { FauxModelProvider, fauxToolCall, fauxText } from '@iki/backend/agent/testing/faux_model';
import type { AgentStep } from '@iki/core/agent';

// ── Helpers ──────────────────────────────────────────────────────────

const echoTool = createTool({
  name: 'echo',
  type: 'function',
  description: 'Echoes back the input',
  paramSchema: z.object({ text: z.string() }),
  handler: async (args: { text: string }) => `Echo: ${args.text}`,
});

async function collectSteps(
  runner: ReturnType<typeof createSimpleAgentRunner>,
  prompt: string,
  tools?: Parameters<ReturnType<typeof createSimpleAgentRunner>['run']>[0]['tools'],
): Promise<{ steps: AgentStep[]; result?: unknown }> {
  const steps: AgentStep[] = [];
  const gen = runner.run({
    config: { enabled: true, enableTools: true, providerType: 'faux', model: 'faux-model', systemPrompt: 'You are a test agent.' },
    prompt,
    tools,
    providerType: 'faux',
    model: 'faux-model',
    systemPrompt: 'You are a test agent.',
  });

  let next = await gen.next();
  while (!next.done) {
    if (next.value) steps.push(next.value as AgentStep);
    next = await gen.next();
  }
  return { steps, result: next.value };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('agent turn with FauxModelProvider', () => {
  it('text-only response', async () => {
    const faux = new FauxModelProvider([fauxText('Hello, world!')]);
    const runner = createSimpleAgentRunner({
      enableTools: false,
      modelFactory: () => faux,
    });

    const { steps, result } = await collectSteps(runner, 'Say hello');

    const updates = steps.filter(s => s.type === 'message_update');
    expect(updates.map(s => (s as { text: string }).text).join('')).toBe('Hello, world!');

    expect(result).toBeDefined();
    expect((result as Record<string, unknown>)?.response).toBe('Hello, world!');
  });

  it('multi-turn tool chain (search → read → answer)', async () => {
    const searchTool = createTool({
      name: 'search',
      type: 'function',
      description: 'Search the web',
      paramSchema: z.object({ query: z.string() }),
      handler: async (args: { query: string }) => `Results for: ${args.query}`,
    });
    const readTool = createTool({
      name: 'read',
      type: 'function',
      description: 'Read a file',
      paramSchema: z.object({ path: z.string() }),
      handler: async (args: { path: string }) => `Contents of: ${args.path}`,
    });

    const faux = new FauxModelProvider([
      fauxToolCall('search', { query: 'best restaurant' }),
      fauxToolCall('read', { path: '/tmp/menu' }),
      fauxText('La Maison is the best restaurant.'),
    ]);
    const runner = createSimpleAgentRunner({
      enableTools: true,
      providerType: 'faux',
      model: 'faux-model',
      systemPrompt: 'Test agent.',
      modelFactory: () => faux,
    });

    const { steps } = await collectSteps(runner, 'Find the best restaurant', [searchTool, readTool]);

    const toolStarts = steps.filter(s => s.type === 'tool_execution_start');
    expect(toolStarts).toHaveLength(2);
    expect(toolStarts.map(s => (s as { toolName: string }).toolName)).toEqual(['search', 'read']);

    const updates = steps.filter(s => s.type === 'message_update');
    expect(updates.map(s => (s as { text: string }).text).join('')).toContain('La Maison');
  });

  it('yields handoff step when model calls handoff tool', async () => {
    const handoffTool = createTool({
      name: 'handoff',
      type: 'function',
      description: 'Hand off to another agent',
      paramSchema: z.object({
        summary: z.string(),
        next_steps: z.string(),
        reason: z.string(),
      }),
      handler: async () => 'handoff initiated',
    });

    const faux = new FauxModelProvider([
      fauxToolCall('handoff', { summary: 'Research done', next_steps: 'Write report', reason: 'delegation' }),
      fauxText('Handoff complete.'),
    ]);
    const runner = createSimpleAgentRunner({
      enableTools: true,
      providerType: 'faux',
      model: 'faux-model',
      systemPrompt: 'Test agent.',
      modelFactory: () => faux,
    });

    const { steps } = await collectSteps(runner, 'Research then handoff', [handoffTool]);

    const handoffStep = steps.find(s => s.type === 'handoff');
    expect(handoffStep).toBeDefined();
    expect((handoffStep as { summary: string }).summary).toBe('Research done');
    expect((handoffStep as { nextSteps: string }).nextSteps).toBe('Write report');

    // Should also complete normally after handoff
    const turnEnd = steps.find(s => s.type === 'turn_end');
    expect(turnEnd).toBeDefined();
  });

  it('tool call then text response (two-turn)', async () => {
    const faux = new FauxModelProvider([
      fauxToolCall('echo', { text: 'hello' }, { textBefore: 'Let me use echo.' }),
      fauxText('Got result: Echo: hello'),
    ]);
    const runner = createSimpleAgentRunner({
      enableTools: true,
      providerType: 'faux',
      model: 'faux-model',
      systemPrompt: 'Test agent.',
      modelFactory: () => faux,
    });

    const { steps } = await collectSteps(runner, 'Echo hello', [echoTool]);

    const types = steps.map(s => s.type);
    expect(types).toContain('message_update');
    expect(types).toContain('tool_execution_start');
    expect(types).toContain('tool_execution_end');
  });
});
