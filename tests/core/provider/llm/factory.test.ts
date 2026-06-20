import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createACPProviderMock,
  createAnthropicMock,
  createDeepSeekMock,
  createLoggerMock,
  createMinimaxMock,
  createOpenAICompatibleMock,
  createOpenAIMock,
  ensureThreadWorkspaceSelectionMock,
  fetchWithTimeoutMock,
  generateTextMock,
  getProviderMock,
  getProvidersMock,
  getPersonaPromptMock,
  getToolRuntimeContextMock,
  getUserDataPathMock,
  listMcpServersMock,
  streamTextMock,
} = vi.hoisted(() => ({
  createACPProviderMock: vi.fn(),
  createAnthropicMock: vi.fn(),
  createDeepSeekMock: vi.fn(),
  createLoggerMock: vi.fn(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    event: vi.fn(),
  })),
  createMinimaxMock: vi.fn(),
  createOpenAICompatibleMock: vi.fn(),
  createOpenAIMock: vi.fn(),
  ensureThreadWorkspaceSelectionMock: vi.fn(() => null),
  fetchWithTimeoutMock: vi.fn(),
  generateTextMock: vi.fn(),
  getProviderMock: vi.fn(() => null),
  getProvidersMock: vi.fn(),
  getPersonaPromptMock: vi.fn(),
  getToolRuntimeContextMock: vi.fn(() => ({})),
  getUserDataPathMock: vi.fn(() => '/tmp/iki-user-data'),
  listMcpServersMock: vi.fn(() => []),
  streamTextMock: vi.fn(),
}));

vi.mock('ai', () => ({
  generateText: generateTextMock,
  smoothStream: vi.fn(),
  streamText: streamTextMock,
}));

