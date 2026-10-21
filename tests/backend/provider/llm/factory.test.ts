import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createLoggerMock,
  ensureThreadWorkspaceSelectionMock,
  fetchWithTimeoutMock,
  getProviderMock,
  getProvidersMock,
  getPersonaPromptMock,
  getToolRuntimeContextMock,
  getUserDataPathMock,
  listMcpServersMock,
} = vi.hoisted(() => ({
  createLoggerMock: vi.fn(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    event: vi.fn(),
  })),
  ensureThreadWorkspaceSelectionMock: vi.fn(() => null),
  fetchWithTimeoutMock: vi.fn(),
  getProviderMock: vi.fn(() => null),
  getProvidersMock: vi.fn(),
  getPersonaPromptMock: vi.fn(),
  getToolRuntimeContextMock: vi.fn(() => ({})),
  getUserDataPathMock: vi.fn(() => '/tmp/iki-user-data'),
  listMcpServersMock: vi.fn(() => []),
}));

vi.mock('@iki/backend/db/providers', () => ({
  getProviders: getProvidersMock,
  getProvider: getProviderMock,
}));

vi.mock('@iki/backend/db/mcp_servers', () => ({
  listMcpServers: listMcpServersMock,
}));

vi.mock('@iki/backend/logger', () => ({
  createLogger: createLoggerMock,
}));

vi.mock('@iki/backend/persona', () => ({
  getPersonaPrompt: getPersonaPromptMock,
}));

vi.mock('@iki/backend/network/http', () => ({
  fetchWithTimeout: fetchWithTimeoutMock,
}));

vi.mock('@iki/backend/platform', () => ({
  getUserDataPath: getUserDataPathMock,
}));

vi.mock('@iki/backend/workspaces/thread_workspace', () => ({
  ensureThreadWorkspaceSelection: ensureThreadWorkspaceSelectionMock,
}));

vi.mock('@iki/backend/utils/runtime_context', () => ({
  getToolRuntimeContext: getToolRuntimeContextMock,
}));

import {
  resolvePiModelCapability,
  fetchModelCapabilityFromDev,
  getModelCallSettings,
  getModelGenerationSettings,
  refreshModelsDevCatalog,
  resetModelsDevCatalogCacheForTests,
  resolveModelCapability,
} from '@iki/backend/provider/llm/factory';

const createAsyncIterable = <T>(values: T[]) =>
  (async function* () {
    for (const value of values) {
      yield value;
    }
  })();

beforeEach(() => {
  vi.clearAllMocks();
  resetModelsDevCatalogCacheForTests();
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
  getProviderMock.mockReturnValue(null);
  listMcpServersMock.mockReturnValue([]);
  getToolRuntimeContextMock.mockReturnValue({});
  getPersonaPromptMock.mockReturnValue('persona prompt');
});

