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
    resolvePersonaPrompt: resolvePersonaPromptMock,
  };
});

vi.mock('@iki/backend/config', () => ({
  getAppConfig: getAppConfigMock,
}));

import { generatePromptText } from '@iki/backend/runtimes/prompt_text_generator';

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

describe('generatePromptText', () => {
  it('routes through the factory entry with its own system as the exact override (#126)', async () => {
    generateChatWithModelMessagesMock.mockResolvedValue({ text: 'generated text' });

    await expect(
      generatePromptText(
        {
          enabled: true,
          providerType: 'openai',
          model: 'gpt-4o-mini',
          systemPrompt: 'system prompt',
          temperature: 0.4,
          maxTokens: 256,
          enableTools: false,
        },
        'hello'
      )
    ).resolves.toBe('generated text');

    expect(generateChatWithModelMessagesMock).toHaveBeenCalledTimes(1);
    const options = generateChatWithModelMessagesMock.mock.calls[0][0] as Record<string, unknown>;
    expect(options.providerType).toBe('openai');
    expect(options.modelId).toBe('gpt-4o-mini');
    expect(options.auxSystemInstruction).toContain('system prompt');
    expect(options.auxSystemInstruction).toContain('persona prompt');
    expect(options.temperature).toBe(0.4);
    expect(options.maxOutputTokens).toBe(256);
    expect(options.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('forwards threadId and abortSignal and drops absent optionals', async () => {
    generateChatWithModelMessagesMock.mockResolvedValue({ text: 'ok' });
    const controller = new AbortController();

    await generatePromptText(
      {
        enabled: true,
        providerType: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'system prompt',
        enableTools: false,
        threadId: 'thread_1',
      },
      'hello',
      controller.signal
    );

    const options = generateChatWithModelMessagesMock.mock.calls[0][0] as Record<string, unknown>;
    expect(options.threadId).toBe('thread_1');
    expect(options.abortSignal).toBe(controller.signal);
    expect(options.temperature).toBe(0.1);
    expect(options.providerOptions).toBeUndefined();
    expect(options.maxOutputTokens).toBe(2000);
  });

  it('propagates factory failures', async () => {
    generateChatWithModelMessagesMock.mockRejectedValue(new Error('provider down'));
    await expect(
      generatePromptText(
        {
          enabled: true,
          providerType: 'openai',
          model: 'gpt-4o-mini',
          systemPrompt: 'system prompt',
          enableTools: false,
        },
        'hello'
      )
    ).rejects.toThrow('provider down');
  });
});
