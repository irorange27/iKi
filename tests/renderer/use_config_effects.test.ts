import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultAppConfig } from '../../src/shared/config/defaults';

describe('config effects window chrome sync', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('enables native window shadow for light theme and avoids redundant IPC sends', async () => {
    const setPropertyMock = vi.fn();
    const setAttributeMock = vi.fn();
    const setWindowShadowMock = vi.fn();

    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({})),
      documentElement: {
        style: {
          setProperty: setPropertyMock,
        },
        setAttribute: setAttributeMock,
      },
    });
    vi.stubGlobal('window', {
      electronAPI: {
        setWindowShadow: setWindowShadowMock,
      },
      matchMedia: vi.fn(() => ({ matches: false })),
    });

    const { applyCssVariables } = await import('../../src/renderer/composables/useConfigEffects');
    const config = createDefaultAppConfig();
    config.general.theme = 'light';

    applyCssVariables(config);
    applyCssVariables(config);

    expect(setAttributeMock).toHaveBeenCalledWith('data-theme', 'light');
    expect(setAttributeMock).toHaveBeenCalledWith('data-theme-preset', 'iki-default');
    expect(setPropertyMock).toHaveBeenCalledWith('--theme-bg-primary', '#ffffff');
    expect(setWindowShadowMock).toHaveBeenCalledTimes(1);
    expect(setWindowShadowMock).toHaveBeenCalledWith(true);
  });

  it('disables native window shadow for dark theme', async () => {
    const setWindowShadowMock = vi.fn();

    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({})),
      documentElement: {
        style: {
          setProperty: vi.fn(),
        },
        setAttribute: vi.fn(),
      },
    });
    vi.stubGlobal('window', {
      electronAPI: {
        setWindowShadow: setWindowShadowMock,
      },
      matchMedia: vi.fn(() => ({ matches: true })),
    });

    const { applyCssVariables } = await import('../../src/renderer/composables/useConfigEffects');
    const config = createDefaultAppConfig();
    config.general.theme = 'dark';

    applyCssVariables(config);

    expect(setWindowShadowMock).toHaveBeenCalledWith(false);
  });

  it('applies compiled base46 preset tokens for custom presets', async () => {
    const setPropertyMock = vi.fn();
    const setAttributeMock = vi.fn();

    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({})),
      documentElement: {
        style: {
          setProperty: setPropertyMock,
        },
        setAttribute: setAttributeMock,
      },
    });
    vi.stubGlobal('window', {
      electronAPI: {
        setWindowShadow: vi.fn(),
      },
      matchMedia: vi.fn(() => ({ matches: true })),
    });

    const { applyCssVariables } = await import('../../src/renderer/composables/useConfigEffects');
    const config = createDefaultAppConfig();
    config.general.theme = 'dark';
    config.general.themePresetId = 'custom-base46';
    const customPreset = config.themes.base46Presets['custom-base46'];
    if (!customPreset?.dark) {
      throw new Error('Expected bundled custom Base46 preset to include a dark variant.');
    }
    customPreset.dark.base_30.blue = '#112233';
    customPreset.dark.base_16.base0D = '#445566';

    applyCssVariables(config);

    expect(setAttributeMock).toHaveBeenCalledWith('data-theme', 'dark');
    expect(setAttributeMock).toHaveBeenCalledWith('data-theme-preset', 'custom-base46');
    expect(setPropertyMock).toHaveBeenCalledWith('--theme-accent-color', '#112233');
    expect(setPropertyMock).toHaveBeenCalledWith('--theme-chart-1', '#445566');
  });
});
