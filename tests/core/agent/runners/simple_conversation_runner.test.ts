import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/core/iki_simple_agent', () => ({
  SimpleAgent: vi.fn(),
}));

import { SimpleAgent } from '../../../../src/core/iki_simple_agent';
import { createSimpleConversationRunner } from '../../../../src/core/agent';

const SimpleAgentMock = vi.mocked(SimpleAgent);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SimpleConversationRunner', () => {
  it('creates a SimpleAgent with the provided config and delegates methods', async () => {
    const registerTool = vi.fn();
    const setMessages = vi.fn();
    const generate = vi.fn().mockResolvedValue({ response: 'done', iterations: 1 });
    const stream = vi.fn().mockReturnValue(
      (async function* () {
        yield 'chunk';
        return { response: 'done', iterations: 1 };
      })()
    );

    SimpleAgentMock.mockImplementation(
      function MockSimpleAgent() {
        return {
          registerTool,
          setMessages,
          generate,
          stream,
        } as unknown as InstanceType<typeof SimpleAgent>;
      } as unknown as (...args: unknown[]) => InstanceType<typeof SimpleAgent>
    );

    const runner = createSimpleConversationRunner({
      enabled: true,
      providerType: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'system',
      enableTools: true,
    });

    const tool = {
      name: 'web',
      description: 'Search the web',
      parameters: {},
      handler: vi.fn(),
    };
    const messages = [{ role: 'system' as const, content: 'hello' }];

    runner.registerTool(tool);
    runner.setModelMessages(messages);
    await expect(runner.generate('prompt')).resolves.toEqual({ response: 'done', iterations: 1 });
    const generator = runner.stream('prompt', {
      approvalResponses: [],
      onStreamPart: vi.fn(),
      abortSignal: new AbortController().signal,
    });
    await generator.next();

    expect(SimpleAgentMock).toHaveBeenCalledWith({
      enabled: true,
      providerType: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'system',
      enableTools: true,
    });
    expect(registerTool).toHaveBeenCalledWith(tool);
    expect(setMessages).toHaveBeenCalledWith([
      expect.objectContaining({
        role: 'system',
        content: 'hello',
      }),
    ]);
    expect(generate).toHaveBeenCalledWith('prompt');
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream).toHaveBeenCalledWith(
      'prompt',
      [],
      expect.any(Function),
      expect.any(AbortSignal)
    );
  });
});
