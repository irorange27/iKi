import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  generateTextMock,
  createModelMock,
  disposeLanguageModelMock,
  getModelGenerationSettingsMock,
  getFullSystemPromptMock,
  getAppConfigMock,
} =
  vi.hoisted(() => ({
    generateTextMock: vi.fn(),
    createModelMock: vi.fn(),
    disposeLanguageModelMock: vi.fn(),
    getModelGenerationSettingsMock: vi.fn(() => ({})),
    getFullSystemPromptMock: vi.fn(),
    getAppConfigMock: vi.fn(),
  }));

vi.mock('ai', () => ({
  generateText: generateTextMock,
}));

vi.mock('@iki/core/provider/llm/factory', () => ({
  createModel: createModelMock,
  disposeLanguageModel: disposeLanguageModelMock,
  getModelGenerationSettings: getModelGenerationSettingsMock,
  getFullSystemPrompt: getFullSystemPromptMock,
}));

vi.mock('@iki/core/config', () => ({
  getAppConfig: getAppConfigMock,
}));

import { createSimplePromptTextGenerator } from '@iki/core/runtimes/prompt_text_generator';

beforeEach(() => {
  vi.clearAllMocks();
  createModelMock.mockReturnValue('mock-model');
  getModelGenerationSettingsMock.mockImplementation(
    ({ temperature }: { temperature?: number }) =>
      typeof temperature === 'number' ? { temperature } : {}
  );
  getFullSystemPromptMock.mockReturnValue('persona prompt');
  getAppConfigMock.mockImplementation(() => {
    throw new Error('app config should not be loaded');
  });
});

describe('SimplePromptTextGenerator', () => {
  it('generates text directly through AI SDK with composed system prompt and user message', async () => {
    generateTextMock.mockResolvedValue({
      text: 'generated text',
    });

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

    expect(createModelMock).toHaveBeenCalledWith('openai', 'gpt-4o-mini', '');
    expect(generateTextMock).toHaveBeenCalledWith({
      model: 'mock-model',
      system: 'persona prompt\n\nsystem prompt',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.4,
      maxOutputTokens: 256,
    });
    expect(disposeLanguageModelMock).toHaveBeenCalledWith('mock-model');
    expect(getAppConfigMock).toHaveBeenCalled();
  });
});
