import type { TaskAgent } from './task_agent';
import type { EmotionResult, EmotionRuntime } from '../runtimes/emotion_runtime';

export class EmotionAgent implements TaskAgent<string, EmotionResult | null> {
  constructor(private readonly runtime: EmotionRuntime) {}

  async run(content: string): Promise<EmotionResult | null> {
    const text = content.trim();
    if (!text) return null;
    return this.runtime.run(text);
  }
}
