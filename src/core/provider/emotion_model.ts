import { EmotionAgent } from '../agents/emotion_agent';
import {
  createDefaultEmotionRuntime,
  type EmotionResult,
  type EmotionRuntime,
  type EmotionScore,
} from '../runtimes/emotion_runtime';

export type { EmotionResult, EmotionRuntime, EmotionScore };
export { EmotionAgent } from '../agents/emotion_agent';
export { LlmEmotionRuntime } from '../runtimes/emotion_runtime';

let defaultEmotionAgent: EmotionAgent | null = null;

const getDefaultEmotionAgent = () => {
  if (!defaultEmotionAgent) {
    defaultEmotionAgent = new EmotionAgent(createDefaultEmotionRuntime());
  }
  return defaultEmotionAgent;
};

export const createEmotionAgent = (runtime: EmotionRuntime) => new EmotionAgent(runtime);

export const analyzeEmotion = async (content: string): Promise<EmotionResult | null> =>
  getDefaultEmotionAgent().run(content);

export const analyzeEmotionWithAgent = analyzeEmotion;
