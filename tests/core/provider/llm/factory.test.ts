import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createAnthropicMock,
  createDeepSeekMock,
  createLoggerMock,
  createOpenAICompatibleMock,
  createOpenAIMock,
  fetchWithTimeoutMock,
  generateTextMock,
  getProvidersMock,
  getPersonaPromptMock,
  streamTextMock,
} = vi.hoisted(() => ({
  createAnthropicMock: vi.fn(),
  createDeepSeekMock: vi.fn(),
  createLoggerMock: vi.fn(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    event: vi.fn(),
  })),
  createOpenAICompatibleMock: vi.fn(),
  createOpenAIMock: vi.fn(),
  fetchWithTimeoutMock: vi.fn(),
  generateTextMock: vi.fn(),
  getProvidersMock: vi.fn(),
  getPersonaPromptMock: vi.fn(),
  streamTextMock: vi.fn(),
}));

vi.mock('ai', () => ({
  generateText: generateTextMock,
  streamText: streamTextMock,
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: createOpenAIMock,
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: createAnthropicMock,
}));

vi.mock('@ai-sdk/deepseek', () => ({
  createDeepSeek: createDeepSeekMock,
}));

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: createOpenAICompatibleMock,
}));

vi.mock('../../../../src/core/db/providers', () => ({
  getProviders: getProvidersMock,
}));

vi.mock('../../../../src/core/logger', () => ({
  createLogger: createLoggerMock,
}));

vi.mock('../../../../src/core/persona', () => ({
  getPersonaPrompt: getPersonaPromptMock,
}));

vi.mock('../../../../src/core/network/http', () => ({
  fetchWithTimeout: fetchWithTimeoutMock,
}));

import {
  createModel,
  fetchModelCapabilityFromDev,
  getModelCallSettings,
  getModelGenerationSettings,
  generateChatWithUsage,
  resolveModelCapability,
  streamChat,
  streamChatWithUsage,
} from '../../../../src/core/provider/llm/factory';

const createAsyncIterable = <T>(values: T[]) =>
  (async function* () {
    for (const value of values) {
      yield value;
    }
  })();

const createMockLanguageModel = () => ({
  specificationVersion: 'v3' as const,
  provider: 'anthropic',
  modelId: 'claude-sonnet-4-5',
  supportedUrls: {},
  doGenerate: vi.fn(),
  doStream: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
  getProvidersMock.mockReturnValue([
    {
      id: 'provider_openai',
      type: 'openai',
      enabled: true,
      api_key: 'sk-test',
      base_url: '',
      models: JSON.stringify(['gpt-4o-mini']),
    },
  ]);
  getPersonaPromptMock.mockReturnValue('persona prompt');
  createOpenAIMock.mockReturnValue(() => 'mock-model');
});

