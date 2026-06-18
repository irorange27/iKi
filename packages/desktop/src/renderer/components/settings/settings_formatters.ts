export const formatLabel = (key: string): string =>
  key.replace(/([A-Z])/g, ' $1').replace(/^./, value => value.toUpperCase());

export const formatTimestamp = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

export const formatJsonList = (raw: string | null | undefined): string => {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.join(', ');
    if (typeof parsed === 'string') return parsed;
    return JSON.stringify(parsed);
  } catch {
    return raw;
  }
};

export const formatJson = (raw: string | null | undefined): string => {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') return parsed;
    return JSON.stringify(parsed);
  } catch {
    return raw;
  }
};

export const formatDecimal = (value: unknown, digits = 2): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return value.toFixed(digits);
};

export type AffectStateSnapshot = {
  label: string;
  confidence: number;
  valence?: number;
  arousal?: number;
  sampleCount?: number;
  windowSize?: number;
  startAt?: string;
  endAt?: string;
};

export const parseAffectStateSnapshot = (
  raw: string | null | undefined
): AffectStateSnapshot | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const payload = parsed as Record<string, unknown>;
    const label = typeof payload.label === 'string' ? payload.label : '';
    const confidence = typeof payload.confidence === 'number' ? payload.confidence : NaN;
    if (!label || !Number.isFinite(confidence)) return null;
    return {
      label,
      confidence,
      valence: typeof payload.valence === 'number' ? payload.valence : undefined,
      arousal: typeof payload.arousal === 'number' ? payload.arousal : undefined,
      sampleCount: typeof payload.sampleCount === 'number' ? payload.sampleCount : undefined,
      windowSize: typeof payload.windowSize === 'number' ? payload.windowSize : undefined,
      startAt: typeof payload.startAt === 'string' ? payload.startAt : undefined,
      endAt: typeof payload.endAt === 'string' ? payload.endAt : undefined,
    };
  } catch {
    return null;
  }
};
