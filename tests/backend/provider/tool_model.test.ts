import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultAppConfig } from '@iki/backend/config/defaults';
import type { Provider } from '@iki/backend/types/provider';

const {
  generateChatWithModelMessagesMock,
  generateTextMock,
  getAppConfigMock,
  resolvePersonaPromptMock,
  getModelCallSettingsMock,
  getProvidersMock,
} = vi.hoisted(() => ({
  generateChatWithModelMessagesMock: vi.fn(),
  generateTextMock: vi.fn(),
  getAppConfigMock: vi.fn(),
  resolvePersonaPromptMock: vi.fn(),
  getModelCallSettingsMock: vi.fn(() => ({})),
  getProvidersMock: vi.fn(),
}));

vi.mock('ai', () => ({
  generateText: generateTextMock,
}));

vi.mock('@iki/backend/provider/llm/factory', () => ({
  generateChatWithModelMessages: generateChatWithModelMessagesMock,
  resolvePersonaPrompt: resolvePersonaPromptMock,
  getModelCallSettings: getModelCallSettingsMock,
}));

vi.mock('@iki/backend/config', () => ({
  getAppConfig: getAppConfigMock,
}));

vi.mock('@iki/backend/db/providers', () => ({
  getProviders: getProvidersMock,
}));

vi.mock('@iki/backend/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    event: vi.fn(),
    span: vi.fn(),
  })),
}));

import { getToolModel, testToolModelLatency } from '@iki/backend/provider/tool_model';

const buildProvider = (
  overrides: Partial<Provider> & Pick<Provider, 'id' | 'name' | 'type' | 'models'>
): Provider => ({
  id: overrides.id,
  name: overrides.name,
  type: overrides.type,
  api_key: overrides.api_key ?? 'secret',
  models: overrides.models,
  base_url: overrides.base_url,
  enabled: overrides.enabled ?? true,
  created_at: overrides.created_at ?? '2026-03-25T00:00:00.000Z',
  updated_at: overrides.updated_at ?? '2026-03-25T00:00:00.000Z',
  available_models: overrides.available_models ?? '[]',
  api_version: overrides.api_version,
  is_response_api: overrides.is_response_api,
});

beforeEach(() => {
  vi.clearAllMocks();
  getModelCallSettingsMock.mockReturnValue({});
  generateTextMock.mockResolvedValue({ text: 'OK' });
  generateChatWithModelMessagesMock.mockResolvedValue({
    text: 'OK',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  });
  resolvePersonaPromptMock.mockReturnValue('persona prompt');
  getAppConfigMock.mockReturnValue(createDefaultAppConfig());
  getProvidersMock.mockReturnValue([]);
});

describe('tool model provider', () => {
  it('prefers the explicitly configured providerId when the same model exists on multiple providers', () => {
    const config = createDefaultAppConfig();
    config.toolModel.providerId = 'provider-deepseek-secondary';
    config.toolModel.model = 'shared-model';

    getAppConfigMock.mockReturnValue(config);
    getProvidersMock.mockReturnValue([
      buildProvider({
        id: 'provider-deepseek-primary',
        name: 'DeepSeek Primary',
        type: 'deepseek',
        models: JSON.stringify(['shared-model']),
      }),
      buildProvider({
        id: 'provider-deepseek-secondary',
        name: 'DeepSeek Secondary',
        type: 'deepseek',
        models: JSON.stringify(['shared-model']),
      }),
    ]);

    expect(getToolModel()).toEqual({
      providerId: 'provider-deepseek-secondary',
      providerType: 'deepseek',
      model: 'shared-model',
    });
  });

  it('supports legacy model-only tool model config by inferring the provider from enabled providers', () => {
    const config = createDefaultAppConfig();
    config.toolModel.model = 'deepseek-chat';

    getAppConfigMock.mockReturnValue(config);
    getProvidersMock.mockReturnValue([
      buildProvider({
        id: 'provider-deepseek',
        name: 'DeepSeek',
        type: 'deepseek',
        models: JSON.stringify(['deepseek-chat']),
      }),
    ]);

    expect(getToolModel()).toEqual({
      providerId: 'provider-deepseek',
      providerType: 'deepseek',
      model: 'deepseek-chat',
    });
  });

  it('returns fallback model when no explicit tool model is configured', () => {
    getAppConfigMock.mockReturnValue(createDefaultAppConfig());
    getProvidersMock.mockReturnValue([
      buildProvider({
        id: 'provider-openai',
        name: 'OpenAI',
        type: 'openai',
        models: JSON.stringify(['gpt-4o-mini']),
      }),
    ]);

    const toolModel = getToolModel();
    expect(toolModel).not.toBeNull();
    expect(toolModel?.providerId).toBe('provider-openai');
    expect(toolModel?.providerType).toBe('openai');
    expect(toolModel?.model).toBe('gpt-4o-mini');
  });

  it('probes latency through the shared aux supply entry, not a private AI SDK call', async () => {
    getProvidersMock.mockReturnValue([
      buildProvider({
        id: 'provider-deepseek',
        name: 'DeepSeek',
        type: 'deepseek',
        models: JSON.stringify(['deepseek-chat']),
      }),
    ]);

    await expect(
      testToolModelLatency({
        providerId: 'provider-deepseek',
        providerType: 'deepseek',
        model: 'deepseek-chat',
      })
    ).resolves.toMatchObject({
      providerId: 'provider-deepseek',
      providerType: 'deepseek',
      model: 'deepseek-chat',
    });

    // Regression: this probe used to build the model itself and call
    // generateText directly. That made it exercise a DIFFERENT supply than the
    // auxiliary calls it exists to validate — on a Pi-eligible provider the
    // probe ran the AI SDK path while the real calls ran Pi, so a green "Test"
    // said nothing about the route actually in use. One supply decision.
    expect(generateChatWithModelMessagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: 'deepseek',
        providerId: 'provider-deepseek',
        modelId: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        maxOutputTokens: 8,
      })
    );
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it('rejects invalid explicit providerId selections instead of silently picking another provider', async () => {
    getProvidersMock.mockReturnValue([
      buildProvider({
        id: 'provider-openai',
        name: 'OpenAI',
        type: 'openai',
        models: JSON.stringify(['gpt-4o-mini']),
      }),
    ]);

    await expect(
      testToolModelLatency({
        providerId: 'provider-deepseek',
        model: 'deepseek-chat',
      })
    ).rejects.toThrow('Selected tool model is unavailable.');
  });
});
