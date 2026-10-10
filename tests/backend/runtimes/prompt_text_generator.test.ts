import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  generateChatWithModelMessagesMock,
  getModelGenerationSettingsMock,
  resolvePersonaPromptMock,
  getAppConfigMock,
} =
  vi.hoisted(() => ({
    generateChatWithModelMessagesMock: vi.fn(),
    getModelGenerationSettingsMock: vi.fn(() => ({})),
    resolvePersonaPromptMock: vi.fn(),
    getAppConfigMock: vi.fn(),
  }));

vi.mock('@iki/backend/provider/llm/factory', async importOriginal => {
  const actual = await importOriginal<typeof import('@iki/backend/provider/llm/factory')>();
  return {
    ...actual,
    generateChatWithModelMessages: generateChatWithModelMessagesMock,
    getModelGenerationSettings: getModelGenerationSettingsMock,
    // buildPromptContext (ai_sdk_runtime) composes the runtime's system from
    // this — the persona comes from the RUNTIME's own join, not the factory.
    resolvePersonaPrompt: resolvePersonaPromptMock,
  };
});

vi.mock('@iki/backend/config', () => ({
  getAppConfig: getAppConfigMock,
}));

import { createSimplePromptTextGenerator } from '@iki/backend/runtimes/prompt_text_generator';

beforeEach(() => {
  vi.clearAllMocks();
  getModelGenerationSettingsMock.mockImplementation(
    ({ temperature }: { temperature?: number }) =>
      typeof temperature === 'number' ? { temperature } : {}
  );
  resolvePersonaPromptMock.mockReturnValue('persona prompt');
  getAppConfigMock.mockImplementation(() => {
    throw new Error('app config should not be loaded');
  });
});

describe('SimplePromptTextGenerator', () => {
  it('routes through the factory entry with its own system as the exact override (#126)', async () => {
    generateChatWithModelMessagesMock.mockResolvedValue({ text: 'generated text' });

    const generator = createSimplePromptTextGenerator({
      enabled: true,
      providerType: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'system prompt',
      temperature: 0.4,
      maxTokens: 256,
      enableTools: false,
    });

    await expect(generator.generate('hello')).resolves.toEqual({ response: 'generated text' });

    // The runtimes own their request shape: the composed system prompt (the
    // runtime's own persona join + its system prompt) rides as the EXACT
    // override — the factory's persona-led join is not applied ON TOP. The
    // direct AI SDK construction is gone; the factory decides the supply.
    // (The file-level factory mock only replaces the entry — a leftover
    // `createModel` import would throw here.)
    expect(generateChatWithModelMessagesMock).toHaveBeenCalledTimes(1);
    const options = generateChatWithModelMessagesMock.mock.calls[0][0] as Record<string, unknown>;
    expect(options.providerType).toBe('openai');
    expect(options.modelId).toBe('gpt-4o-mini');
    expect(options.systemPromptOverride).toContain('system prompt');
    expect(options.systemPromptOverride).toContain('persona prompt');
    expect(options.temperature).toBe(0.4);
    expect(options.maxOutputTokens).toBe(256);
    expect(options.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('forwards threadId and abortSignal and drops absent optionals', async () => {
    generateChatWithModelMessagesMock.mockResolvedValue({ text: 'ok' });
    const controller = new AbortController();

    const generator = createSimplePromptTextGenerator({
      enabled: true,
      providerType: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'system prompt',
      enableTools: false,
      threadId: 'thread_1',
    });

    await generator.generate('hello', controller.signal);

    const options = generateChatWithModelMessagesMock.mock.calls[0][0] as Record<string, unknown>;
    expect(options.threadId).toBe('thread_1');
    expect(options.abortSignal).toBe(controller.signal);
    // loadAgentConfig's default temperature (0.1) flows through — configured
    // values win, defaults fill in.
    expect(options.temperature).toBe(0.1);
    expect(options.providerOptions).toBeUndefined();
    // loadAgentConfig's default maxTokens (2000) flows through as well.
    expect(options.maxOutputTokens).toBe(2000);
  });

  it('propagates factory failures', async () => {
    generateChatWithModelMessagesMock.mockRejectedValue(new Error('provider down'));
    const generator = createSimplePromptTextGenerator({
      enabled: true,
      providerType: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'system prompt',
      enableTools: false,
    });
    await expect(generator.generate('hello')).rejects.toThrow('provider down');
  });
});
