import { getProviderConfig } from '@iki/backend/provider/llm/factory';
import { createLogger } from '@iki/backend/logger';
import type { AudioEmotionResult } from '@iki/backend/types/speech';
import { isAffectLabel, type AffectLabel, type AffectScore } from '@iki/core/types/affect';

const speechEmotionLogger = createLogger({ module: 'speech_emotion' });

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const normalizeLabel = (value: unknown): AffectLabel | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || !isAffectLabel(trimmed)) return null;
  return trimmed;
};

const parseEmotionFromResponse = (raw: string): {
  label: AffectLabel;
  confidence: number;
  valence?: number;
  arousal?: number;
  emotions?: AffectScore[];
} | null => {
  if (!raw.trim()) return null;

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  } catch {
    const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const candidate = fencedMatch ? fencedMatch[1] : raw;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      parsed = JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  const emotionsRaw = Array.isArray(parsed.emotions) ? parsed.emotions : [];
  const emotions: AffectScore[] = emotionsRaw
    .map(entry => {
      if (!entry || typeof entry !== 'object') return null;
      const label = normalizeLabel((entry as { label?: unknown }).label);
      const score = toNumber((entry as { score?: unknown }).score);
      if (!label || score === null) return null;
      return { label, score: clamp(score, 0, 1) };
    })
    .filter((value): value is AffectScore => Boolean(value))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const label =
    normalizeLabel(parsed.label) ||
    normalizeLabel(parsed.emotion) ||
    normalizeLabel(parsed.primary) ||
    (emotions[0]?.label ?? null);

  if (!label) return null;

  const confidence =
    toNumber(parsed.confidence) ?? toNumber(parsed.score) ?? emotions[0]?.score ?? null;

  const valence = toNumber(parsed.valence);
  const arousal = toNumber(parsed.arousal);

  return {
    label,
    confidence: confidence !== null ? clamp(confidence, 0, 1) : 0.5,
    ...(valence !== null ? { valence: clamp(valence, -1, 1) } : {}),
    ...(arousal !== null ? { arousal: clamp(arousal, 0, 1) } : {}),
    ...(emotions.length > 0 ? { emotions } : {}),
  };
};

const getMiMoConfig = () => {
  try {
    return getProviderConfig('kimi');
  } catch {
    return null;
  }
};

export const analyzeAudioEmotion = async (
  audioBase64: string,
  mimeType: string
): Promise<AudioEmotionResult | null> => {
  const config = getMiMoConfig();
  if (!config || !config.apiKey) return null;

  const models = config.models;
  const modelId =
    models.find(m => m.includes('mimo')) || models[0];
  if (!modelId) return null;

  const baseUrl = config.baseURL || 'https://api.xiaomimimo.com/v1';
  const endpoint = baseUrl.endsWith('/v1')
    ? `${baseUrl}/chat/completions`
    : `${baseUrl}/v1/chat/completions`;

  const dataUrl = `data:${mimeType};base64,${audioBase64}`;

  const body = {
    model: modelId,
    messages: [
      {
        role: 'user' as const,
        content: [
          {
            type: 'input_audio',
            input_audio: { data: dataUrl },
          },
          {
            type: 'text',
            text:
              'Analyze the speaker\'s emotion from this audio. Return ONLY a JSON object with:\n' +
              '- label: one of [joy, sadness, anger, fear, disgust, surprise, neutral]\n' +
              '- confidence: number between 0 and 1\n' +
              '- valence: number between -1 and 1 (optional)\n' +
              '- arousal: number between 0 and 1 (optional)\n' +
              '- emotions: up to 3 items [{label, score}] sorted by score desc (optional)\n' +
              'Return JSON only, no markdown or extra text.',
          },
        ],
      },
    ],
    max_completion_tokens: 120,
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': config.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      speechEmotionLogger.warn(
        `Audio emotion analysis failed (${response.status}): ${errorText.slice(0, 200)}`
      );
      return null;
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };

    const rawContent = data?.choices?.[0]?.message?.content;
    if (typeof rawContent !== 'string' || !rawContent.trim()) return null;

    const parsed = parseEmotionFromResponse(rawContent);
    if (!parsed) return null;

    return {
      ...parsed,
      source: 'mimo-audio',
      providerType: config.type,
      model: modelId,
    };
  } catch (error) {
    speechEmotionLogger.warn('Audio emotion analysis failed', error);
    return null;
  }
};

export const isAudioEmotionAvailable = (): boolean => {
  const config = getMiMoConfig();
  if (!config || !config.apiKey) return false;
  return config.models.some(m => m.includes('mimo'));
};
