import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultAppConfig } from '../../../src/shared/config/defaults';
import type { Provider } from '../../../src/shared/types/provider';

const {
  createModelMock,
  generateTextMock,
  getAppConfigMock,
  getFullSystemPromptMock,
  getProvidersMock,
} = vi.hoisted(() => ({
  createModelMock: vi.fn(),
  generateTextMock: vi.fn(),
  getAppConfigMock: vi.fn(),
  getFullSystemPromptMock: vi.fn(),
  getProvidersMock: vi.fn(),
}));

vi.mock('ai', () => ({
  generateText: generateTextMock,
}));

vi.mock('../../../src/core/provider/llm/factory', () => ({
  createModel: createModelMock,
  getFullSystemPrompt: getFullSystemPromptMock,
}));

vi.mock('../../../src/core/config', () => ({
  getAppConfig: getAppConfigMock,
}));

vi.mock('../../../src/core/db/providers', () => ({
  getProviders: getProvidersMock,
}));

vi.mock('../../../src/core/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    event: vi.fn(),
    span: vi.fn(),
  })),
}));

import { getToolModel, testToolModelLatency } from '../../../src/core/provider/tool_model';

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
  acp_command: overrides.acp_command,
  acp_args: overrides.acp_args,
  acp_mcp_server_ids: overrides.acp_mcp_server_ids,
  acp_auth_method_id: overrides.acp_auth_method_id,
  acp_api_provider_id: overrides.acp_api_provider_id,
  acp_model_mapping: overrides.acp_model_mapping,
});

beforeEach(() => {
  vi.clearAllMocks();
  createModelMock.mockReturnValue('mock-model');
  generateTextMock.mockResolvedValue({ text: 'OK' });
  getFullSystemPromptMock.mockReturnValue('persona prompt');
  getAppConfigMock.mockReturnValue(createDefaultAppConfig());
  getProvidersMock.mockReturnValue([]);
});

describe('tool model provider', () => {
  it('prefers the explicitly configured provider when the same model exists on multiple providers', () => {
    const config = createDefaultAppConfig();
    config.toolModel.providerType = 'deepseek';
    config.toolModel.model = 'shared-model';

    getAppConfigMock.mockReturnValue(config);
    getProvidersMock.mockReturnValue([
      buildProvider({
        id: 'provider-openai',
        name: 'OpenAI',
        type: 'openai',
        models: JSON.stringify(['shared-model']),
      }),
      buildProvider({
        id: 'provider-deepseek',
        name: 'DeepSeek',
        type: 'deepseek',
        models: JSON.stringify(['shared-model']),
      }),
    ]);

    expect(getToolModel()).toEqual({
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
      providerType: 'deepseek',
      model: 'deepseek-chat',
    });
  });

  it('runs latency tests through the direct model call path instead of chat orchestration', async () => {
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
        providerType: 'deepseek',
        model: 'deepseek-chat',
      })
    ).resolves.toMatchObject({
      providerType: 'deepseek',
      model: 'deepseek-chat',
    });

    expect(createModelMock).toHaveBeenCalledWith('deepseek', 'deepseek-chat');
    expect(generateTextMock).toHaveBeenCalledWith({
      model: 'mock-model',
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      maxOutputTokens: 8,
    });
  });

  it('rejects invalid explicit selections instead of silently auto-detecting another provider', async () => {
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
        providerType: 'deepseek',
        model: 'deepseek-chat',
      })
    ).rejects.toThrow('Selected tool model is unavailable.');
  });
});
