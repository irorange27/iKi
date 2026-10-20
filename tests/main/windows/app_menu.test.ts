import { describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';

const { isPackaged } = vi.hoisted(() => ({ isPackaged: { value: false } }));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return isPackaged.value;
    },
    name: 'iki',
    quit: vi.fn(),
    relaunch: vi.fn(),
  },
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [],
  },
  Menu: {
    buildFromTemplate: vi.fn(),
    setApplicationMenu: vi.fn(),
  },
}));

import {
  buildViewMenuTemplate,
  RESTART_ACCELERATOR,
} from '../../../packages/desktop/src/main/windows/app_menu';

const findItem = (template: MenuItemConstructorOptions[], id: string) =>
  template.find(item => item.id === id);

describe('view menu restart entry', () => {
  it('offers a restart accelerator in development', () => {
    const item = findItem(buildViewMenuTemplate({ isPackaged: false }), 'restart-app');

    expect(item?.accelerator).toBe(RESTART_ACCELERATOR);
    expect(item?.acceleratorWorksWhenHidden).toBe(true);
  });

  it('keeps the DevTools accelerators that share the View menu', () => {
    const template = buildViewMenuTemplate({ isPackaged: false });
    expect(findItem(template, 'toggle-devtools')?.accelerator).toBe('F12');
    expect(findItem(template, 'toggle-devtools-alt')?.accelerator).toBe('CommandOrControl+Shift+I');
  });

  it('omits the restart entry in a packaged build', () => {
    expect(findItem(buildViewMenuTemplate({ isPackaged: true }), 'restart-app')).toBeUndefined();
  });
});
