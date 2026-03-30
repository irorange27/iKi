import { describe, expect, it, vi } from 'vitest';

import { LlmMemoryRetrievalRuntime } from '../../../src/core/runtimes/memory_retrieval_runtime';

describe('LlmMemoryRetrievalRuntime', () => {
  it('returns null when no tool model is available', async () => {
    const runtime = new LlmMemoryRetrievalRuntime({
      getToolModel: () => null,
      createGenerator: vi.fn(),
    });

    await expect(runtime.run('remember my editor preferences')).resolves.toBeNull();
  });

  it('parses a rewritten retrieval query from model output', async () => {
    const generate = vi.fn().mockResolvedValue({
      response: '{"shouldSearch":true,"query":"typescript repo lint constraints"}',
    });
    const createGenerator = vi.fn(() => ({ generate }));

    const runtime = new LlmMemoryRetrievalRuntime({
      getToolModel: () => ({ providerType: 'openai', model: 'gpt-4o-mini' }),
      createGenerator,
    });

    await expect(runtime.run('What should I keep in mind for this TypeScript repo?')).resolves.toEqual(
      {
        shouldSearch: true,
        query: 'typescript repo lint constraints',
        source: 'tool-model',
        providerType: 'openai',
        model: 'gpt-4o-mini',
        inputChars: 52,
        truncated: false,
      }
    );

    expect(createGenerator).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: 'openai',
        model: 'gpt-4o-mini',
        maxIterations: 1,
        enableTools: false,
      })
    );
    expect(generate).toHaveBeenCalledWith(
      expect.stringContaining('<latest_user_request>\nWhat should I keep in mind for this TypeScript repo?\n</latest_user_request>')
    );
  });

  it('lets the planner suppress irrelevant memory retrieval', async () => {
    const runtime = new LlmMemoryRetrievalRuntime({
      getToolModel: () => ({ providerType: 'openai', model: 'gpt-4o-mini' }),
      createGenerator: () => ({
        generate: vi.fn().mockResolvedValue({
          response: '{"shouldSearch":false,"query":""}',
        }),
      }),
    });

    await expect(runtime.run('thanks')).resolves.toEqual({
      shouldSearch: false,
      query: '',
      source: 'tool-model',
      providerType: 'openai',
      model: 'gpt-4o-mini',
      inputChars: 6,
      truncated: false,
    });
  });

  it('truncates oversized inputs before calling the model', async () => {
    const generate = vi.fn().mockResolvedValue({
      response: '{"shouldSearch":true,"query":"durable task context"}',
    });

    const runtime = new LlmMemoryRetrievalRuntime({
      getToolModel: () => ({ providerType: 'openai', model: 'gpt-4o-mini' }),
      createGenerator: () => ({ generate }),
    });

    const oversized = 'a'.repeat(2105);
    const result = await runtime.run(oversized);

    expect(generate).toHaveBeenCalledWith(
      `<latest_user_request>\n${'a'.repeat(2000)}\n</latest_user_request>`
    );
    expect(result?.inputChars).toBe(2105);
    expect(result?.truncated).toBe(true);
  });

  it('returns null when the model response cannot be parsed', async () => {
    const runtime = new LlmMemoryRetrievalRuntime({
      getToolModel: () => ({ providerType: 'openai', model: 'gpt-4o-mini' }),
      createGenerator: () => ({
        generate: vi.fn().mockResolvedValue({ response: 'not-json' }),
      }),
    });

    await expect(runtime.run('remember my preferences')).resolves.toBeNull();
  });
});
