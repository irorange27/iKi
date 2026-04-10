import { describe, expect, it, vi } from 'vitest';

const { loggerEventMock } = vi.hoisted(() => ({
  loggerEventMock: vi.fn(),
}));

vi.mock('../../src/renderer/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    event: loggerEventMock,
    span: vi.fn(),
  })),
}));

import type { Provider } from '../../src/shared/types/provider';
import {
  resolveProviderSelection,
  useChatProviderSelection,
} from '../../src/renderer/composables/useChatProviderSelection';

const buildProvider = (
  overrides: Partial<Provider> & Pick<Provider, 'id' | 'name' | 'type'>
): Provider => ({
  id: overrides.id,
  name: overrides.name,
  type: overrides.type,
  api_key: overrides.api_key ?? '',
  models: overrides.models ?? '[]',
  base_url: overrides.base_url,
  enabled: overrides.enabled ?? true,
  created_at: overrides.created_at ?? '2026-03-22T00:00:00.000Z',
  updated_at: overrides.updated_at ?? '2026-03-22T00:00:00.000Z',
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

describe('chat provider selection', () => {
  it('keeps the previous enabled provider and model when still available', () => {
    const openai = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1","gpt-4o"]',
    });
    const deepseek = buildProvider({
      id: 'deepseek',
      name: 'DeepSeek',
      type: 'deepseek',
      models: '["deepseek-chat"]',
    });

    expect(
      resolveProviderSelection({
        providers: [openai, deepseek],
        currentProvider: openai,
        currentModel: 'gpt-4o',
      })
    ).toEqual({
      availableProviders: [openai, deepseek],
      selectedProvider: openai,
      selectedModel: 'gpt-4o',
    });
  });

  it('falls back to the next enabled provider with models when the current provider is unusable', () => {
    const current = buildProvider({
      id: 'empty',
      name: 'Empty',
      type: 'openai',
      models: '[]',
    });
    const deepseek = buildProvider({
      id: 'deepseek',
      name: 'DeepSeek',
      type: 'deepseek',
      models: '["deepseek-chat"]',
    });

    expect(
      resolveProviderSelection({
        providers: [current, deepseek],
        currentProvider: current,
        currentModel: 'missing-model',
      })
    ).toEqual({
      availableProviders: [current, deepseek],
      selectedProvider: deepseek,
      selectedModel: 'deepseek-chat',
    });
  });

  it('prefers a provider that exposes the active thread model', () => {
    const deepseek = buildProvider({
      id: 'deepseek',
      name: 'DeepSeek',
      type: 'deepseek',
      models: '["deepseek-chat"]',
    });
    const openai = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1","gpt-4o"]',
    });

    expect(
      resolveProviderSelection({
        providers: [deepseek, openai],
        currentProvider: deepseek,
        currentModel: 'deepseek-chat',
        preferredModel: 'gpt-4o',
      })
    ).toEqual({
      availableProviders: [deepseek, openai],
      selectedProvider: openai,
      selectedModel: 'gpt-4o',
    });
  });

  it('prefers the explicitly selected provider instance when provider ids differ', () => {
    const gatewayA = buildProvider({
      id: 'gateway-a',
      name: 'Gateway A',
      type: 'openai-compatible',
      models: '["shared-model"]',
    });
    const gatewayB = buildProvider({
      id: 'gateway-b',
      name: 'Gateway B',
      type: 'openai-compatible',
      models: '["shared-model"]',
    });

    expect(
      resolveProviderSelection({
        providers: [gatewayA, gatewayB],
        currentProvider: gatewayA,
        currentModel: 'shared-model',
        preferredModel: 'shared-model',
        preferredProviderId: 'gateway-b',
      })
    ).toEqual({
      availableProviders: [gatewayA, gatewayB],
      selectedProvider: gatewayB,
      selectedModel: 'shared-model',
    });
  });

  it('surfaces provider configuration failures before send', async () => {
    const openai = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1"]',
    });

    const providerList = vi.fn(async () => [openai]);
    const isProviderConfigured = vi.fn(async () => false);
    const selection = useChatProviderSelection({
      electronAPI: {
        providers: {
          list: providerList,
        },
        chat: {
          isProviderConfigured,
        },
      } as never,
    });

    await selection.loadAvailableProviders();
    const result = await selection.ensureProviderReady();

    expect(providerList).toHaveBeenCalledTimes(1);
    expect(isProviderConfigured).toHaveBeenCalledWith('openai', 'openai');
    expect(result).toEqual({
      ok: false,
      message: 'Please configure the OpenAI API key in Settings.',
    });
  });

  it('surfaces ACP command configuration failures before send', async () => {
    const acpProvider = buildProvider({
      id: 'acp_1',
      name: 'ACP Agent',
      type: 'acp',
      models: '["codex-mini-latest"]',
    });

    const providerList = vi.fn(async () => [acpProvider]);
    const isProviderConfigured = vi.fn(async () => false);
    const selection = useChatProviderSelection({
      electronAPI: {
        providers: {
          list: providerList,
        },
        chat: {
          isProviderConfigured,
        },
      } as never,
    });

    await selection.loadAvailableProviders();
    const result = await selection.ensureProviderReady();

    expect(result).toEqual({
      ok: false,
      message: 'Please configure the Codex CLI ACP command in Settings.',
    });
  });

  it('surfaces provider verification exceptions before send', async () => {
    const openai = buildProvider({
      id: 'openai',
      name: 'OpenAI',
      type: 'openai',
      models: '["gpt-4.1"]',
    });

    const providerList = vi.fn(async () => [openai]);
    const configuredError = new Error('ipc failed');
    const isProviderConfigured = vi.fn(async () => {
      throw configuredError;
    });
    const selection = useChatProviderSelection({
      electronAPI: {
        providers: {
          list: providerList,
        },
        chat: {
          isProviderConfigured,
        },
      } as never,
    });

    await selection.loadAvailableProviders();
    const result = await selection.ensureProviderReady();

    expect(providerList).toHaveBeenCalledTimes(1);
    expect(isProviderConfigured).toHaveBeenCalledWith('openai', 'openai');
    expect(loggerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        event: 'chat.provider.verify',
        outcome: 'failed',
        error: configuredError,
      })
    );
    expect(result).toEqual({
      ok: false,
      message: 'Failed to verify the OpenAI provider configuration. Please try again.',
    });
  });
});
