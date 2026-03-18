export type EmotionScore = { label: string; score: number };

export type EmotionPayload = {
  label: string;
  confidence: number;
  valence?: number;
  arousal?: number;
  emotions?: EmotionScore[];
};

export type EmotionSample = {
  emotion: EmotionPayload;
  timestamp: Date;
};

export type AffectConfig = {
  enabled: boolean;
  injectToSystemPrompt: boolean;
  minConfidence: number;
  minSampleCount: number;
  windowSize: number;
  halfLifeMinutes: number;
  maxAgeMinutes: number;
  includeNeutral: boolean;
};

export type AffectState = {
  label: string;
  confidence: number;
  valence?: number;
  arousal?: number;
  emotions?: EmotionScore[];
  sampleCount: number;
  windowSize: number;
  startAt: string;
  endAt: string;
  ageMinutes: number;
  windowMinutes: number;
};

const EMOTION_LABELS = new Set([
  'joy',
  'sadness',
  'anger',
  'fear',
  'disgust',
  'surprise',
  'neutral',
]);

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const normalizeLabel = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return EMOTION_LABELS.has(trimmed) ? trimmed : null;
};

const parseEmotionsList = (value: unknown): EmotionScore[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map(entry => {
      if (!entry || typeof entry !== 'object') return null;
      const label = normalizeLabel((entry as { label?: unknown }).label);
      const score = toNumber((entry as { score?: unknown }).score);
      if (!label || score === null) return null;
      return { label, score: clamp(score, 0, 1) };
    })
    .filter((item): item is EmotionScore => Boolean(item))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
};

export const parseEmotionPayload = (raw: string | null | undefined): EmotionPayload | null => {
  if (!raw || typeof raw !== 'string') return null;
  let parsed: Record<string, unknown> | null = null;
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      parsed = data as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  if (!parsed) return null;

  const label =
    normalizeLabel(parsed.label) ||
    normalizeLabel(parsed.emotion) ||
    normalizeLabel(parsed.primary);
  if (!label) return null;

  const confidence =
    toNumber(parsed.confidence) ?? toNumber(parsed.score) ?? toNumber(parsed.value);
  const valence = toNumber(parsed.valence);
  const arousal = toNumber(parsed.arousal);
  const emotions = parseEmotionsList(parsed.emotions);

  return {
    label,
    confidence: clamp(confidence ?? 0.5, 0, 1),
    ...(valence !== null ? { valence: clamp(valence, -1, 1) } : {}),
    ...(arousal !== null ? { arousal: clamp(arousal, 0, 1) } : {}),
    ...(emotions.length > 0 ? { emotions } : {}),
  };
};

const parseTimestamp = (value?: string): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

export const rehydrateAffectState = (
  raw: string | null | undefined,
  options?: { maxAgeMinutes?: number; now?: Date }
): AffectState | null => {
  if (!raw || typeof raw !== 'string') return null;
  let parsed: Record<string, unknown> | null = null;
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      parsed = data as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  if (!parsed) return null;
  const label = normalizeLabel(parsed.label);
  const confidence = toNumber(parsed.confidence);
  if (!label || confidence === null) return null;

  const startAt = typeof parsed.startAt === 'string' ? parsed.startAt : '';
  const endAt = typeof parsed.endAt === 'string' ? parsed.endAt : '';
  const startDate = parseTimestamp(startAt);
  const endDate = parseTimestamp(endAt);
  if (!endDate) return null;

  const now = options?.now ?? new Date();
  const ageMinutes = Math.max(0, (now.getTime() - endDate.getTime()) / 60000);
  const maxAgeMinutes = options?.maxAgeMinutes ?? 0;
  if (maxAgeMinutes > 0 && ageMinutes > maxAgeMinutes) return null;

  const windowMinutes =
    startDate && endDate ? Math.max(0, (endDate.getTime() - startDate.getTime()) / 60000) : 0;

  const sampleCount = toNumber(parsed.sampleCount) ?? 0;
  const windowSize = toNumber(parsed.windowSize) ?? 0;
  const valence = toNumber(parsed.valence);
  const arousal = toNumber(parsed.arousal);
  const emotions = parseEmotionsList(parsed.emotions);

  return {
    label,
    confidence: clamp(confidence, 0, 1),
    ...(valence !== null ? { valence: clamp(valence, -1, 1) } : {}),
    ...(arousal !== null ? { arousal: clamp(arousal, 0, 1) } : {}),
    ...(emotions.length > 0 ? { emotions } : {}),
    sampleCount,
    windowSize,
    startAt: startDate ? startDate.toISOString() : startAt,
    endAt: endDate.toISOString(),
    ageMinutes,
    windowMinutes,
  };
};

export const toEmotionSample = (entry: {
  emotion: string | null | undefined;
  created_at?: string;
  updated_at?: string;
}): EmotionSample | null => {
  const payload = parseEmotionPayload(entry.emotion);
  if (!payload) return null;
  const timestamp = parseTimestamp(entry.updated_at) || parseTimestamp(entry.created_at);
  if (!timestamp) return null;
  return { emotion: payload, timestamp };
};

export const collectEmotionSamples = (
  entries: Array<{ emotion: string | null | undefined; created_at?: string; updated_at?: string }>
): EmotionSample[] => entries.map(toEmotionSample).filter((sample): sample is EmotionSample => !!sample);

