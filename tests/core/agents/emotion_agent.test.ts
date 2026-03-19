import { describe, expect, it, vi } from 'vitest';

import { EmotionAgent } from '../../../src/core/agents/emotion_agent';
import type { EmotionRuntime } from '../../../src/core/runtimes/emotion_runtime';

describe('EmotionAgent', () => {
  it('returns null for blank input without invoking the runtime', async () => {
    const runtime: EmotionRuntime = {
      run: vi.fn(),
    };
    const agent = new EmotionAgent(runtime);

    await expect(agent.run('   ')).resolves.toBeNull();
    expect(runtime.run).not.toHaveBeenCalled();
  });

  it('delegates trimmed content to the runtime', async () => {
    const runtime: EmotionRuntime = {
      run: vi.fn().mockResolvedValue({ label: 'joy', confidence: 0.9 }),
    };
    const agent = new EmotionAgent(runtime);

    await expect(agent.run('  hello there  ')).resolves.toEqual({
      label: 'joy',
      confidence: 0.9,
    });
    expect(runtime.run).toHaveBeenCalledWith('hello there');
  });
});
