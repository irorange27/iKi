import { describe, expect, it, vi } from 'vitest';

import { LlmTitleRuntime, sanitizeGeneratedTitle } from '@iki/backend/runtimes/title_runtime';

describe('sanitizeGeneratedTitle', () => {
  it('strips quotes and collapses newlines', () => {
    expect(sanitizeGeneratedTitle(' "Agent tools\nsummary" ')).toBe('Agent tools summary');
  });

  it('truncates long titles', () => {
    const longTitle = 'a'.repeat(80);
    expect(sanitizeGeneratedTitle(longTitle)).toBe(`${'a'.repeat(57)}...`);
  });
});

describe('LlmTitleRuntime', () => {
  it('returns null when no tool model is available', async () => {
    const runtime = new LlmTitleRuntime({
      getToolModel: () => null,
      createGenerator: vi.fn(),
    });

    await expect(runtime.run('conversation')).resolves.toBeNull();
  });

  it('sanitizes the generated title', async () => {
    const generate = vi.fn().mockResolvedValue({
      response: '  "Title with\nline break"  ',
    });
    const createGenerator = vi.fn(() => ({ generate }));
    const runtime = new LlmTitleRuntime({
      getToolModel: () => ({ providerType: 'openai', model: 'gpt-4o-mini' }),
      createGenerator,
    });

    await expect(runtime.run('conversation text')).resolves.toBe('Title with line break');
    expect(createGenerator).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: 'openai',
        model: 'gpt-4o-mini',
        enableTools: false,
        maxIterations: 1,
      })
    );
    expect(generate).toHaveBeenCalledWith(
      expect.stringContaining('<transcript>\nconversation text\n</transcript>')
    );
  });
});
