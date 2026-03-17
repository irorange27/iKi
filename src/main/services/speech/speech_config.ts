import { getConfig } from '../../../core/db/database';
import type { AppConfig } from '../../../shared/types/config';

export const DEFAULT_OPENAI_MODEL = 'whisper-1';
export const DEFAULT_WHISPER_NODE_MODEL = 'base.en';
export const DEFAULT_WHISPER_MODEL_BASE_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
export const FALLBACK_WHISPER_MODEL_BASE_URLS = [
  'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main',
];

export const DEFAULT_SPEECH_CONFIG: AppConfig['speech'] = {
  enabled: false,
  providerType: 'openai',
  apiKey: '',
  baseUrl: '',
  downloadBaseUrl: '',
  model: DEFAULT_OPENAI_MODEL,
  modelPath: '',
  language: '',
  prompt: '',
};

export const getSpeechConfig = (): AppConfig['speech'] => {
  const rawConfig = getConfig('app_config') as Partial<AppConfig> | null;
  return {
    ...DEFAULT_SPEECH_CONFIG,
    ...(rawConfig?.speech || {}),
  };
};

export const normalizeOpenAiBaseUrl = (baseUrl?: string): string => {
  const trimmed = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  const fallback = 'https://api.openai.com/v1';
  const base = trimmed.length > 0 ? trimmed : fallback;
  const withoutTrailing = base.endsWith('/') ? base.slice(0, -1) : base;
  if (withoutTrailing.endsWith('/v1')) return withoutTrailing;
  return `${withoutTrailing}/v1`;
};

export const resolveWhisperNodeModelName = (model?: string): string => {
  const trimmed = typeof model === 'string' ? model.trim() : '';
  if (!trimmed || trimmed === DEFAULT_OPENAI_MODEL) {
    return DEFAULT_WHISPER_NODE_MODEL;
  }
  return trimmed;
};
