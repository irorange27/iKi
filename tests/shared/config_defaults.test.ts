import { describe, expect, it } from 'vitest';

import { createDefaultAppConfig } from '../../src/shared/config/defaults';

describe('default app config', () => {
  it('enables emotion analysis by default without forcing realtime analysis', () => {
    const config = createDefaultAppConfig();

    expect(config.memory.emotion.enabled).toBe(true);
    expect(config.memory.emotion.injectToSystemPrompt).toBe(true);
    expect(config.memory.emotion.realtimeAnalysis).toBe(false);
  });
});
