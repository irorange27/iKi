import { describe, expect, it } from 'vitest';

import { createDefaultAppConfig, mergeAppConfig } from '../../src/shared/config/defaults';

describe('default app config', () => {
  it('enables emotion analysis by default without forcing realtime analysis', () => {
    const config = createDefaultAppConfig();

    expect(config.memory.emotion.enabled).toBe(true);
    expect(config.memory.emotion.injectToSystemPrompt).toBe(true);
    expect(config.memory.emotion.realtimeAnalysis).toBe(false);
    expect(config.toolModel.providerId).toBe('');
    expect(config.general.autoApproveToolRequests).toBe(false);
    expect(config.chat.composer).toEqual({
      preferredProviderId: '',
      preferredModel: '',
    });
    expect(config.network.webSearch).toEqual({
      preferredEngine: 'google',
    });
    expect(Object.prototype.hasOwnProperty.call(config, 'webSearch')).toBe(false);
  });

  it('drops legacy tool-model providerType config while preserving the selected model', () => {
    const config = mergeAppConfig({
      toolModel: {
        providerType: 'deepseek',
        model: 'deepseek-chat',
      } as never,
    } as never);

    expect(config.toolModel).toEqual({
      providerId: '',
      model: 'deepseek-chat',
    });
    expect(Object.prototype.hasOwnProperty.call(config.toolModel, 'providerType')).toBe(false);
  });

  it('migrates legacy webSearch config into network.webSearch while dropping the root field', () => {
    const config = mergeAppConfig({
      general: { language: 'zh-CN' },
      webSearch: {
        engine: 'bing',
        fallbackToDefault: false,
        saveFailureArtifacts: false,
      },
    } as never);

    expect(config.general.language).toBe('zh-CN');
    expect(config.network.webSearch.preferredEngine).toBe('bing');
    expect(Object.prototype.hasOwnProperty.call(config, 'webSearch')).toBe(false);
  });
});
