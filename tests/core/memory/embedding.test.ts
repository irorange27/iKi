import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@iki/core/context/config_provider', () => ({
  getAppConfig: vi.fn(),
}));

vi.mock('@iki/core/context/provider_store', () => ({
  getProviders: vi.fn(),
}));

vi.mock('@iki/backend/provider/llm/factory', () => ({
  getProviderConfig: vi.fn(),
}));

vi.mock('@iki/core/context/network_provider', () => ({
  fetchWithTimeout: vi.fn(),
}));

vi.mock('@iki/core/logger', () => ({
  createLogger: vi.fn(() => ({ event: vi.fn() })),
}));

import { getAppConfig } from '@iki/core/context/config_provider';
import { getProviders } from '@iki/core/context/provider_store';
import { getProviderConfig } from '@iki/backend/provider/llm/factory';
import { fetchWithTimeout } from '@iki/core/context/network_provider';
import { createPreferredMemoryEmbeddingRuntime } from '@iki/backend/memory/embedding';

const getAppConfigMock = vi.mocked(getAppConfig);
const getProvidersMock = vi.mocked(getProviders);
const getProviderConfigMock = vi.mocked(getProviderConfig);
const fetchWithTimeoutMock = vi.mocked(fetchWithTimeout);

beforeEach(() => {
  vi.clearAllMocks();
  getAppConfigMock.mockReturnValue({
    memory: {
      embeddingModel: {
        providerId: '',
        providerType: '',
        model: '',
      },
    },
  } as ReturnType<typeof getAppConfig>);
  getProvidersMock.mockReturnValue([
    {
      id: 'provider_openai_primary',
      name: 'OpenAI Primary',
      type: 'openai',
      api_key: 'openai-key',
      models: '["gpt-4.1"]',
      model_options: '{}',
      base_url: '',
      enabled: true,
      created_at: '2026-03-30T00:00:00.000Z',
      updated_at: '2026-03-30T00:00:00.000Z',
      available_models: '[]',
      is_response_api: false,
    },
    {
      id: 'provider_gateway',
      name: 'Gateway',
      type: 'openai-compatible',
      api_key: 'gateway-key',
      models: '["custom-embed-large","custom-chat"]',
      model_options: '{}',
      base_url: 'https://gateway.example.com',
      enabled: true,
      created_at: '2026-03-30T00:00:01.000Z',
      updated_at: '2026-03-30T00:00:01.000Z',
      available_models: '[]',
      is_response_api: false,
    },
  ] as ReturnType<typeof getProviders>);
  getProviderConfigMock.mockImplementation((providerType: string, providerId?: string | null) => ({
    id: providerId || `${providerType}_default`,
    type: providerType,
    apiKey: providerId === 'provider_gateway' ? 'gateway-key' : 'openai-key',
    baseURL: providerId === 'provider_gateway' ? 'https://gateway.example.com' : '',
    models: [],
    modelOptions: {},
    isResponseApi: false,
  }));
  fetchWithTimeoutMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      data: [{ index: 0, embedding: [0, 2] }],
    }),
  } as Awaited<ReturnType<typeof fetchWithTimeout>>);
});

describe('memory embedding runtime selection', () => {
  it('uses the explicit memory embedding model selection when configured', async () => {
    getAppConfigMock.mockReturnValue({
      memory: {
        embeddingModel: {
          providerId: 'provider_gateway',
          providerType: 'openai-compatible',
          model: 'custom-embed-large',
        },
      },
    } as ReturnType<typeof getAppConfig>);

    const runtime = createPreferredMemoryEmbeddingRuntime();
    const [result] = await runtime.embed(['project preferences']);

    expect(fetchWithTimeoutMock).toHaveBeenCalledWith(
      'https://gateway.example.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          model: 'custom-embed-large',
          input: ['project preferences'],
          encoding_format: 'float',
        }),
      })
    );
    expect(result?.fingerprint).toMatchObject({
      strategy: 'provider',
      providerId: 'provider_gateway',
      providerType: 'openai-compatible',
      model: 'custom-embed-large',
      dimensions: 2,
    });
  });

  it('auto-detects the default OpenAI embedding model when no explicit selection exists', async () => {
    const runtime = createPreferredMemoryEmbeddingRuntime();
    const [result] = await runtime.embed(['hello']);

    expect(fetchWithTimeoutMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      expect.objectContaining({
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: ['hello'],
          encoding_format: 'float',
        }),
      })
    );
    expect(result?.fingerprint).toMatchObject({
      providerId: 'provider_openai_primary',
      providerType: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 2,
    });
  });
});
