import { describe, expect, it } from 'vitest';

import {
  createModelCapabilityFromProviderModelOptions,
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
  ensureModelCapability,
  getModelsDevProviderKey,
  getProviderModelOptions,
  listModelsDevProviderModels,
  lookupModelsDevModelCapability,
  mergeModelCapability,
  normalizeModelCapabilityLimits,
  parseModelList,
  parseProviderModelOptionsMap,
  serializeProviderModelOptionsMap,
  type ModelsDevCatalog,
} from '@iki/backend/utils/provider_models';

describe('provider_models helpers', () => {
  it('parses stored provider model lists from JSON strings', () => {
    expect(parseModelList('["gpt-4o-mini"," gpt-4.1 "]')).toEqual(['gpt-4o-mini', 'gpt-4.1']);
    expect(parseModelList('')).toEqual([]);
    expect(parseModelList('{')).toEqual([]);
  });

  it('maps provider aliases to models.dev provider keys', () => {
    expect(getModelsDevProviderKey('kimi')).toBe('moonshotai');
    expect(getModelsDevProviderKey('moonshot')).toBe('moonshotai');
    expect(getModelsDevProviderKey('minimax')).toBe('minimax-cn');
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
            // The REAL models.dev shape for vision: a modalities object with
            // an input array. The flat vision/supportsVision keys do not
            // exist in the live catalog (verified across all 9048 records),
            // so vision must be read from here.
            modalities: { input: ['text', 'image'], output: ['text'] },
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
      'minimax-cn': {
        models: {
          'MiniMax-M2': {
            name: 'MiniMax M2',
            limits: {
              context: '1000000',
              output: '80000',
            },
            supports_tools: true,
            supports_reasoning: true,
          },
        },
      },
    };

    expect(listModelsDevProviderModels(catalog, 'openai')).toEqual(['gpt-4o-mini']);
    expect(listModelsDevProviderModels(catalog, 'kimi')).toEqual(['kimi-k2']);
    expect(listModelsDevProviderModels(catalog, 'minimax')).toEqual(['MiniMax-M2']);

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
      supportsVision: true,
      modalities: ['text', 'image'],
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

    expect(lookupModelsDevModelCapability(catalog, 'minimax', 'MiniMax-M2')).toEqual({
      providerType: 'minimax',
      providerKey: 'minimax-cn',
      modelId: 'MiniMax-M2',
      displayName: 'MiniMax M2',
      contextWindow: 1000000,
      maxInputTokens: 1000000,
      maxOutputTokens: 80000,
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

  it('reads modalities and per-million-token cost rates from a live models.dev record', () => {
    // The exact record shape models.dev serves for anthropic's Sonnet:
    // modalities.input carries the vision signal, cost carries USD per
    // MILLION tokens in snake_case (cache_read/cache_write), and both are
    // absent from every stored-options path.
    const capability = lookupModelsDevModelCapability(
      {
        anthropic: {
          models: {
            'claude-sonnet-4-5': {
              name: 'Claude Sonnet 4.5 (latest)',
              tool_call: true,
              reasoning: true,
              modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
              limit: { context: 200000, output: 64000 },
              cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
            },
          },
        },
      },
      'anthropic',
      'claude-sonnet-4-5'
    );

    expect(capability).toEqual({
      providerType: 'anthropic',
      providerKey: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      displayName: 'Claude Sonnet 4.5 (latest)',
      contextWindow: 200000,
      maxInputTokens: 200000,
      maxOutputTokens: 64000,
      supportsToolCalls: true,
      supportsReasoning: true,
      supportsVision: true,
      modalities: ['text', 'image', 'pdf'],
      costPerMillionTokens: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      source: 'models.dev',
    });

    // Stored options can flip the vision FLAG; the modality list and the
    // cost rates have no stored counterpart and ride the catalog record.
    // (displayName falls back to the model id: the stored options carry
    // none, and an empty string is not a display name.)
    expect(
      mergeModelCapability(capability, 'anthropic', 'claude-sonnet-4-5', {
        supportsVision: false,
        contextWindow: 150000,
      })
    ).toEqual({
      providerType: 'anthropic',
      providerKey: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      displayName: 'claude-sonnet-4-5',
      contextWindow: 150000,
      maxInputTokens: 150000,
      maxOutputTokens: 64000,
      supportsToolCalls: true,
      supportsReasoning: true,
      supportsVision: false,
      modalities: ['text', 'image', 'pdf'],
      costPerMillionTokens: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      source: 'provider',
    });
  });

  it('leaves cost and modalities absent for unpriced and provider-only models', () => {
    // A catalog model with no cost record (5% of the catalog) — "unpriced"
    // must stay distinguishable from "free".
    const unpriced = lookupModelsDevModelCapability(
      {
        openai: {
          models: {
            'free-model': { name: 'Free', modalities: { input: ['text'] } },
          },
        },
      },
      'openai',
      'free-model'
    );
    expect(unpriced?.costPerMillionTokens).toBeUndefined();
    expect(unpriced?.modalities).toEqual(['text']);

    // Stored-options capabilities carry neither field.
    expect(createModelCapabilityFromProviderModelOptions('openai', 'm', { displayName: 'M' })).toEqual(
      {
        providerType: 'openai',
        providerKey: 'openai',
        modelId: 'm',
        displayName: 'M',
        contextWindow: null,
        maxInputTokens: null,
        maxOutputTokens: null,
        supportsToolCalls: null,
        supportsReasoning: null,
        source: 'provider',
      }
    );
  });

  it('leaves an undeclared output limit null instead of guessing one', () => {
    expect(normalizeModelCapabilityLimits()).toEqual({
      contextWindow: DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
      maxInputTokens: DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
      // Regression: this used to be 393_216 (384K). That guess is sent to the
      // provider as the request's hard max_tokens, so every model whose real
      // ceiling is lower (e.g. 131_072) rejected every turn with HTTP 400.
      // Unknown must stay unknown so the provider applies its own default.
      maxOutputTokens: null,
    });

    // Unknown models still assume a modern multimodal reasoner for the INPUT
    // side (1M window, text/image/reasoning/tools), but assert nothing about
    // the output ceiling.
    expect(ensureModelCapability('openai', 'gpt-unknown')).toEqual({
      providerType: 'openai',
      providerKey: 'openai',
      modelId: 'gpt-unknown',
      displayName: 'gpt-unknown',
      contextWindow: DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
      maxInputTokens: DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
      maxOutputTokens: null,
      supportsToolCalls: true,
      supportsReasoning: true,
      supportsVision: true,
      source: 'default',
    });
  });

  it('keeps a declared output limit for a custom provider', () => {
    // The exact shape that broke every custom provider: no catalog entry, no
    // stored override. Resolution must not invent a ceiling.
    const resolved = ensureModelCapability('custom', 'zcode/GLM-5.3-Flash');
    expect(resolved.maxOutputTokens).toBeNull();

    // A stored override is trusted as-is (it is the operator's declaration).
    const declared = ensureModelCapability(
      'custom',
      'zcode/GLM-5.3-Flash',
      null,
      { maxOutputTokens: 128_000 }
    );
    expect(declared.maxOutputTokens).toBe(128_000);
  });

  it('clamps deepseek max output tokens to the API hard cap', () => {
    const clamped = ensureModelCapability('deepseek', 'deepseek-v4.1-flash', {
      providerType: 'deepseek',
      providerKey: 'deepseek',
      modelId: 'deepseek-v4.1-flash',
      displayName: 'DeepSeek V4.1 Flash',
      contextWindow: 1_000_000,
      maxInputTokens: 1_000_000,
      maxOutputTokens: 1_000_000,
      supportsToolCalls: true,
      supportsReasoning: true,
      source: 'provider',
    });
    expect(clamped.maxOutputTokens).toBe(393_216);
    expect(clamped.contextWindow).toBe(1_000_000);

    const uncappedProvider = ensureModelCapability('deepseek', 'deepseek-v4.1-flash', {
      providerType: 'deepseek',
      providerKey: 'deepseek',
      modelId: 'deepseek-v4.1-flash',
      displayName: 'DeepSeek V4.1 Flash',
      contextWindow: 1_000_000,
      maxInputTokens: 1_000_000,
      maxOutputTokens: 8_192,
      supportsToolCalls: true,
      supportsReasoning: true,
      source: 'provider',
    });
    expect(uncappedProvider.maxOutputTokens).toBe(8_192);

    const otherProvider = ensureModelCapability('openai', 'gpt-x', {
      providerType: 'openai',
      providerKey: 'openai',
      modelId: 'gpt-x',
      displayName: 'GPT X',
      contextWindow: 1_000_000,
      maxInputTokens: 1_000_000,
      maxOutputTokens: 1_000_000,
      supportsToolCalls: true,
      supportsReasoning: null,
      source: 'provider',
    });
    expect(otherProvider.maxOutputTokens).toBe(1_000_000);
  });
});
