export const AFFECT_LABELS = [
  'joy',
  'sadness',
  'anger',
  'fear',
  'disgust',
  'surprise',
  'neutral',
] as const;

export type AffectLabel = (typeof AFFECT_LABELS)[number];

export type AffectScore = {
  label: AffectLabel;
  score: number;
};

export type AffectSnapshot = {
  label: AffectLabel;
  confidence: number;
  valence?: number;
  arousal?: number;
  emotions?: AffectScore[];
  sampleCount: number;
  windowSize: number;
  startAt: string;
  endAt: string;
  ageMinutes: number;
  windowMinutes: number;
};

export type AffectSignalSource = 'history' | 'realtime';

export type AffectSignal = {
  source: AffectSignalSource;
  guardActive: boolean;
  state: AffectSnapshot;
};

export const isAffectLabel = (value: unknown): value is AffectLabel =>
  typeof value === 'string' && AFFECT_LABELS.includes(value as AffectLabel);
