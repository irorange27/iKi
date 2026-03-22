import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createDeepSeekMock,
  createLoggerMock,
  createOpenAICompatibleMock,
  createOpenAIMock,
  fetchWithTimeoutMock,
  getProvidersMock,
  getPersonaPromptMock,
  streamTextMock,
} = vi.hoisted(() => ({
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
  getProvidersMock: vi.fn(),
  getPersonaPromptMock: vi.fn(),
  streamTextMock: vi.fn(),
}));

vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: streamTextMock,
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: createOpenAIMock,
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
  fetchModelCapabilityFromDev,
  streamChat,
  streamChatWithUsage,
} from '../../../../src/core/provider/llm/factory';

const createAsyncIterable = <T>(values: T[]) =>
  (async function* () {
    for (const value of values) {
      yield value;
    }
  })();

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
});
