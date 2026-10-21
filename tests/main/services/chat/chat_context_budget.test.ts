import { describe, expect, it } from 'vitest';

import { deriveModelAwareContextConfig } from '@iki/backend/turn_prep/context_budget';

const baseConfig = {
  enabled: true,
  maxIdentityTokens: 320,
  maxSkillTokens: 1200,
} as const;

describe('chat_context_budget', () => {
  it('keeps the configured budgets when no model capability is available', () => {
    const result = deriveModelAwareContextConfig(baseConfig);

    expect(result.maxIdentityTokens).toBe(baseConfig.maxIdentityTokens);
    expect(result.maxSkillTokens).toBe(baseConfig.maxSkillTokens);
    expect(result.budgetScale).toBe(1);
    expect(result.availableContextTokens).toBeNull();
    expect(result.maxOutputTokens).toBeNull();
  });

  it('shrinks the live clipping caps when the window cannot hold them', () => {
    const result = deriveModelAwareContextConfig(baseConfig, {
      providerType: 'openai',
      providerKey: 'openai',
      modelId: 'gpt-small',
      displayName: 'GPT Small',
      contextWindow: 1024,
      maxInputTokens: 1024,
      maxOutputTokens: 256,
      supportsToolCalls: true,
      supportsReasoning: false,
      source: 'models.dev',
    });

    expect(result.availableContextTokens).toBeLessThan(result.requestedContextTokens);
    expect(result.maxIdentityTokens).toBeLessThan(baseConfig.maxIdentityTokens);
    expect(result.maxSkillTokens).toBeLessThan(baseConfig.maxSkillTokens);
    expect(result.maxOutputTokens).toBe(256);

    const totalBudget = result.maxIdentityTokens + result.maxSkillTokens;
    expect(totalBudget).toBeLessThanOrEqual(result.availableContextTokens || 0);
  });

  it('leaves the live caps untouched when the window can hold them', () => {
    const result = deriveModelAwareContextConfig(baseConfig, {
      providerType: 'openai',
      providerKey: 'openai',
      modelId: 'gpt-small',
      displayName: 'GPT Small',
      contextWindow: 4096,
      maxInputTokens: 4096,
      maxOutputTokens: 1024,
      supportsToolCalls: true,
      supportsReasoning: false,
      source: 'models.dev',
    });

    expect(result.maxIdentityTokens).toBe(baseConfig.maxIdentityTokens);
    expect(result.maxSkillTokens).toBe(baseConfig.maxSkillTokens);
    expect(result.budgetScale).toBe(1);
  });

  it('does not expand budgets above the configured defaults for large-context models', () => {
    const result = deriveModelAwareContextConfig(baseConfig, {
      providerType: 'openai',
      providerKey: 'openai',
      modelId: 'gpt-4.1',
      displayName: 'GPT-4.1',
      contextWindow: 1048576,
      maxInputTokens: 1048576,
      maxOutputTokens: 32768,
      supportsToolCalls: true,
      supportsReasoning: true,
      source: 'models.dev',
    });

    expect(result.maxIdentityTokens).toBe(baseConfig.maxIdentityTokens);
    expect(result.maxSkillTokens).toBe(baseConfig.maxSkillTokens);
    expect(result.budgetScale).toBe(1);
    expect(result.maxOutputTokens).toBe(32768);
  });
});