vi.mock('@mcpc-tech/acp-ai-provider', () => ({
  createACPProvider: createACPProviderMock,
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

vi.mock('vercel-minimax-ai-provider', () => ({
  createMinimax: createMinimaxMock,
}));

vi.mock('@iki/backend/db/providers', () => ({
  getProviders: getProvidersMock,
  getProvider: getProviderMock,
}));

vi.mock('@iki/backend/db/mcp_servers', () => ({
  listMcpServers: listMcpServersMock,
}));

vi.mock('@iki/core/logger', () => ({
  createLogger: createLoggerMock,
}));

vi.mock('@iki/backend/persona', () => ({
  getPersonaPrompt: getPersonaPromptMock,
}));

vi.mock('@iki/backend/network/http', () => ({
  fetchWithTimeout: fetchWithTimeoutMock,
}));

vi.mock('@iki/core/context/platform_provider', () => ({
  getUserDataPath: getUserDataPathMock,
}));

vi.mock('@iki/backend/platform', () => ({
  getUserDataPath: getUserDataPathMock,
}));

vi.mock('@iki/backend/workspaces/thread_workspace', () => ({
  ensureThreadWorkspaceSelection: ensureThreadWorkspaceSelectionMock,
}));

vi.mock('@iki/backend/tools/runtime_context', () => ({
  getToolRuntimeContext: getToolRuntimeContextMock,
}));

import {
  createModel,
  disposeLanguageModel,
  fetchModelCapabilityFromDev,
  fetchAcpModels,
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

const createMockLanguageModel = (provider = 'anthropic') => ({
  specificationVersion: 'v3' as const,
  provider,
  modelId: 'claude-sonnet-4-5',
  supportedUrls: {},
  doGenerate: vi.fn(),
  doStream: vi.fn(),
});

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

  it('instantiates MiniMax models through the MiniMax provider adapter', () => {
    const minimaxModel = createMockLanguageModel('minimax.messages');
    const modelFactory = vi.fn(() => minimaxModel);
    createMinimaxMock.mockReturnValue(modelFactory);
    getProvidersMock.mockReturnValue([
      {
        id: 'provider_minimax',
        type: 'minimax',
        enabled: true,
        api_key: 'sk-mini',
        base_url: '',
        models: JSON.stringify(['MiniMax-M2']),
      },
    ]);

    expect(createModel('minimax', 'MiniMax-M2')).toBe(minimaxModel);
    expect(createMinimaxMock).toHaveBeenCalledWith({
      apiKey: 'sk-mini',
      baseURL: 'https://api.minimax.io/anthropic/v1',
    });
    expect(modelFactory).toHaveBeenCalledWith('MiniMax-M2');
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

  it('instantiates ACP models through the ACP provider bridge with persistent sessions', () => {
    const acpLanguageModel = {
      specificationVersion: 'v3' as const,
      provider: 'acp',
      modelId: 'codex-mini-latest',
      supportedUrls: {},
      doGenerate: vi.fn(),
      doStream: vi.fn(),
      forceCleanup: vi.fn(),
    };
    const acpProvider = {
      languageModel: vi.fn(() => acpLanguageModel),
    };
    createACPProviderMock.mockReturnValue(acpProvider);
    getProvidersMock.mockReturnValue([
      {
        id: 'provider_acp',
        type: 'acp',
        enabled: true,
        api_key: '',
        base_url: '',
        models: JSON.stringify(['codex-mini-latest']),
        acp_command: 'codex-acp',
        acp_args: '["--sandbox","workspace-write"]',
      },
    ]);

    expect(createModel('acp', 'codex-mini-latest')).toBe(acpLanguageModel);
    expect(createACPProviderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'codex-acp',
        args: ['--sandbox', 'workspace-write'],
        persistSession: true,
        session: {
          cwd: '/tmp/iki-user-data/acp-session',
          mcpServers: [],
        },
      })
    );
    expect(acpProvider.languageModel).toHaveBeenCalledWith('codex-mini-latest', undefined);
  });

  it('shell-splits ACP argument strings before launching the ACP bridge', () => {
    const acpLanguageModel = {
      specificationVersion: 'v3' as const,
      provider: 'acp',
      modelId: 'codex-mini-latest',
      supportedUrls: {},
      doGenerate: vi.fn(),
      doStream: vi.fn(),
      forceCleanup: vi.fn(),
    };
    const acpProvider = {
      languageModel: vi.fn(() => acpLanguageModel),
    };
    createACPProviderMock.mockReturnValue(acpProvider);
    getProvidersMock.mockReturnValue([
      {
        id: 'provider_acp',
        type: 'acp',
        enabled: true,
        api_key: '',
        base_url: '',
        models: JSON.stringify(['codex-mini-latest']),
        acp_command: 'codex-acp',
        acp_args: '--profile default\n--label "Codex Mini"',
      },
    ]);

    expect(createModel('acp', 'codex-mini-latest')).toBe(acpLanguageModel);
    expect(createACPProviderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['--profile', 'default', '--label', 'Codex Mini'],
      })
    );
  });

  it('passes selected MCP servers into the ACP session configuration', () => {
    const acpLanguageModel = {
      specificationVersion: 'v3' as const,
      provider: 'acp',
      modelId: 'codex-mini-latest',
      supportedUrls: {},
      doGenerate: vi.fn(),
      doStream: vi.fn(),
      forceCleanup: vi.fn(),
    };
    const acpProvider = {
      languageModel: vi.fn(() => acpLanguageModel),
    };
    createACPProviderMock.mockReturnValue(acpProvider);
    listMcpServersMock.mockReturnValue([
      {
        id: 'docs_server',
        name: 'Repo Docs',
        transport: 'streamable-http',
        base_url: 'https://mcp.example.com',
        headers: {
          Authorization: 'Bearer token',
        },
        auth_ref: null,
        enabled: true,
        command: null,
        args: null,
        cwd: null,
        env: null,
        tool_allowlist: null,
        approval_mode: null,
        created_at: '2026-03-21T12:00:00.000Z',
        updated_at: '2026-03-21T12:00:00.000Z',
      },
      {
        id: 'fs_server',
        name: 'Filesystem',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@example/filesystem'],
        cwd: null,
        env: {
          MCP_LOG_LEVEL: 'debug',
        },
        base_url: null,
        headers: null,
        auth_ref: null,
        enabled: true,
        tool_allowlist: null,
        approval_mode: null,
        created_at: '2026-03-21T12:00:00.000Z',
        updated_at: '2026-03-21T12:00:00.000Z',
      },
    ]);
    getProvidersMock.mockReturnValue([
      {
        id: 'provider_acp',
        type: 'acp',
        enabled: true,
        api_key: '',
        base_url: '',
        models: JSON.stringify(['codex-mini-latest']),
        acp_command: 'codex-acp',
        acp_mcp_server_ids: '["docs_server","fs_server"]',
      },
    ]);

    expect(createModel('acp', 'codex-mini-latest')).toBe(acpLanguageModel);
    expect(createACPProviderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        session: {
          cwd: '/tmp/iki-user-data/acp-session',
          mcpServers: [
            {
              type: 'http',
              name: 'Repo Docs',
              url: 'https://mcp.example.com',
              headers: [{ name: 'Authorization', value: 'Bearer token' }],
            },
            {
              name: 'Filesystem',
              command: 'npx',
              args: ['-y', '@example/filesystem'],
              env: [{ name: 'MCP_LOG_LEVEL', value: 'debug' }],
            },
          ],
        },
      })
    );
  });

  it('discovers ACP models through session initialization', async () => {
    const acpProvider = {
      languageModel: vi.fn(),
      initSession: vi.fn(async () => ({
        sessionId: 'session_1',
        models: {
          availableModels: [
            {
              modelId: 'codex-mini-latest',
              name: 'Codex Mini',
            },
          ],
          currentModelId: 'codex-mini-latest',
        },
      })),
      cleanup: vi.fn(),
    };
    createACPProviderMock.mockReturnValue(acpProvider);
    getProvidersMock.mockReturnValue([
      {
        id: 'provider_acp',
        type: 'acp',
        enabled: true,
        api_key: '',
        base_url: '',
        models: JSON.stringify([]),
        acp_command: 'codex-acp',
      },
    ]);

    await expect(fetchAcpModels('acp')).resolves.toEqual([
      {
        id: 'codex-mini-latest',
        displayName: 'Codex Mini',
        supportsToolCalls: true,
        source: 'provider',
      },
    ]);
    expect(acpProvider.initSession).toHaveBeenCalledTimes(1);
    expect(acpProvider.cleanup).toHaveBeenCalledTimes(1);
  });

  it('discovers ACP models from an unsaved draft override without requiring a persisted provider', async () => {
    const acpProvider = {
      languageModel: vi.fn(),
      initSession: vi.fn(async () => ({
        sessionId: 'session_draft',
        models: {
          availableModels: [
            {
              modelId: 'codex-mini-latest',
              name: 'Codex Mini',
            },
          ],
        },
      })),
      cleanup: vi.fn(),
    };
    createACPProviderMock.mockReturnValue(acpProvider);
    getProvidersMock.mockReturnValue([]);

    await expect(
      fetchAcpModels('acp', undefined, {
        type: 'acp',
        acp_command: 'codex',
        acp_args: '--profile default',
      })
    ).resolves.toEqual([
      {
        id: 'codex-mini-latest',
        displayName: 'Codex Mini',
        supportsToolCalls: true,
        source: 'provider',
      },
    ]);
    expect(createACPProviderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'codex',
        args: ['--profile', 'default'],
      })
    );
  });

  it('cleans up ACP language models explicitly after a turn finishes', () => {
    const forceCleanup = vi.fn();
    disposeLanguageModel({
      specificationVersion: 'v3',
      provider: 'acp',
      modelId: 'codex-mini-latest',
      supportedUrls: {},
      doGenerate: vi.fn(),
      doStream: vi.fn(),
      forceCleanup,
    });

    expect(forceCleanup).toHaveBeenCalledTimes(1);
  });

  it('skips models.dev capability fetches for ACP models and relies on stored overrides', async () => {
    getProvidersMock.mockReturnValue([
      {
        id: 'provider_acp',
        type: 'acp',
        enabled: true,
        api_key: '',
        base_url: '',
        models: JSON.stringify(['codex-mini-latest']),
        model_options: JSON.stringify({
          'codex-mini-latest': {
            displayName: 'Codex Mini',
            maxOutputTokens: 16384,
            supportsToolCalls: true,
          },
        }),
        acp_command: 'codex-acp',
      },
    ]);

    await expect(resolveModelCapability('acp', 'codex-mini-latest')).resolves.toEqual(
      expect.objectContaining({
        displayName: 'Codex Mini',
        maxOutputTokens: 16384,
        supportsToolCalls: true,
      })
    );
    expect(fetchWithTimeoutMock).not.toHaveBeenCalled();
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
