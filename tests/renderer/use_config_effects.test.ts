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
});