describe('llm factory', () => {
  it('instantiates OpenAI models through the OpenAI provider adapter', () => {
    const modelFactory = vi.fn(() => 'openai-model');
    createOpenAIMock.mockReturnValue(modelFactory);
    getProvidersMock.mockReturnValue([
      {
        id: 'provider_openai',
        type: 'openai',
        enabled: true,
        api_key: 'sk-live',
        base_url: 'https://api.openai.com/v1',
        models: JSON.stringify(['gpt-4.1']),
      },
    ]);

    expect(createModel('openai', 'gpt-4.1')).toBe('openai-model');
    expect(createOpenAIMock).toHaveBeenCalledWith({
      apiKey: 'sk-live',
      baseURL: 'https://api.openai.com/v1',
    });
    expect(modelFactory).toHaveBeenCalledWith('gpt-4.1');
    expect(createOpenAICompatibleMock).not.toHaveBeenCalled();
  });

  it('instantiates Anthropic models through the Anthropic provider adapter', () => {
    const anthropicModel = createMockLanguageModel();
    const modelFactory = vi.fn(() => anthropicModel);
    createAnthropicMock.mockReturnValue(modelFactory);
    getProvidersMock.mockReturnValue([
      {
        id: 'provider_anthropic',
        type: 'anthropic',
        enabled: true,
        api_key: 'sk-ant',
        base_url: 'https://api.anthropic.com/v1',
        models: JSON.stringify(['claude-sonnet-4-5']),
      },
    ]);

    expect(createModel('anthropic', 'claude-sonnet-4-5')).toBe(anthropicModel);
    expect(createAnthropicMock).toHaveBeenCalledWith({
      apiKey: 'sk-ant',
      baseURL: 'https://api.anthropic.com/v1',
    });
    expect(modelFactory).toHaveBeenCalledWith('claude-sonnet-4-5');
    expect(createOpenAICompatibleMock).not.toHaveBeenCalled();
  });

  it('routes custom response-api providers through the OpenAI responses adapter', () => {
    const responsesModel = 'responses-model';
    const responsesFactory = Object.assign(
      vi.fn(() => 'unused-chat-model'),
      {
        responses: vi.fn(() => responsesModel),
      }
    );
    createOpenAIMock.mockReturnValue(responsesFactory as never);
    getProvidersMock.mockReturnValue([
      {
        id: 'custom_gateway',
        type: 'openai-compatible',
        enabled: true,
        api_key: 'sk-gateway',
        base_url: 'https://gateway.example.com/v1',
        models: JSON.stringify(['gpt-4.1']),
        is_response_api: true,
      },
    ]);

    expect(createModel('openai-compatible', 'gpt-4.1')).toBe(responsesModel);
    expect(createOpenAIMock).toHaveBeenCalledWith({
      name: 'openai-compatible',
      apiKey: 'sk-gateway',
      baseURL: 'https://gateway.example.com/v1',
    });
    expect(responsesFactory.responses).toHaveBeenCalledWith('gpt-4.1');
    expect(createOpenAICompatibleMock).not.toHaveBeenCalled();
  });

  it('passes structured output support into OpenAI-compatible language model creation', () => {
    const languageModel = 'compatible-language-model';
    const compatibleFactory = Object.assign(
      vi.fn(() => 'unused-compatible-model'),
      {
        languageModel: vi.fn(() => languageModel),
      }
    );
    createOpenAICompatibleMock.mockReturnValue(compatibleFactory as never);
    getProvidersMock.mockReturnValue([
      {
        id: 'custom_gateway',
        type: 'openai-compatible',
        enabled: true,
        api_key: 'sk-gateway',
        base_url: 'https://gateway.example.com/v1',
        models: JSON.stringify(['gpt-5.4']),
        model_options: JSON.stringify({
          'gpt-5.4': {
            supportsStructuredOutputs: true,
          },
        }),
      },
    ]);

    expect(createModel('openai-compatible', 'gpt-5.4')).toBe(languageModel);
    expect(compatibleFactory.languageModel).toHaveBeenCalledWith('gpt-5.4', {
      supportsStructuredOutputs: true,
    });
  });

  it('rejects invalid anthropic adapter results at the runtime boundary', () => {
    createAnthropicMock.mockReturnValue(() => ({ provider: 'anthropic' }));
    getProvidersMock.mockReturnValue([
      {
        id: 'provider_anthropic',
        type: 'anthropic',
        enabled: true,
        api_key: 'sk-ant',
        base_url: 'https://api.anthropic.com/v1',
        models: JSON.stringify(['claude-sonnet-4-5']),
      },
    ]);

    expect(() => createModel('anthropic', 'claude-sonnet-4-5')).toThrow(
      'Anthropic provider returned an invalid language model'
    );
  });

  it('resolves model capabilities from models.dev metadata', async () => {
    fetchWithTimeoutMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          openai: {
            models: {
              'gpt-4o-mini': {
                name: 'GPT-4o mini',
                limit: {
                  context: 128000,
                  output: 16384,
                },
                tool_call: true,
                reasoning: false,
              },
            },
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        }
      )
    );

    await expect(fetchModelCapabilityFromDev('openai', 'gpt-4o-mini')).resolves.toEqual({
      providerType: 'openai',
      providerKey: 'openai',
      modelId: 'gpt-4o-mini',
      displayName: 'GPT-4o mini',
      contextWindow: 128000,
      maxInputTokens: 128000,
      maxOutputTokens: 16384,
      supportsToolCalls: true,
      supportsReasoning: false,
      source: 'models.dev',
    });
  });

  it('returns streamed text together with normalized usage', async () => {
    streamTextMock.mockReturnValue({
      fullStream: createAsyncIterable([
        { type: 'text-delta', text: 'hello ' },
        { type: 'text-delta', text: 'world' },
      ]),
      text: Promise.resolve('hello world'),
      totalUsage: Promise.resolve({
        inputTokens: 12,
        outputTokens: 5,
        totalTokens: 17,
      }),
    });

    const onChunk = vi.fn();
    await expect(
      streamChatWithUsage(
        {
          providerType: 'openai',
          modelId: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'hi' }],
          maxOutputTokens: 256,
        },
        onChunk
      )
    ).resolves.toEqual({
      text: 'hello world',
      usage: {
        inputTokens: 12,
        outputTokens: 5,
        totalTokens: 17,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        estimatedCostUsd: 0,
      },
    });

    expect(onChunk).toHaveBeenNthCalledWith(1, 'hello ');
    expect(onChunk).toHaveBeenNthCalledWith(2, 'world');
    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'mock-model',
        system: 'persona prompt',
        messages: [{ role: 'user', content: 'hi' }],
        maxOutputTokens: 256,
      })
    );
  });

  it('forwards max output tokens in non-stream generation calls', async () => {
    generateTextMock.mockResolvedValue({
      text: 'generated',
      usage: {
        inputTokens: 9,
        outputTokens: 4,
        totalTokens: 13,
      },
    });

    await expect(
      generateChatWithUsage({
        providerType: 'openai',
        modelId: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hi' }],
        maxOutputTokens: 384,
      })
    ).resolves.toEqual({
      text: 'generated',
      usage: {
        inputTokens: 9,
        outputTokens: 4,
        totalTokens: 13,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        estimatedCostUsd: 0,
      },
    });

    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'mock-model',
        system: 'persona prompt',
        messages: [{ role: 'user', content: 'hi' }],
        maxOutputTokens: 384,
      })
    );
  });

  it('keeps the legacy streamChat helper as a text-only wrapper', async () => {
    streamTextMock.mockReturnValue({
      fullStream: createAsyncIterable([]),
      text: Promise.resolve('fallback text'),
      totalUsage: Promise.resolve({
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
      }),
    });

    await expect(
      streamChat(
        {
          providerType: 'openai',
          modelId: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'hi' }],
        },
        vi.fn()
      )
    ).resolves.toBe('fallback text');
  });

  it('builds provider-scoped call settings from stored model options', () => {
    getProvidersMock.mockReturnValue([
      {
        id: 'provider_openai',
        type: 'openai',
        enabled: true,
        api_key: 'sk-test',
        base_url: '',
        models: JSON.stringify(['gpt-5.4']),
        model_options: JSON.stringify({
          'gpt-5.4': {
            providerOptions: {
              reasoningEffort: 'medium',
              parallelToolCalls: true,
            },
          },
        }),
      },
    ]);

    expect(getModelCallSettings('openai', 'gpt-5.4')).toEqual({
      providerOptions: {
        openai: {
          parallelToolCalls: true,
          reasoningEffort: 'medium',
        },
      },
    });
  });

  it('omits temperature for OpenAI reasoning-model calls while preserving provider options', () => {
    getProvidersMock.mockReturnValue([
      {
        id: 'provider_openai',
        type: 'openai',
        enabled: true,
        api_key: 'sk-test',
        base_url: '',
        models: JSON.stringify(['gpt-5.4']),
        model_options: JSON.stringify({
          'gpt-5.4': {
            providerOptions: {
              reasoningEffort: 'medium',
              parallelToolCalls: true,
            },
          },
        }),
      },
    ]);

    expect(
      getModelGenerationSettings({
        providerType: 'openai',
        modelId: 'gpt-5.4',
        temperature: 0.2,
      })
    ).toEqual({
      providerOptions: {
        openai: {
          parallelToolCalls: true,
          reasoningEffort: 'medium',
        },
      },
    });
  });

  it('omits temperature for custom responses-model calls even without explicit reasoning metadata', () => {
    getProvidersMock.mockReturnValue([
      {
        id: 'custom_gateway',
        type: 'openai-compatible',
        enabled: true,
        api_key: 'sk-gateway',
        base_url: 'https://gateway.example.com/v1',
        models: JSON.stringify(['gpt-5.4']),
        is_response_api: true,
      },
    ]);

    expect(
      getModelGenerationSettings({
        providerType: 'openai-compatible',
        providerId: 'custom_gateway',
        modelId: 'gpt-5.4',
        temperature: 0.2,
      })
    ).toEqual({});
  });

  it('keeps temperature when a compatible GPT-5 model explicitly disables reasoning effort', () => {
    getProvidersMock.mockReturnValue([
      {
        id: 'provider_openai',
        type: 'openai',
        enabled: true,
        api_key: 'sk-test',
        base_url: '',
        models: JSON.stringify(['gpt-5.2']),
        model_options: JSON.stringify({
          'gpt-5.2': {
            providerOptions: {
              reasoningEffort: 'none',
            },
          },
        }),
      },
    ]);

    expect(
      getModelGenerationSettings({
        providerType: 'openai',
        modelId: 'gpt-5.2',
        temperature: 0.2,
      })
    ).toEqual({
      providerOptions: {
        openai: {
          reasoningEffort: 'none',
        },
      },
      temperature: 0.2,
    });
  });

  it('merges stored provider model options over models.dev capability metadata', async () => {
    getProvidersMock.mockReturnValue([
      {
        id: 'provider_openai',
        type: 'openai',
        enabled: true,
        api_key: 'sk-test',
        base_url: '',
        models: JSON.stringify(['gpt-4o-mini']),
        model_options: JSON.stringify({
          'gpt-4o-mini': {
            contextWindow: 400000,
            supportsToolCalls: true,
            supportsReasoning: true,
          },
        }),
      },
    ]);

    await expect(resolveModelCapability('openai', 'gpt-4o-mini')).resolves.toEqual({
      providerType: 'openai',
      providerKey: 'openai',
      modelId: 'gpt-4o-mini',
      displayName: 'gpt-4o-mini',
      contextWindow: 400000,
      maxInputTokens: 400000,
      maxOutputTokens: 16384,
      supportsToolCalls: true,
      supportsReasoning: true,
      source: 'provider',
    });
  });
});
