import { describe, expect, it } from 'vitest';

import { createDefaultAppConfig, mergeAppConfig } from '@iki/backend/config/defaults';

describe('default app config', () => {
  it('exposes context budgets at the top level, with no memory section', () => {
    const config = createDefaultAppConfig();

    // Memory and affect/emotion are gone; the context-assembly budgets that
    // used to be nested under `memory.context` now live at the root.
    expect(Object.prototype.hasOwnProperty.call(config, 'memory')).toBe(false);
    expect(config.context.enabled).toBe(true);
    expect(config.context.maxSkillTokens).toBe(1200);
    expect(config.toolModel.providerId).toBe('');
    expect(config.general.autoApproveToolRequests).toBe(false);
    expect(config.chat.composer).toEqual({
      preferredProviderId: '',
      preferredModel: '',
    });
    expect(config.ui.companion).toEqual({
      enabled: true,
      alwaysOnTop: true,
      rememberPosition: true,
      reduceMotion: false,
      openMainWindowOnClick: true,
      position: {
        x: null,
        y: null,
      },
    });
    expect(config.network.webSearch).toEqual({
      preferredEngine: 'google',
    });
    expect(Object.prototype.hasOwnProperty.call(config, 'webSearch')).toBe(false);
  });

  it('keeps the context budget reachable after the memory namespace was removed', () => {
    // The budget used to live at memory.context and is what turn_prep's
    // context_budget reads. Deleting the memory subsystem must NOT take it
    // along: a missing budget silently disables history/skill clipping.
    const config = mergeAppConfig({
      context: { maxSkillTokens: 999 },
    } as never);

    expect(config.context.maxSkillTokens).toBe(999);
    expect(config.context.enabled).toBe(true);
    expect(config.context.maxRecentTokens).toBe(2400);
    expect(Object.prototype.hasOwnProperty.call(config, 'memory')).toBe(false);
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

  it('merges nested companion position config without dropping defaults', () => {
    const config = mergeAppConfig({
      ui: {
        companion: {
          position: {
            x: 1440,
            y: 860,
          },
        },
      },
    } as never);

    expect(config.ui.companion).toEqual({
      enabled: true,
      alwaysOnTop: true,
      rememberPosition: true,
      reduceMotion: false,
      openMainWindowOnClick: true,
      position: {
        x: 1440,
        y: 860,
      },
    });
  });
});
