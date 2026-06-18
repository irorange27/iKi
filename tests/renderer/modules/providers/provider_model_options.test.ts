import { describe, expect, it } from 'vitest';

import {
  buildProviderModelOptions,
  createModelOptionsEditorState,
  getModelOptionSummary,
  parseModelProviderOptions,
} from '../../../../packages/desktop/src/renderer/modules/providers/provider_model_options';

describe('provider_model_options helpers', () => {
  it('normalizes a model options editor state into persisted provider model options', () => {
    const result = buildProviderModelOptions({
      providerId: 'openai_1',
      modelId: 'gpt-5.4',
      displayName: 'GPT-5.4 Gateway',
      contextWindow: '400000',
      maxInputTokens: '',
      maxOutputTokens: '',
      supportsToolCalls: 'true',
      supportsReasoning: 'true',
      supportsVision: 'default',
      supportsStructuredOutputs: 'default',
      providerOptionsJson: '{"reasoningEffort":"medium","parallelToolCalls":true}',
    });

    expect(result).toEqual({
      options: {
        contextWindow: 400000,
        displayName: 'GPT-5.4 Gateway',
        providerOptions: {
          parallelToolCalls: true,
          reasoningEffort: 'medium',
        },
        supportsReasoning: true,
        supportsToolCalls: true,
      },
    });
  });

  it('returns a validation code when provider options JSON is invalid', () => {
    expect(parseModelProviderOptions('gpt-5.4', '{"broken"')).toEqual({
      errorCode: 'invalidJson',
    });

    expect(parseModelProviderOptions('gpt-5.4', '["not-an-object"]')).toEqual({
      errorCode: 'objectRequired',
    });
  });

  it('builds editor state defaults and model summaries for user-facing display', () => {
    expect(
      createModelOptionsEditorState('openai_1', 'gpt-5.4', {
        displayName: 'GPT-5.4 Gateway',
        contextWindow: 400000,
        supportsVision: true,
      })
    ).toEqual({
      providerId: 'openai_1',
      modelId: 'gpt-5.4',
      displayName: 'GPT-5.4 Gateway',
      contextWindow: '400000',
      maxInputTokens: '',
      maxOutputTokens: '',
      supportsToolCalls: 'default',
      supportsReasoning: 'default',
      supportsVision: 'true',
      supportsStructuredOutputs: 'default',
      providerOptionsJson: '',
    });

    expect(
      getModelOptionSummary(
        {
          contextWindow: 400000,
          supportsToolCalls: true,
          supportsVision: true,
        },
        {
          vision: 'Vision',
          tools: 'Tools',
          reasoning: 'Reasoning',
          structuredOutputs: 'Structured Outputs',
          contextWindow: count => `Context ${count}`,
        }
      )
    ).toBe('Vision · Tools · Context 400K');
  });
});
