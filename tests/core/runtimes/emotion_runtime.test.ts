import { describe, expect, it, vi } from 'vitest';

import { LlmEmotionRuntime } from '../../../src/core/runtimes/emotion_runtime';

describe('LlmEmotionRuntime', () => {
  it('returns null when no tool model is available', async () => {
    const runtime = new LlmEmotionRuntime({
      getToolModel: () => null,
      createGenerator: vi.fn(),
    });

    await expect(runtime.run('hello')).resolves.toBeNull();
  });

  it('parses the model response into an emotion result', async () => {
    const generate = vi.fn().mockResolvedValue({
      response: '{"label":"joy","confidence":0.91,"valence":0.5,"arousal":0.2,"language":"en"}',
    });
    const createGenerator = vi.fn(() => ({ generate }));

    const runtime = new LlmEmotionRuntime({
      getToolModel: () => ({ providerType: 'openai', model: 'gpt-4o-mini' }),
      createGenerator,
    });

    await expect(runtime.run('hello there')).resolves.toEqual({
      label: 'joy',
      confidence: 0.91,
      valence: 0.5,
      arousal: 0.2,
      language: 'en',
      source: 'tool-model',
      providerType: 'openai',
      model: 'gpt-4o-mini',
      inputChars: 11,
      truncated: false,
    });

    expect(createGenerator).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: 'openai',
        model: 'gpt-4o-mini',
        maxIterations: 1,
        enableTools: false,
      })
    );
    expect(generate).toHaveBeenCalledWith('hello there');
  });

  it('truncates oversized inputs before calling the model', async () => {
    const generate = vi.fn().mockResolvedValue({
      response: '{"label":"neutral","confidence":0.4}',
    });

    const runtime = new LlmEmotionRuntime({
      getToolModel: () => ({ providerType: 'openai', model: 'gpt-4o-mini' }),
      createGenerator: () => ({ generate }),
    });

    const oversized = 'a'.repeat(2105);
    const result = await runtime.run(oversized);

    expect(generate).toHaveBeenCalledWith('a'.repeat(2000));
    expect(result?.inputChars).toBe(2105);
    expect(result?.truncated).toBe(true);
  });

  it('returns null when the model response cannot be parsed', async () => {
    const runtime = new LlmEmotionRuntime({
      getToolModel: () => ({ providerType: 'openai', model: 'gpt-4o-mini' }),
      createGenerator: () => ({
        generate: vi.fn().mockResolvedValue({ response: 'not-json' }),
      }),
    });

    await expect(runtime.run('hello')).resolves.toBeNull();
  });
});