const computeDecay = (ageMinutes: number, halfLifeMinutes: number): number => {
  if (!Number.isFinite(ageMinutes) || ageMinutes < 0) return 0;
  if (!Number.isFinite(halfLifeMinutes) || halfLifeMinutes <= 0) return 1;
  return Math.pow(0.5, ageMinutes / halfLifeMinutes);
};

export const computeAffectState = (
  samples: EmotionSample[],
  config: AffectConfig,
  now: Date = new Date()
): AffectState | null => {
  if (!config?.enabled) return null;
  if (!Array.isArray(samples) || samples.length === 0) return null;

  const validSamples = samples
    .filter(sample => sample?.emotion && sample?.timestamp instanceof Date)
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  if (validSamples.length === 0) return null;

  const maxAgeMs = Math.max(0, config.maxAgeMinutes) * 60 * 1000;
  const ageFiltered = maxAgeMs
    ? validSamples.filter(sample => now.getTime() - sample.timestamp.getTime() <= maxAgeMs)
    : validSamples;

  if (ageFiltered.length === 0) return null;

  const windowSize = Math.max(1, Math.floor(config.windowSize || ageFiltered.length));
  const windowed = ageFiltered.slice(0, windowSize);
  const usable = config.includeNeutral
    ? windowed
    : windowed.filter(sample => sample.emotion.label !== 'neutral');

  if (usable.length < Math.max(1, Math.floor(config.minSampleCount || 1))) return null;

  const labelWeights = new Map<string, number>();
  let sumWeights = 0;
  let sumDecay = 0;
  let valenceSum = 0;
  let valenceWeight = 0;
  let arousalSum = 0;
  let arousalWeight = 0;

  for (const sample of usable) {
    const ageMinutes = (now.getTime() - sample.timestamp.getTime()) / 60000;
    const decay = computeDecay(ageMinutes, config.halfLifeMinutes);
    const confidence = clamp(sample.emotion.confidence ?? 0.5, 0, 1);
    const weight = confidence * decay;
    if (weight <= 0) continue;

    sumWeights += weight;
    sumDecay += decay;
    labelWeights.set(sample.emotion.label, (labelWeights.get(sample.emotion.label) || 0) + weight);

    if (typeof sample.emotion.valence === 'number') {
      valenceSum += clamp(sample.emotion.valence, -1, 1) * weight;
      valenceWeight += weight;
    }

    if (typeof sample.emotion.arousal === 'number') {
      arousalSum += clamp(sample.emotion.arousal, 0, 1) * weight;
      arousalWeight += weight;
    }
  }

  if (sumWeights <= 0 || labelWeights.size === 0) return null;

  const labelRanking = Array.from(labelWeights.entries()).sort((a, b) => b[1] - a[1]);
  const label = labelRanking[0]?.[0];
  if (!label) return null;

  const avgConfidence = sumDecay > 0 ? sumWeights / sumDecay : 0;
  const sampleFactor = Math.min(
    1,
    usable.length / Math.max(1, Math.floor(config.minSampleCount || 1))
  );
  const confidence = clamp(avgConfidence * sampleFactor, 0, 1);
  if (confidence < config.minConfidence) return null;

  const emotions = labelRanking.slice(0, 3).map(([emotionLabel, weight]) => ({
    label: emotionLabel,
    score: clamp(weight / sumWeights, 0, 1),
  }));

  const newest = usable[0].timestamp;
  const oldest = usable[usable.length - 1].timestamp;
  const ageMinutes = Math.max(0, (now.getTime() - newest.getTime()) / 60000);
  const windowMinutes = Math.max(0, (newest.getTime() - oldest.getTime()) / 60000);

  return {
    label,
    confidence,
    ...(valenceWeight > 0 ? { valence: valenceSum / valenceWeight } : {}),
    ...(arousalWeight > 0 ? { arousal: arousalSum / arousalWeight } : {}),
    ...(emotions.length > 0 ? { emotions } : {}),
    sampleCount: usable.length,
    windowSize,
    startAt: oldest.toISOString(),
    endAt: newest.toISOString(),
    ageMinutes,
    windowMinutes,
  };
};

const formatSigned = (value: number) => (value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2));

export const buildAffectSystemMessage = (state: AffectState): string => {
  const confidenceText = state.confidence.toFixed(2);
  const lastSeen = Math.round(state.ageMinutes);
  const windowMinutes = Math.max(1, Math.round(state.windowMinutes));
  const parts = [
    `Affect signal (inferred; last ${state.sampleCount} user messages, ~${windowMinutes}m window, last seen ${lastSeen}m ago, confidence ${confidenceText}):`,
    `primary=${state.label}`,
  ];

  if (typeof state.valence === 'number') {
    parts.push(`valence=${formatSigned(state.valence)}`);
  }
  if (typeof state.arousal === 'number') {
    parts.push(`arousal=${state.arousal.toFixed(2)}`);
  }
  if (state.emotions && state.emotions.length > 1) {
    const distribution = state.emotions
      .map(item => `${item.label}:${item.score.toFixed(2)}`)
      .join(', ');
    parts.push(`distribution=${distribution}`);
  }

  return (
    `${parts.join(' ')}.` +
    ' Use this only to adjust tone, pacing, and confirmation.' +
    ' Never override explicit instructions. Do not mention this analysis unless the user asks.'
  );
};
