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

    const textDeltas = steps.filter(s => s.type === 'text-delta');
    expect(textDeltas.map(s => (s as { text: string }).text).join('')).toBe('Hello, world!');

    expect(result).toBeDefined();
    expect((result as Record<string, unknown>)?.response).toBe('Hello, world!');
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
    expect(types).toContain('text-delta');
    expect(types).toContain('tool-call-start');
    expect(types).toContain('tool-result');
  });
});
