import { getConfig } from '../../../core/db/database';
import { createRequire } from 'node:module';
import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import type { AppConfig } from '../../../shared/types/config';
import type {
  SpeechStatus,
  SpeechTranscriptionInput,
  SpeechTranscriptionResult,
} from '../../../shared/types/speech';

const DEFAULT_OPENAI_MODEL = 'whisper-1';
const DEFAULT_WHISPER_NODE_MODEL = 'base.en';
const DEFAULT_SPEECH_CONFIG: AppConfig['speech'] = {
  enabled: false,
  providerType: 'openai',
  apiKey: '',
  baseUrl: '',
  model: DEFAULT_OPENAI_MODEL,
  modelPath: '',
  language: '',
  prompt: '',
};
const require = createRequire(import.meta.url);

const normalizeOpenAiBaseUrl = (baseUrl?: string): string => {
  const trimmed = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  const fallback = 'https://api.openai.com/v1';
  const base = trimmed.length > 0 ? trimmed : fallback;
  const withoutTrailing = base.endsWith('/') ? base.slice(0, -1) : base;
  if (withoutTrailing.endsWith('/v1')) return withoutTrailing;
  return `${withoutTrailing}/v1`;
};

const getAudioExtension = (mimeType?: string): string => {
  const normalized = typeof mimeType === 'string' ? mimeType.toLowerCase() : '';
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('mp4') || normalized.includes('m4a')) return 'm4a';
  if (normalized.includes('webm')) return 'webm';
  return 'audio';
};

const resolveWhisperNodeModelName = (model?: string): string => {
  const trimmed = typeof model === 'string' ? model.trim() : '';
  if (!trimmed || trimmed === DEFAULT_OPENAI_MODEL) {
    return DEFAULT_WHISPER_NODE_MODEL;
  }
  return trimmed;
};

const resolveFfmpegPath = (): string | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ffmpegStatic = require('ffmpeg-static') as unknown;
    if (typeof ffmpegStatic === 'string' && ffmpegStatic.trim()) {
      return ffmpegStatic;
    }
  } catch {
    // ignore
  }
  return null;
};

const resolveAvailableFfmpegPath = (): string | null => {
  const bundled = resolveFfmpegPath();
  if (bundled) return bundled;
  try {
    const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    if (probe.status === 0) return 'ffmpeg';
  } catch {
    // ignore
  }
  return null;
};

const isWhisperNodeInstalled = (): boolean => {
  try {
    require.resolve('whisper-node');
    return true;
  } catch {
    return false;
  }
};

const getSpeechConfig = (): AppConfig['speech'] => {
  const rawConfig = getConfig('app_config') as Partial<AppConfig> | null;
  return {
    ...DEFAULT_SPEECH_CONFIG,
    ...(rawConfig?.speech || {}),
  };
};

export const getSpeechStatus = (): SpeechStatus => {
  const config = getSpeechConfig();
  if (!config.enabled) {
    return {
      available: false,
      enabled: false,
      reason: 'Speech input disabled',
    };
  }
  if (config.providerType === 'whisper-node') {
    if (!isWhisperNodeInstalled()) {
      return {
        available: false,
        enabled: true,
        reason: 'whisper-node not installed',
      };
    }
    if (config.modelPath && config.modelPath.trim() && !existsSync(config.modelPath.trim())) {
      return {
        available: false,
        enabled: true,
        reason: 'Model path not found',
      };
    }
    const ffmpegPath = resolveAvailableFfmpegPath();
    if (!ffmpegPath) {
      return {
        available: false,
        enabled: true,
        reason: 'ffmpeg not available',
      };
    }
    return {
      available: true,
      enabled: true,
      providerType: 'whisper-node',
      model: resolveWhisperNodeModelName(config.model),
      language: config.language || undefined,
      prompt: config.prompt || undefined,
    };
  }
  if (config.providerType !== 'openai') {
    return {
      available: false,
      enabled: true,
      reason: 'Unsupported speech provider',
    };
  }
  if (!config.apiKey || !config.apiKey.trim()) {
    return {
      available: false,
      enabled: true,
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

const runFfmpeg = async (args: string[], ffmpegPath: string): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', data => {
      stderr += data.toString();
    });
    child.on('error', err => {
      reject(err);
    });
    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `ffmpeg exited with code ${code}`));
      }
    });
  });
};

