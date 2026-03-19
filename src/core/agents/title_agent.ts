import type { TaskAgent } from './task_agent';
import type { TitleRuntime } from '../runtimes/title_runtime';

export class TitleAgent implements TaskAgent<string, string | null> {
  constructor(private readonly runtime: TitleRuntime) {}

  async run(content: string): Promise<string | null> {
    const text = content.trim();
    if (!text) return null;
    return this.runtime.run(text);
  }
}
