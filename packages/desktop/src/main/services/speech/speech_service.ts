import type {
  SpeechStatus,
  SpeechTranscriptionInput,
  SpeechTranscriptionResult,
} from '@iki/backend/types/speech';
import { DEFAULT_OPENAI_MODEL, getSpeechConfig, normalizeOpenAiBaseUrl } from './speech_config';
import { getAudioExtension } from './speech_audio';
import { analyzeAudioEmotion, isAudioEmotionAvailable } from './speech_emotion';
import {
  downloadWhisperNodeModel,
  getWhisperNodeStatus,
  listWhisperNodeModels,
  transcribeWithWhisperNode,
} from './speech_whisper';

export { downloadWhisperNodeModel, listWhisperNodeModels };

export const getSpeechStatus = (): SpeechStatus => {
  const config = getSpeechConfig();
  if (!config.enabled) {
    return {
      available: false,
      enabled: false,
      providerType: config.providerType || undefined,
      reason: 'Speech input disabled',
    };
  }
  if (config.providerType === 'whisper-node') {
    return getWhisperNodeStatus(config);
  }
  if (config.providerType !== 'openai') {
    return {
      available: false,
      enabled: true,
      providerType: config.providerType || undefined,
      reason: 'Unsupported speech provider',
    };
  }
  if (!config.apiKey || !config.apiKey.trim()) {
    return {
      available: false,
      enabled: true,
      providerType: config.providerType,
      reason: 'Speech API key not configured',
    };
  }
  return {
    available: true,
    enabled: true,
    providerType: 'openai',
    model: config.model || DEFAULT_OPENAI_MODEL,
    language: config.language || undefined,
    prompt: config.prompt || undefined,
  };
};

export const transcribeSpeech = async (
  input: SpeechTranscriptionInput
): Promise<SpeechTranscriptionResult> => {
  const status = getSpeechStatus();
  if (!status.available) {
    throw new Error(status.reason || 'Speech provider not available');
  }

  const config = getSpeechConfig();
  let result: SpeechTranscriptionResult;
  if (config.providerType === 'whisper-node') {
    result = await transcribeWithWhisperNode(config, input);
  } else {
    const model = input.model || status.model || config.model || DEFAULT_OPENAI_MODEL;
    const baseUrl = normalizeOpenAiBaseUrl(config.baseUrl);
    const endpoint = `${baseUrl}/audio/transcriptions`;

    const mimeType = input.mimeType && input.mimeType.trim() ? input.mimeType : 'audio/webm';
    const extension = getAudioExtension(mimeType);
    const fileName = `speech.${extension}`;

    const buffer = Buffer.from(input.audioBase64, 'base64');
    const form = new FormData();
    const blob = new Blob([buffer], { type: mimeType });
    form.append('file', blob, fileName);
    form.append('model', model);
    const language = input.language || config.language;
    if (language && language.trim()) {
      form.append('language', language.trim());
    }
    const prompt = input.prompt || config.prompt;
    if (prompt && prompt.trim()) {
      form.append('prompt', prompt.trim());
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: form,
    });

    if (!response.ok) {
      const errorText = await response.text();
      const message =
        errorText && errorText.trim().length > 0
          ? errorText.trim()
          : response.statusText || 'Unknown error';
      throw new Error(`Speech transcription failed (${response.status}): ${message}`);
    }

    const data = (await response.json()) as { text?: unknown };
    const text = typeof data.text === 'string' ? data.text.trim() : '';

    result = {
      text,
      providerType: 'openai',
      model,
    };
  }

  if (isAudioEmotionAvailable() && input.audioBase64) {
    const mimeType = input.mimeType || 'audio/webm';
    try {
      const audioEmotion = await analyzeAudioEmotion(input.audioBase64, mimeType);
      if (audioEmotion) {
        result = { ...result, audioEmotion };
      }
    } catch {
      // Audio emotion is best-effort; don't block STT
    }
  }

  return result;
};
