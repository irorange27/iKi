import { describe, expect, it } from 'vitest';

import { deriveModelAwareContextConfig } from '../../../../src/main/services/chat/chat_context_budget';

const baseConfig = {
  enabled: true,
  recentMessageCount: 10,
  maxRecentTokens: 2400,
  maxMessageTokens: 420,
  maxIdentityTokens: 320,
  maxRelationshipTokens: 220,
  maxLifeStateTokens: 220,
  maxReflectionTokens: 240,
  summaryTriggerMessages: 14,
  summaryRecentMessages: 6,
  maxSummaryTokens: 500,
  maxMemoryTokens: 500,
  maxSkillTokens: 1200,
} as const;

describe('chat_context_budget', () => {
  it('keeps the configured budgets when no model capability is available', () => {
    const result = deriveModelAwareContextConfig(baseConfig);

    expect(result.maxRecentTokens).toBe(baseConfig.maxRecentTokens);
    expect(result.maxSkillTokens).toBe(baseConfig.maxSkillTokens);
    expect(result.budgetScale).toBe(1);
    expect(result.availableContextTokens).toBeNull();
    expect(result.reservedOutputTokens).toBeNull();
  });

  it('shrinks context budgets to fit smaller model input limits', () => {
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

    expect(result.availableContextTokens).toBeLessThan(result.requestedContextTokens);
    expect(result.maxRecentTokens).toBeLessThan(baseConfig.maxRecentTokens);
    expect(result.maxSummaryTokens).toBeLessThan(baseConfig.maxSummaryTokens);
    expect(result.maxSkillTokens).toBeLessThan(baseConfig.maxSkillTokens);
    expect(result.maxMessageTokens).toBeLessThan(baseConfig.maxMessageTokens);

    const totalBudget =
      result.maxRecentTokens +
      result.maxIdentityTokens +
      result.maxRelationshipTokens +
      result.maxLifeStateTokens +
      result.maxReflectionTokens +
      result.maxSummaryTokens +
      result.maxMemoryTokens +
      result.maxSkillTokens;
    expect(totalBudget).toBeLessThanOrEqual(result.availableContextTokens || 0);
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

    expect(result.maxRecentTokens).toBe(baseConfig.maxRecentTokens);
    expect(result.maxSkillTokens).toBe(baseConfig.maxSkillTokens);
    expect(result.maxSummaryTokens).toBe(baseConfig.maxSummaryTokens);
    expect(result.budgetScale).toBe(1);
  });
});
