import { describe, expect, it } from 'vitest';

import {
  createModelCapabilityFromProviderModelOptions,
  getModelsDevProviderKey,
  getProviderModelOptions,
  listModelsDevProviderModels,
  lookupModelsDevModelCapability,
  mergeModelCapability,
  parseModelList,
  parseProviderModelOptionsMap,
  serializeProviderModelOptionsMap,
  type ModelsDevCatalog,
} from '../../src/shared/utils/provider_models';

describe('provider_models helpers', () => {
  it('parses stored provider model lists from JSON strings', () => {
    expect(parseModelList('["gpt-4o-mini"," gpt-4.1 "]')).toEqual(['gpt-4o-mini', 'gpt-4.1']);
    expect(parseModelList('')).toEqual([]);
    expect(parseModelList('{')).toEqual([]);
  });

  it('maps provider aliases to models.dev provider keys', () => {
    expect(getModelsDevProviderKey('kimi')).toBe('moonshotai');
    expect(getModelsDevProviderKey('moonshot')).toBe('moonshotai');
    expect(getModelsDevProviderKey('openai')).toBe('openai');
  });

  it('lists provider models and resolves model capabilities from models.dev-style catalogs', () => {
    const catalog: ModelsDevCatalog = {
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
      moonshotai: {
        models: {
          'kimi-k2': {
            name: 'Kimi K2',
            limits: {
              context: '64000',
              input: '64000',
              output: '8000',
            },
            supports_tools: true,
            supports_reasoning: true,
          },
        },
      },
    };

    expect(listModelsDevProviderModels(catalog, 'openai')).toEqual(['gpt-4o-mini']);
    expect(listModelsDevProviderModels(catalog, 'kimi')).toEqual(['kimi-k2']);

    expect(lookupModelsDevModelCapability(catalog, 'openai', 'gpt-4o-mini')).toEqual({
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

    expect(lookupModelsDevModelCapability(catalog, 'kimi', 'kimi-k2')).toEqual({
      providerType: 'kimi',
      providerKey: 'moonshotai',
      modelId: 'kimi-k2',
      displayName: 'Kimi K2',
      contextWindow: 64000,
      maxInputTokens: 64000,
      maxOutputTokens: 8000,
      supportsToolCalls: true,
      supportsReasoning: true,
      source: 'models.dev',
    });
  });

  it('returns null when a provider or model is not present', () => {
    const catalog: ModelsDevCatalog = {};

    expect(listModelsDevProviderModels(catalog, 'openai')).toEqual([]);
    expect(lookupModelsDevModelCapability(catalog, 'openai', 'gpt-4o-mini')).toBeNull();
  });

  it('parses, normalizes, and serializes stored provider model options', () => {
    const parsed = parseProviderModelOptionsMap(
      JSON.stringify({
        'gpt-5.4': {
          displayName: 'GPT-5.4',
          contextWindow: '400000',
          supportsToolCalls: true,
          supportsReasoning: true,
          providerOptions: {
            reasoningEffort: 'medium',
            parallelToolCalls: true,
          },
        },
      })
    );

    expect(getProviderModelOptions(parsed, 'gpt-5.4')).toEqual({
      displayName: 'GPT-5.4',
      contextWindow: 400000,
      supportsToolCalls: true,
      supportsReasoning: true,
      providerOptions: {
        parallelToolCalls: true,
        reasoningEffort: 'medium',
      },
    });

    expect(JSON.parse(serializeProviderModelOptionsMap(parsed, ['gpt-5.4']))).toEqual({
      'gpt-5.4': {
        contextWindow: 400000,
        displayName: 'GPT-5.4',
        providerOptions: {
          parallelToolCalls: true,
          reasoningEffort: 'medium',
        },
        supportsReasoning: true,
        supportsToolCalls: true,
      },
    });
  });

  it('lets provider model options override catalog capability fields', () => {
    const catalogCapability = lookupModelsDevModelCapability(
      {
        openai: {
          models: {
            'gpt-5.4': {
              name: 'GPT-5.4',
              limit: {
                context: 128000,
                output: 16384,
              },
              tool_call: false,
              reasoning: false,
            },
          },
        },
      },
      'openai',
      'gpt-5.4'
    );

    expect(createModelCapabilityFromProviderModelOptions('openai', 'gpt-5.4', {
      contextWindow: 400000,
      supportsToolCalls: true,
      supportsReasoning: true,
    })).toEqual({
      providerType: 'openai',
      providerKey: 'openai',
      modelId: 'gpt-5.4',
      displayName: 'gpt-5.4',
      contextWindow: 400000,
      maxInputTokens: 400000,
      maxOutputTokens: null,
      supportsToolCalls: true,
      supportsReasoning: true,
      source: 'provider',
    });

    expect(
      mergeModelCapability(catalogCapability, 'openai', 'gpt-5.4', {
        contextWindow: 400000,
        supportsToolCalls: true,
        supportsReasoning: true,
      })
    ).toEqual({
      providerType: 'openai',
      providerKey: 'openai',
      modelId: 'gpt-5.4',
      displayName: 'gpt-5.4',
      contextWindow: 400000,
      maxInputTokens: 400000,
      maxOutputTokens: 16384,
      supportsToolCalls: true,
      supportsReasoning: true,
      source: 'provider',
    });
  });
});
