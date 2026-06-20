import type { AffectLabel, AffectScore } from '@iki/backend/types/affect';

export type AudioEmotionResult = {
  label: AffectLabel;
  confidence: number;
  valence?: number;
  arousal?: number;
  emotions?: AffectScore[];
  source: 'mimo-audio';
  providerType: string;
  model: string;
};

export type SpeechProviderType = 'openai' | 'whisper-node';

export type SpeechStatus = {
  available: boolean;
  enabled?: boolean;
  providerType?: SpeechProviderType;
  model?: string;
  language?: string;
  prompt?: string;
  reason?: string;
};

export type SpeechTranscriptionInput = {
  audioBase64: string;
  mimeType?: string;
  language?: string;
  model?: string;
  prompt?: string;
};

export type SpeechTranscriptionResult = {
  text: string;
  providerType: SpeechProviderType;
  model: string;
  audioEmotion?: AudioEmotionResult;
};

export type WhisperNodeModelInfo = {
  name: string;
  fileName: string;
  sizeMB: number;
  ramGB: number;
  downloaded: boolean;
  status?: 'missing' | 'ready' | 'invalid';
  error?: string;
};

export type WhisperNodeDownloadResult = {
  model: string;
  success: boolean;
  error?: string;
};

export type WhisperNodeDownloadProgress = {
  model: string;
  stage: 'downloading' | 'compiling' | 'done' | 'error';
  message?: string;
  progress?: number;
  downloadedBytes?: number;
  totalBytes?: number;
};
