import {
  createDefaultEmotionRuntime,
  type EmotionResult,
  type EmotionRuntime,
  type EmotionScore,
} from '../runtimes/emotion_runtime';

export type { EmotionResult, EmotionRuntime, EmotionScore };
export { LlmEmotionRuntime } from '../runtimes/emotion_runtime';

let defaultEmotionRuntime: EmotionRuntime | null = null;

const getDefaultEmotionRuntime = () => {
  if (!defaultEmotionRuntime) {
    defaultEmotionRuntime = createDefaultEmotionRuntime();
  }
  return defaultEmotionRuntime;
};

export const analyzeEmotion = async (content: string): Promise<EmotionResult | null> => {
  const trimmed = content.trim();
  if (!trimmed) return null;
  return getDefaultEmotionRuntime().run(trimmed);
};

export const analyzeEmotionWithAgent = analyzeEmotion;
