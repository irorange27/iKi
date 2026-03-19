import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/iki_simple_agent', () => ({
  SimpleAgent: vi.fn(),
}));

import { SimpleAgent } from '../../../src/core/iki_simple_agent';
import { createSimplePromptTextGenerator } from '../../../src/core/runtimes/prompt_text_generator';

const SimpleAgentMock = vi.mocked(SimpleAgent);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SimplePromptTextGenerator', () => {
  it('delegates prompt generation to SimpleAgent', async () => {
    const generate = vi.fn().mockResolvedValue({ response: 'text' });

    SimpleAgentMock.mockImplementation(
      function MockSimpleAgent() {
        return {
          generate,
        } as unknown as InstanceType<typeof SimpleAgent>;
      } as unknown as (...args: unknown[]) => InstanceType<typeof SimpleAgent>
    );

    const generator = createSimplePromptTextGenerator({
      enabled: true,
      providerType: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'system',
      enableTools: false,
    });

    await expect(generator.generate('hello')).resolves.toEqual({ response: 'text' });
    expect(SimpleAgentMock).toHaveBeenCalledWith({
      enabled: true,
      providerType: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'system',
      enableTools: false,
    });
    expect(generate).toHaveBeenCalledWith('hello');
  });
});
