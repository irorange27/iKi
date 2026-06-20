import type { JSONValue } from '@ai-sdk/provider';

import type { ProviderModelOptions } from '@iki/backend/types/provider';
import { parseProviderModelOptionsMap } from '@iki/backend/utils/provider_models';

export type ModelBooleanOverride = 'default' | 'true' | 'false';

export type ModelOptionValidationErrorCode = 'invalidJson' | 'objectRequired';

export type ModelOptionsEditorState = {
  providerId: string;
  modelId: string;
  displayName: string;
  contextWindow: string;
  maxInputTokens: string;
  maxOutputTokens: string;
  supportsToolCalls: ModelBooleanOverride;
  supportsReasoning: ModelBooleanOverride;
  supportsVision: ModelBooleanOverride;
  supportsStructuredOutputs: ModelBooleanOverride;
  providerOptionsJson: string;
  errorCode?: ModelOptionValidationErrorCode;
};

export const toBooleanOverride = (value?: boolean | null): ModelBooleanOverride => {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return 'default';
};

export const fromBooleanOverride = (value: ModelBooleanOverride): boolean | undefined => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
};

export const formatCompactTokenCount = (value: number): string => {
  if (value >= 1000000) {
    const rounded = Math.round((value / 1000000) * 10) / 10;
    return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded}M`;
  }

  if (value >= 1000) {
    const rounded = Math.round((value / 1000) * 10) / 10;
    return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded}K`;
  }

  return String(value);
};

export const parseOptionalPositiveIntegerInput = (
  value: string | number | null | undefined
): number | undefined => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return undefined;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.trunc(parsed);
};

export const formatProviderOptionsJson = (value?: Record<string, JSONValue> | null): string =>
  value && Object.keys(value).length > 0 ? JSON.stringify(value, null, 2) : '';

export const createModelOptionsEditorState = (
  providerId: string,
  modelId: string,
  modelOptions?: ProviderModelOptions | null
): ModelOptionsEditorState => ({
  providerId,
  modelId,
  displayName: modelOptions?.displayName || '',
  contextWindow:
    typeof modelOptions?.contextWindow === 'number' ? String(modelOptions.contextWindow) : '',
  maxInputTokens:
    typeof modelOptions?.maxInputTokens === 'number' ? String(modelOptions.maxInputTokens) : '',
  maxOutputTokens:
    typeof modelOptions?.maxOutputTokens === 'number' ? String(modelOptions.maxOutputTokens) : '',
  supportsToolCalls: toBooleanOverride(modelOptions?.supportsToolCalls),
  supportsReasoning: toBooleanOverride(modelOptions?.supportsReasoning),
  supportsVision: toBooleanOverride(modelOptions?.supportsVision),
  supportsStructuredOutputs: toBooleanOverride(modelOptions?.supportsStructuredOutputs),
  providerOptionsJson: formatProviderOptionsJson(modelOptions?.providerOptions),
});

export const parseModelProviderOptions = (
  modelId: string,
  providerOptionsJson: string
): {
  providerOptions?: Record<string, JSONValue>;
  errorCode?: ModelOptionValidationErrorCode;
} => {
  const trimmed = providerOptionsJson.trim();
  if (!trimmed) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      errorCode: 'invalidJson',
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      errorCode: 'objectRequired',
    };
  }

  const normalized = parseProviderModelOptionsMap({
    [modelId]: {
      providerOptions: parsed,
    },
  });

  const providerOptions = normalized[modelId]?.providerOptions;
  return providerOptions && Object.keys(providerOptions).length > 0 ? { providerOptions } : {};
};

export const buildProviderModelOptions = (
  editor: ModelOptionsEditorState
): {
  options: ProviderModelOptions;
  errorCode?: ModelOptionValidationErrorCode;
} => {
  const { providerOptions, errorCode } = parseModelProviderOptions(
    editor.modelId,
    editor.providerOptionsJson
  );
  if (errorCode) {
    return {
      options: {},
      errorCode,
    };
  }

  const nextOptions: ProviderModelOptions = {};
  const displayName = editor.displayName.trim();
  const contextWindow = parseOptionalPositiveIntegerInput(editor.contextWindow);
  const maxInputTokens = parseOptionalPositiveIntegerInput(editor.maxInputTokens);
  const maxOutputTokens = parseOptionalPositiveIntegerInput(editor.maxOutputTokens);
  const supportsToolCalls = fromBooleanOverride(editor.supportsToolCalls);
  const supportsReasoning = fromBooleanOverride(editor.supportsReasoning);
  const supportsVision = fromBooleanOverride(editor.supportsVision);
  const supportsStructuredOutputs = fromBooleanOverride(editor.supportsStructuredOutputs);

  if (displayName) nextOptions.displayName = displayName;
  if (contextWindow !== undefined) nextOptions.contextWindow = contextWindow;
  if (maxInputTokens !== undefined) nextOptions.maxInputTokens = maxInputTokens;
  if (maxOutputTokens !== undefined) nextOptions.maxOutputTokens = maxOutputTokens;
  if (supportsToolCalls !== undefined) nextOptions.supportsToolCalls = supportsToolCalls;
  if (supportsReasoning !== undefined) nextOptions.supportsReasoning = supportsReasoning;
  if (supportsVision !== undefined) nextOptions.supportsVision = supportsVision;
  if (supportsStructuredOutputs !== undefined) {
    nextOptions.supportsStructuredOutputs = supportsStructuredOutputs;
  }
  if (providerOptions && Object.keys(providerOptions).length > 0) {
    nextOptions.providerOptions = providerOptions;
  }

  return {
    options: nextOptions,
  };
};

export const getModelOptionSummary = (
  modelOptions: ProviderModelOptions | null | undefined,
  labels: {
    vision: string;
    tools: string;
    reasoning: string;
    structuredOutputs: string;
    contextWindow: (count: string) => string;
  }
): string => {
  if (!modelOptions) return '';

  const parts: string[] = [];
  if (modelOptions.supportsVision === true) {
    parts.push(labels.vision);
  }
  if (modelOptions.supportsToolCalls === true) {
    parts.push(labels.tools);
  }
  if (modelOptions.supportsReasoning === true) {
    parts.push(labels.reasoning);
  }
  if (modelOptions.supportsStructuredOutputs === true) {
    parts.push(labels.structuredOutputs);
  }
  if (typeof modelOptions.contextWindow === 'number' && modelOptions.contextWindow > 0) {
    parts.push(labels.contextWindow(formatCompactTokenCount(modelOptions.contextWindow)));
  }

  return parts.join(' · ');
};
