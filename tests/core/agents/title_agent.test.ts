import { describe, expect, it, vi } from 'vitest';

import { TitleAgent } from '../../../src/core/agents/title_agent';
import type { TitleRuntime } from '../../../src/core/runtimes/title_runtime';

describe('TitleAgent', () => {
  it('returns null for blank input without invoking the runtime', async () => {
    const runtime: TitleRuntime = {
      run: vi.fn(),
    };
    const agent = new TitleAgent(runtime);

    await expect(agent.run('   ')).resolves.toBeNull();
    expect(runtime.run).not.toHaveBeenCalled();
  });

  it('delegates trimmed content to the runtime', async () => {
    const runtime: TitleRuntime = {
      run: vi.fn().mockResolvedValue('Concise title'),
    };
    const agent = new TitleAgent(runtime);

    await expect(agent.run('  user asks about tools  ')).resolves.toBe('Concise title');
    expect(runtime.run).toHaveBeenCalledWith('user asks about tools');
  });
});
