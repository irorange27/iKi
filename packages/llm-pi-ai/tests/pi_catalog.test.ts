import { describe, expect, it } from 'vitest';
import {
  detectPiEnvProviders,
  getPiBuiltinProvider,
  listPiBuiltinModelIds,
  listPiBuiltinProviders,
  lookupPiBuiltinModel,
} from '../src/pi_catalog';
import { resolveProviderApi } from '../src/factory';
import { buildPiModel } from '../src/pi_adapter';

describe('@iki/llm-pi-ai full pi-ai provider catalog & API dispatch', () => {
  it('exposes 40+ built-in pi-ai providers with models and native APIs', () => {
    const providers = listPiBuiltinProviders();
    expect(providers.length).toBeGreaterThanOrEqual(40);

    const ids = new Set(providers.map(p => p.id));
    for (const expected of [
      'anthropic',
      'openai',
      'google',
      'google-vertex',
      'amazon-bedrock',
      'azure',
      'deepseek',
      'openrouter',
      'mistral',
      'xai',
      'groq',
      'moonshotai-cn',
      'minimax',
      'zai-coding-cn',
      'qwen-token-plan-cn',
    ]) {
      expect(ids.has(expected)).toBe(true);
    }

    // Legacy alias `kimi` resolves onto `moonshotai-cn`
    expect(getPiBuiltinProvider('kimi')?.id).toBe('moonshotai-cn');
    expect(listPiBuiltinModelIds('google').length).toBeGreaterThan(5);
  });

  it('resolves native wire APIs across all pi-ai providers instead of limiting to 3 static entries', () => {
    expect(resolveProviderApi('google', { isResponseApi: false })).toBe('google-generative-ai');
    expect(resolveProviderApi('google-vertex', { isResponseApi: false })).toBe('google-vertex');
    expect(resolveProviderApi('amazon-bedrock', { isResponseApi: false })).toBe('bedrock-converse-stream');
    expect(resolveProviderApi('azure', { isResponseApi: false })).toBe('azure-openai-responses');
    expect(resolveProviderApi('mistral', { isResponseApi: false })).toBe('mistral-conversations');
    expect(resolveProviderApi('openai-codex', { isResponseApi: false })).toBe('openai-codex-responses');
    expect(resolveProviderApi('anthropic', { isResponseApi: false })).toBe('anthropic-messages');
    expect(resolveProviderApi('openai', { isResponseApi: false })).toBe('openai-responses');
    expect(resolveProviderApi('groq', { isResponseApi: false })).toBe('openai-completions');
    expect(resolveProviderApi('anthropic-compatible', { isResponseApi: false })).toBe('anthropic-messages');
    expect(resolveProviderApi('custom-gateway', { isResponseApi: true })).toBe('openai-responses');

    const gemini = lookupPiBuiltinModel('google', listPiBuiltinModelIds('google')[0]!);
    expect(gemini).not.toBeNull();
    const built = buildPiModel({
      id: gemini!.id,
      providerType: 'google',
      baseUrl: gemini!.baseUrl,
      api: 'google-generative-ai',
      contextWindow: gemini!.contextWindow,
      maxTokens: gemini!.maxTokens,
    });
    expect(built.api).toBe('google-generative-ai');
    expect(built.compat).toBeUndefined();
  });

  it('auto-detects API keys across diverse pi-ai providers via pi-ai env mapping', () => {
    const detected = detectPiEnvProviders({
      GEMINI_API_KEY: 'gm-key',
      GROQ_API_KEY: 'gsk-key',
      MISTRAL_API_KEY: 'ms-key',
      XAI_API_KEY: 'xai-key',
      DEEPSEEK_API_KEY: 'ds-key',
      DEEPSEEK_MODEL: 'deepseek-reasoner',
      IKI_BASE_URL: 'http://127.0.0.1:3425/v1',
      IKI_API_KEY: 'local-key',
      IKI_MODEL: 'auto/deepseek-v4-flash',
    });

    const byId = new Map(detected.map(d => [d.id, d]));
    expect(byId.get('custom')).toMatchObject({
      type: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:3425/v1',
      models: ['auto/deepseek-v4-flash'],
    });
    expect(byId.get('google')).toMatchObject({ type: 'google', apiKey: 'gm-key', sourceEnv: 'GEMINI_API_KEY' });
    expect(byId.get('groq')).toMatchObject({ type: 'groq', apiKey: 'gsk-key', sourceEnv: 'GROQ_API_KEY' });
    expect(byId.get('mistral')).toMatchObject({ type: 'mistral', apiKey: 'ms-key', sourceEnv: 'MISTRAL_API_KEY' });
    expect(byId.get('xai')).toMatchObject({ type: 'xai', apiKey: 'xai-key', sourceEnv: 'XAI_API_KEY' });
    expect(byId.get('deepseek')).toMatchObject({
      type: 'deepseek',
      apiKey: 'ds-key',
      models: ['deepseek-reasoner'],
    });
  });
});
