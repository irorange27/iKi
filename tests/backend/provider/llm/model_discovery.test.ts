import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchWithTimeoutMock, fetchModelsFromDevMock, getProviderConfigMock } = vi.hoisted(() => ({
  fetchWithTimeoutMock: vi.fn(),
  fetchModelsFromDevMock: vi.fn(async () => [] as string[]),
  getProviderConfigMock: vi.fn(() => ({ models: [] as string[], apiKey: '' })),
}));

vi.mock('@iki/backend/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    event: vi.fn(),
  }),
}));

vi.mock('@iki/backend/network/http', () => ({
  fetchWithTimeout: fetchWithTimeoutMock,
}));

vi.mock('../../../../packages/backend/src/provider/llm/factory', () => ({
  fetchModelsFromDev: fetchModelsFromDevMock,
  getProviderConfig: getProviderConfigMock,
}));

import {
  fetchLiveProviderModels,
  getProviderModelsForRecord,
  resetModelDiscoveryCacheForTests,
} from '../../../../packages/backend/src/provider/llm/model_discovery';

const jsonResponse = (payload: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  statusText: ok ? 'OK' : 'Internal Server Error',
  json: async () => payload,
});

describe('live provider model discovery', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetModelDiscoveryCacheForTests();
    fetchModelsFromDevMock.mockResolvedValue([]);
    getProviderConfigMock.mockReturnValue({ models: [], apiKey: '' });
  });

  describe('buildModelListUrls (via fetchLiveProviderModels)', () => {
    it('appends /v1/models to a bare base URL', async () => {
      fetchWithTimeoutMock.mockResolvedValue(jsonResponse({ data: [{ id: 'gpt-4.1' }] }));

      const models = await fetchLiveProviderModels({ baseUrl: 'https://gw.example.com' });

      expect(fetchWithTimeoutMock).toHaveBeenCalledWith(
        'https://gw.example.com/v1/models',
        expect.objectContaining({ method: 'GET' }),
        expect.objectContaining({ retries: 0 })
      );
      expect(models).toEqual(['gpt-4.1']);
    });

    it('does not double a /v1 suffix', async () => {
      fetchWithTimeoutMock.mockResolvedValue(jsonResponse({ data: [{ id: 'm1' }] }));

      await fetchLiveProviderModels({ baseUrl: 'https://gw.example.com/v1/' });

      expect(fetchWithTimeoutMock.mock.calls[0][0]).toBe('https://gw.example.com/v1/models');
    });

    it('queries an Ollama host at /api/tags first', async () => {
      fetchWithTimeoutMock.mockResolvedValue(
        jsonResponse({ models: [{ name: 'llama3:8b' }] })
      );

      const models = await fetchLiveProviderModels({ baseUrl: 'http://localhost:11434' });

      expect(fetchWithTimeoutMock.mock.calls[0][0]).toBe('http://localhost:11434/api/tags');
      expect(models).toEqual(['llama3:8b']);
    });

    it('returns nothing when no base URL is configured', async () => {
      const models = await fetchLiveProviderModels({ baseUrl: '   ' });

      expect(models).toEqual([]);
      expect(fetchWithTimeoutMock).not.toHaveBeenCalled();
    });

    it('sends the API key as a bearer token', async () => {
      fetchWithTimeoutMock.mockResolvedValue(jsonResponse({ data: [] }));

      await fetchLiveProviderModels({ baseUrl: 'https://gw.example.com', apiKey: 'sk-x' });

      expect(fetchWithTimeoutMock.mock.calls[0][1].headers).toEqual({
        accept: 'application/json',
        authorization: 'Bearer sk-x',
      });
    });

    it('falls through to the next candidate URL when the first is not ok', async () => {
      fetchWithTimeoutMock
        .mockResolvedValueOnce(jsonResponse({}, false))
        .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'fallback-model' }] }));

      const models = await fetchLiveProviderModels({ baseUrl: 'http://localhost:11434' });

      expect(fetchWithTimeoutMock).toHaveBeenCalledTimes(2);
      expect(fetchWithTimeoutMock.mock.calls[1][0]).toBe('http://localhost:11434/v1/models');
      expect(models).toEqual(['fallback-model']);
    });

    it('returns an empty list when the endpoint throws', async () => {
      fetchWithTimeoutMock.mockRejectedValue(new Error('ECONNREFUSED'));

      const models = await fetchLiveProviderModels({ baseUrl: 'https://gw.example.com' });

      expect(models).toEqual([]);
    });

    it('reads a bare array of ids', async () => {
      fetchWithTimeoutMock.mockResolvedValue(jsonResponse(['a', 'b']));

      const models = await fetchLiveProviderModels({ baseUrl: 'https://gw.example.com' });

      expect(models).toEqual(['a', 'b']);
    });
  });

  describe('real-world response shapes', () => {
    it('reads ids from a router that decorates each model entry', async () => {
      const payload = {
        object: 'list',
        data: [
          {
            id: 'auto/glm-5.3',
            display_name: 'GLM 5.3',
            context_window: 200000,
            max_output_tokens: 32000,
            modalities: { input: ['text', 'image'] },
            reasoning: true,
          },
          {
            id: 'auto/kimi-k3',
            display_name: 'Kimi K3',
            context_window: 256000,
            modalities: { input: ['text'] },
          },
        ],
        has_more: false,
      };
      fetchWithTimeoutMock.mockResolvedValue(jsonResponse(payload));

      const models = await fetchLiveProviderModels({ baseUrl: 'http://127.0.0.1:3425' });

      expect(models).toEqual(['auto/glm-5.3', 'auto/kimi-k3']);
    });

    it('accepts a base URL with no version segment', async () => {
      fetchWithTimeoutMock.mockResolvedValue(jsonResponse({ data: [{ id: 'm' }] }));

      await fetchLiveProviderModels({ baseUrl: 'http://127.0.0.1:3425' });

      expect(fetchWithTimeoutMock.mock.calls[0][0]).toBe('http://127.0.0.1:3425/v1/models');
    });

    it('ignores an unrecognised payload shape', async () => {
      fetchWithTimeoutMock.mockResolvedValue(jsonResponse({ error: 'unauthorized' }));

      const models = await fetchLiveProviderModels({ baseUrl: 'https://gw.example.com' });

      expect(models).toEqual([]);
    });
  });

  describe('getProviderModelsForRecord', () => {
    it('prefers the live endpoint over the catalog', async () => {
      fetchModelsFromDevMock.mockResolvedValue(['catalog-only']);
      fetchWithTimeoutMock.mockResolvedValue(jsonResponse({ data: [{ id: 'live-model' }] }));

      const models = await getProviderModelsForRecord({
        providerId: 'custom_1',
        providerType: 'openai-compatible',
        baseUrl: 'https://gw.example.com',
      });

      expect(models).toEqual(['live-model']);
    });

    it('falls back to the catalog when the endpoint has nothing', async () => {
      fetchModelsFromDevMock.mockResolvedValue(['catalog-model']);
      fetchWithTimeoutMock.mockResolvedValue(jsonResponse({ data: [] }));

      const models = await getProviderModelsForRecord({
        providerId: 'custom_2',
        providerType: 'openai-compatible',
        baseUrl: 'https://gw.example.com',
      });

      expect(models).toEqual(['catalog-model']);
    });

    it('falls back to the stored model list when both remote sources are empty', async () => {
      getProviderConfigMock.mockReturnValue({ models: ['stored-model'], apiKey: 'k' });

      const models = await getProviderModelsForRecord({
        providerId: 'custom_3',
        providerType: 'openai-compatible',
        baseUrl: '',
      });

      expect(models).toEqual(['stored-model']);
      expect(fetchWithTimeoutMock).not.toHaveBeenCalled();
    });

    it('caches a live result per provider id', async () => {
      fetchWithTimeoutMock.mockResolvedValue(jsonResponse({ data: [{ id: 'cached-model' }] }));

      const params = {
        providerId: 'custom_4',
        providerType: 'openai-compatible',
        baseUrl: 'https://gw.example.com',
      } as const;

      await getProviderModelsForRecord(params);
      await getProviderModelsForRecord(params);

      expect(fetchWithTimeoutMock).toHaveBeenCalledTimes(1);
    });
  });
});
