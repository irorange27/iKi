import { describe, expect, it } from 'vitest';

import { createDefaultAppConfig, mergeAppConfig } from '../../src/shared/config/defaults';

describe('default app config', () => {
  it('enables emotion analysis by default without forcing realtime analysis', () => {
    const config = createDefaultAppConfig();

    expect(config.memory.emotion.enabled).toBe(true);
    expect(config.memory.emotion.injectToSystemPrompt).toBe(true);
    expect(config.memory.emotion.realtimeAnalysis).toBe(false);
    expect(config.toolModel.providerType).toBe('');
    expect(config.general.autoApproveToolRequests).toBe(false);
    expect(config.chat.composer).toEqual({
      preferredProviderId: '',
      preferredModel: '',
    });
    expect(Object.prototype.hasOwnProperty.call(config, 'webSearch')).toBe(false);
  });

  it('drops legacy webSearch config during merge', () => {
    const config = mergeAppConfig({
      general: { language: 'zh-CN' },
      webSearch: {
        engine: 'google',
        fallbackToDefault: false,
        saveFailureArtifacts: false,
      },
    } as never);

    expect(config.general.language).toBe('zh-CN');
    expect(Object.prototype.hasOwnProperty.call(config, 'webSearch')).toBe(false);
  });
});
