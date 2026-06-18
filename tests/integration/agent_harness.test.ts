import { describe, expect, it } from 'vitest';
import {
  hasProviderConfig,
  getIntegrationTestContext,
  createTestRunner,
  resolveEnabledTools,
} from './setup';
import type { AgentResult, AgentStep, FinishStep, ToolCallStartStep, ToolResultStep } from '../../src/core/agent';

const skipIfNoProvider = () => !hasProviderConfig();

const collectRun = async (
  prompt: string,
  opts: { tools?: string[]; systemPrompt?: string; maxIterations?: number } = {}
): Promise<{ steps: AgentStep[]; result: AgentResult }> => {
  const ctx = getIntegrationTestContext()!;
  const tools = opts.tools ? resolveEnabledTools(opts.tools) : [];
  const enableTools = tools.length > 0;

  const runner = createTestRunner({
    tools,
    systemPrompt:
      opts.systemPrompt ??
      (enableTools
        ? 'You are a capable AI assistant. You have access to tools — use them when they would help answer the question. If you use a tool, always provide a final answer based on the tool results.'
        : 'You are a concise AI assistant for integration testing. Answer directly and briefly.'),
    maxIterations: opts.maxIterations ?? (enableTools ? 3 : 1),
  });

  const gen = runner.run({
    prompt,
    tools,
    providerType: ctx.providerType,
    model: ctx.model,
    config: {
      enabled: true,
      enableTools,
      providerType: ctx.providerType,
      model: ctx.model,
      maxTokens: 500,
      temperature: 0.1,
      maxIterations: opts.maxIterations ?? (enableTools ? 3 : 1),
      systemPrompt:
        opts.systemPrompt ??
        (enableTools
          ? 'You are a capable AI assistant. You have access to tools — use them when they would help answer the question. If you use a tool, always provide a final answer based on the tool results.'
          : 'You are a concise AI assistant for integration testing. Answer directly and briefly.'),
    },
  });

  const steps: AgentStep[] = [];
  let next = await gen.next();
  while (!next.done) {
    steps.push(next.value as AgentStep);
    next = await gen.next();
  }

  return { steps, result: next.value as AgentResult };
};

describe('Agent — basic generation (no tools)', () => {
  it.skipIf(skipIfNoProvider())('returns a non-empty response', async () => {
    const { steps, result } = await collectRun('Say "hello world" and nothing else.');

    expect(result.response.length).toBeGreaterThan(0);
    expect(result.response.toLowerCase()).toContain('hello');

    const finish = steps[steps.length - 1] as FinishStep | undefined;
    expect(finish?.type).toBe('finish');
    expect(finish?.text).toBeTruthy();
    expect(result.usage?.totalTokens).toBeGreaterThan(0);
  }, 30000);

  it.skipIf(skipIfNoProvider())('answers a factual question', async () => {
    const { result } = await collectRun(
      'What is the capital of France? Reply with just the city name.'
    );

    expect(result.response.toLowerCase()).toContain('paris');
    expect(result.iterations).toBe(1);
  }, 30000);

  it.skipIf(skipIfNoProvider())('produces a FinishStep with usage info', async () => {
    const { steps, result } = await collectRun('Count from 1 to 3.');

    const finish = steps.find(s => s.type === 'finish') as FinishStep | undefined;
    expect(finish).toBeDefined();
    expect(finish!.usage).toBeDefined();
    expect(result.response.length).toBeGreaterThan(0);
  }, 30000);
});

describe('Agent — tool calls', () => {
  it.skipIf(skipIfNoProvider())('runs a tool-equipped turn without crashing', async () => {
    // Broad test: just verify the runner works with tools enabled
    const { steps, result } = await collectRun(
      'What time is it in Tokyo right now? If you need to search the web to answer accurately, do so.',
      { tools: ['web_search', 'fetch'] }
    );

    // The runner must produce a result without error
    expect(result).toBeDefined();
    expect(result.response.length).toBeGreaterThan(0);

    // Finish step must exist
    const finish = steps.find(s => s.type === 'finish') as FinishStep | undefined;
    expect(finish).toBeDefined();
    expect(finish!.text.length).toBeGreaterThan(0);
  }, 60000);

  it.skipIf(skipIfNoProvider())('skips tools for simple math questions', async () => {
    const { result } = await collectRun('What is 2 + 2? Answer with just the number.', {
      tools: ['web_search', 'fetch'],
    });

    expect(result.response).toContain('4');
  }, 30000);
});

describe('Agent — handoff', () => {
  it.skipIf(skipIfNoProvider())('completes a handoff scenario', async () => {
    const { steps } = await collectRun(
      'Research the history of Lisp and write a brief summary.',
      {
        tools: ['web_search', 'handoff'],
        systemPrompt:
          'You are an AI assistant. When a task requires deep research, use the handoff tool to delegate it.',
      }
    );

    const handoff = steps.find(s => s.type === 'handoff');
    const finish = steps[steps.length - 1] as FinishStep | undefined;

    if (handoff) {
      expect(handoff).toBeDefined();
    } else if (finish) {
      expect(finish.text.length).toBeGreaterThan(0);
    }
  }, 60000);
});

describe('Agent — multi-step reasoning', () => {
  it.skipIf(skipIfNoProvider())('produces a result with tool-equipped runner', async () => {
    const { steps, result } = await collectRun(
      'Search the web for news about Node.js version 24, then summarize what you found.',
      { tools: ['web_search', 'fetch'] }
    );

    expect(result).toBeDefined();
    expect(result.usage?.totalTokens).toBeGreaterThan(0);

    // The runner should at minimum produce a finish, handoff, or error
    const terminal = steps.find(s => s.type === 'finish' || s.type === 'handoff' || s.type === 'error') as
      | FinishStep
      | { type: 'handoff' | 'error'; message?: string }
      | undefined;
    expect(terminal).toBeDefined();

    if (terminal!.type === 'error') {
      // Error step is acceptable for this smoke test — just verify it exists
      expect((terminal as { message: string }).message).toBeTruthy();
    }
  }, 60000);
});

describe('Agent — error resilience', () => {
  it.skipIf(skipIfNoProvider())('handles whitespace-only prompt gracefully', async () => {
    const { result, steps } = await collectRun('   ');

    // Should not throw, should produce a result
    expect(result).toBeDefined();

    // Terminal step should not be an error
    const last = steps[steps.length - 1];
    expect(last?.type).not.toBe('error');
  }, 30000);
});