const ensureTempDir = async (): Promise<string> => {
  const dir = path.join(os.tmpdir(), 'iki-speech');
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

const writeTempFile = async (buffer: Buffer, extension: string): Promise<string> => {
  const dir = await ensureTempDir();
  const safeExt = extension.replace(/[^a-z0-9]/gi, '') || 'audio';
  const filename = `speech_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, buffer);
  return filePath;
};

const convertToWav = async (inputPath: string, ffmpegPath: string): Promise<string> => {
  const outputPath = inputPath.replace(/\.[^/.]+$/, '') + '_16k.wav';
  await runFfmpeg(['-y', '-i', inputPath, '-ac', '1', '-ar', '16000', outputPath], ffmpegPath);
  return outputPath;
};

const parseWhisperNodeOutput = (result: unknown): string => {
  if (typeof result === 'string') return result.trim();
  if (Array.isArray(result)) {
    return result
      .map(item => {
        if (!item || typeof item !== 'object' || !('speech' in item)) return '';
        const speech = (item as { speech?: unknown }).speech;
        return typeof speech === 'string' ? speech : '';
      })
      .filter((text: string) => text.trim().length > 0)
      .join(' ')
      .trim();
  }
  if (result && typeof result === 'object' && 'text' in result) {
    const text = (result as { text?: unknown }).text;
    return typeof text === 'string' ? text.trim() : '';
  }
  return '';
};

const transcribeWithWhisperNode = async (
  config: AppConfig['speech'],
  input: SpeechTranscriptionInput
): Promise<SpeechTranscriptionResult> => {
  const ffmpegPath = resolveAvailableFfmpegPath();
  if (!ffmpegPath) {
    throw new Error('ffmpeg not available');
  }
  const extension = getAudioExtension(input.mimeType);
  const buffer = Buffer.from(input.audioBase64, 'base64');
  const inputPath = await writeTempFile(buffer, extension);
  let wavPath = '';
  try {
    wavPath = await convertToWav(inputPath, ffmpegPath);
    const whisperModule = (await import('whisper-node')) as unknown as {
      default?: (filePath: string, options?: unknown) => Promise<unknown>;
    };
    const whisper = whisperModule.default;
    if (typeof whisper !== 'function') {
      throw new Error('whisper-node not available');
    }

    const modelPath = config.modelPath?.trim();
    const modelName = resolveWhisperNodeModelName(config.model);
    const language = input.language || config.language || 'auto';
    const options: Record<string, unknown> = {
      whisperOptions: {
        language: language.trim() ? language.trim() : 'auto',
      },
    };
    if (modelPath) {
      options.modelPath = modelPath;
    } else {
      options.modelName = modelName;
    }

    const result = await whisper(wavPath, options);
    const text = parseWhisperNodeOutput(result);

    return {
      text,
      providerType: 'whisper-node',
      model: modelPath || modelName,
    };
  } finally {
    try {
      await fs.unlink(inputPath);
    } catch {
      // ignore
    }
    if (wavPath) {
      try {
        await fs.unlink(wavPath);
      } catch {
        // ignore
      }
    }
  }
};

export const transcribeSpeech = async (
  input: SpeechTranscriptionInput
): Promise<SpeechTranscriptionResult> => {
  const status = getSpeechStatus();
  if (!status.available) {
    throw new Error(status.reason || 'Speech provider not available');
  }

  const config = getSpeechConfig();
  if (config.providerType === 'whisper-node') {
    return transcribeWithWhisperNode(config, input);
  }
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

  return {
    text,
    providerType: 'openai',
    model,
  };
};