describe('llm factory', () => {
  it('resolves model capabilities from a refreshed models.dev cache', async () => {
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

    await expect(refreshModelsDevCatalog()).resolves.toEqual(
      expect.objectContaining({
        openai: expect.any(Object),
      })
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

  it('returns immediately from capability lookup and refreshes models.dev in background', async () => {
    let resolveFetch: ((response: Response) => void) | null = null;
    fetchWithTimeoutMock.mockReturnValue(
      new Promise<Response>(resolve => {
        resolveFetch = resolve;
      })
    );

    const settled = vi.fn();
    fetchModelCapabilityFromDev('openai', 'gpt-4o-mini').then(settled);

    await Promise.resolve();

    expect(settled).toHaveBeenCalledWith(null);
    expect(fetchWithTimeoutMock).toHaveBeenCalledTimes(1);

    resolveFetch?.(
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

    await expect(refreshModelsDevCatalog()).resolves.toEqual(
      expect.objectContaining({
        openai: expect.any(Object),
      })
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

  it('resolvePiModelCapability: catalog modality/cost/window, and the stored-limit clamp', async () => {
    resetModelsDevCatalogCacheForTests();
    fetchWithTimeoutMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          anthropic: {
            models: {
              'claude-sonnet-4-5': {
                name: 'Claude Sonnet 4.5',
                tool_call: true,
                reasoning: true,
                modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
                limit: { context: 200000, input: 200000, output: 64000 },
                cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
              },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } }
      )
    );
    getProvidersMock.mockReturnValue([
      { id: 'p_anthropic', type: 'anthropic', enabled: true, api_key: 'k', base_url: 'https://x/v1', models: '["claude-sonnet-4-5"]', model_options: '{}' },
    ]);

    await refreshModelsDevCatalog();

    expect(resolvePiModelCapability({ providerType: 'anthropic', modelId: 'claude-sonnet-4-5' })).toEqual({
      input: ['text', 'image', 'pdf'],
      contextWindow: 200000,
      maxTokens: 64000,
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    });

    getProvidersMock.mockReturnValue([
      {
        id: 'p_anthropic',
        type: 'anthropic',
        enabled: true,
        api_key: 'k',
        base_url: 'https://x/v1',
        models: '["claude-sonnet-4-5"]',
        model_options: JSON.stringify({ 'claude-sonnet-4-5': { maxInputTokens: 4096 } }),
      },
    ]);
    expect(resolvePiModelCapability({ providerType: 'anthropic', modelId: 'claude-sonnet-4-5' })).toMatchObject({
      contextWindow: 4096,
    });

    expect(resolvePiModelCapability({ providerType: 'anthropic', modelId: 'no-such-model' })).toBeNull();

    resetModelsDevCatalogCacheForTests();
    expect(resolvePiModelCapability({ providerType: 'anthropic', modelId: 'claude-sonnet-4-5' })).toEqual({
      contextWindow: 4096,
      maxTokens: null,
    });
  });

  it('backs off repeated models.dev refreshes after a timeout', async () => {
    fetchWithTimeoutMock.mockRejectedValue(new Error('Network request timed out after 1200 ms'));

    await expect(refreshModelsDevCatalog()).resolves.toBeNull();
    await expect(refreshModelsDevCatalog()).resolves.toBeNull();

    expect(fetchWithTimeoutMock).toHaveBeenCalledTimes(1);
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

  it('uses the current AI SDK provider key for OpenAI-compatible options', () => {
    getProvidersMock.mockReturnValue([
      {
        id: 'provider_gateway',
        type: 'openai-compatible',
        enabled: true,
        api_key: 'sk-gateway',
        base_url: 'https://gateway.example.com/v1',
        models: JSON.stringify(['gateway-model']),
        model_options: JSON.stringify({
          'gateway-model': {
            providerOptions: {
              reasoningEffort: 'medium',
              parallelToolCalls: true,
            },
          },
        }),
      },
    ]);

    expect(getModelCallSettings('openai-compatible', 'gateway-model', 'provider_gateway')).toEqual({
      providerOptions: {
        openaiCompatible: {
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

  it('keeps temperature for responses-model calls without explicit reasoning metadata', () => {
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
    ).toEqual({
      temperature: 0.2,
    });
  });

  it('keeps temperature when explicit reasoning effort is none', () => {
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

  it('merges a per-call reasoning effort override over stored provider options', () => {
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
              reasoningEffort: 'low',
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
        reasoningEffort: 'high',
      })
    ).toEqual({
      providerOptions: {
        openai: {
          parallelToolCalls: true,
          reasoningEffort: 'high',
        },
      },
    });

    expect(
      getModelGenerationSettings({
        providerType: 'openai',
        modelId: 'gpt-5.4',
        temperature: 0.2,
        reasoningEffort: 'none',
      })
    ).toEqual({
      providerOptions: {
        openai: {
          parallelToolCalls: true,
          reasoningEffort: 'none',
        },
      },
      temperature: 0.2,
    });
  });

  it('merges stored provider model options over models.dev capability metadata', async () => {
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

    await expect(refreshModelsDevCatalog()).resolves.toEqual(
      expect.objectContaining({
        openai: expect.any(Object),
      })
    );
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
