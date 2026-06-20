import { isAffectLabel, type AffectLabel, type AffectScore } from '@iki/backend/types/affect';
import { createLogger } from '@iki/backend/logger';
import { getToolModel, type ToolModelConfig } from '../provider/tool_model';
import {
  createSimplePromptTextGenerator,
  type PromptTextGenerator,
  type PromptTextGeneratorConfig,
} from './prompt_text_generator';

export type EmotionScore = AffectScore;
export type EmotionResult = {
  label: AffectLabel;
  confidence: number;
  valence?: number;
  arousal?: number;
  emotions?: EmotionScore[];
  language?: string;
  source: 'tool-model';
  providerType: string;
  model: string;
  inputChars: number;
  truncated: boolean;
};

export interface EmotionRuntime {
  run(content: string): Promise<EmotionResult | null>;
}

type ParsedEmotionResult = Omit<
  EmotionResult,
  'source' | 'providerType' | 'model' | 'inputChars' | 'truncated'
>;

const MAX_INPUT_CHARS = 2000;
const emotionRuntimeLogger = createLogger({ module: 'emotion_runtime' });
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

const extractJsonObject = (raw: string): Record<string, unknown> | null => {
  if (!raw.trim()) return null;
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fencedMatch ? fencedMatch[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = candidate.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
};

const parseEmotionResult = (raw: string): ParsedEmotionResult | null => {
  const parsed = extractJsonObject(raw);
  if (!parsed) return null;

  const emotionsRaw = Array.isArray(parsed.emotions) ? parsed.emotions : [];
  const emotions: EmotionScore[] = emotionsRaw
    .map(entry => {
      if (!entry || typeof entry !== 'object') return null;
      const label = normalizeLabel((entry as { label?: unknown }).label);
      const score = toNumber((entry as { score?: unknown }).score);
      if (!label || score === null) return null;
      return { label, score: clamp(score, 0, 1) };
    })
    .filter((value): value is EmotionScore => Boolean(value))
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
  const language =
    typeof parsed.language === 'string' && parsed.language.trim()
      ? parsed.language.trim()
      : undefined;

  return {
    label,
    confidence: confidence !== null ? clamp(confidence, 0, 1) : 0.5,
    ...(valence !== null ? { valence: clamp(valence, -1, 1) } : {}),
    ...(arousal !== null ? { arousal: clamp(arousal, 0, 1) } : {}),
    ...(emotions.length > 0 ? { emotions } : {}),
    ...(language ? { language } : {}),
  };
};

type LlmEmotionRuntimeDeps = {
  getToolModel: () => ToolModelConfig | null;
  createGenerator: (config?: PromptTextGeneratorConfig) => PromptTextGenerator;
};

export class LlmEmotionRuntime implements EmotionRuntime {
  constructor(
    private readonly deps: LlmEmotionRuntimeDeps = {
      getToolModel,
      createGenerator: createSimplePromptTextGenerator,
    }
  ) {}

  async run(content: string): Promise<EmotionResult | null> {
    const text = content.trim();
    if (!text) return null;

    const toolModel = this.deps.getToolModel();
    if (!toolModel) {
      emotionRuntimeLogger.event({
        level: 'warn',
        event: 'emotion.analysis',
        outcome: 'skipped',
        message: 'Tool model unavailable; skipping emotion analysis.',
      });
      return null;
    }

    const inputChars = text.length;
    const truncated = inputChars > MAX_INPUT_CHARS;
    const analysisText = truncated ? text.slice(0, MAX_INPUT_CHARS) : text;

    const generator = this.deps.createGenerator({
      enabled: true,
      providerType: toolModel.providerType,
      model: toolModel.model,
      systemPrompt:
        'You are an emotion recognition model. Analyze the user message and output ONLY valid JSON with:\n' +
        '- label: one of [joy, sadness, anger, fear, disgust, surprise, neutral]\n' +
        '- confidence: number between 0 and 1\n' +
        '- valence: number between -1 and 1 (optional)\n' +
        '- arousal: number between 0 and 1 (optional)\n' +
        '- emotions: up to 3 items [{label, score}] sorted by score desc (optional)\n' +
        '- language: ISO 639-1 code if known (optional)\n' +
        'Return JSON only, no markdown or extra text. If unsure, use neutral with low confidence.',
      temperature: 0,
      maxTokens: 180,
      maxIterations: 1,
      enableTools: false,
      enableMemory: false,
    });

    try {
      const result = await generator.generate(analysisText);
      const parsed = parseEmotionResult(result.response);
      if (!parsed) return null;
      return {
        ...parsed,
        source: 'tool-model',
        providerType: toolModel.providerType,
        model: toolModel.model,
        inputChars,
        truncated,
      };
    } catch (error) {
      emotionRuntimeLogger.event({
        level: 'warn',
        event: 'emotion.analysis',
        outcome: 'failed',
        error,
        data: {
          input_chars: inputChars,
          truncated,
          provider_type: toolModel.providerType,
          model: toolModel.model,
        },
      });
      return null;
    }
  }
}

export const createDefaultEmotionRuntime = () => new LlmEmotionRuntime();
