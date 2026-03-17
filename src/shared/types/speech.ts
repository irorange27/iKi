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
};
