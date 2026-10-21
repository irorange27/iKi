// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DEFAULT_WINDOW_WIDTH = 900;

const importFreshSidebar = async () => {
  vi.resetModules();
  const mod = await import('../../../packages/desktop/src/renderer/composables/useSidebar');
  return mod.createSidebar();
};

const setWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  window.dispatchEvent(new Event('resize'));
};

describe('sidebar responsive fold', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts expanded at the app default window width', async () => {
    setWidth(DEFAULT_WINDOW_WIDTH);
    const sidebar = await importFreshSidebar();
    setWidth(DEFAULT_WINDOW_WIDTH);
    expect(sidebar.isCollapsed.value).toBe(false);
  });

  it('stays expanded after the user collapses and re-expands at the default width', async () => {
    setWidth(DEFAULT_WINDOW_WIDTH);
    const sidebar = await importFreshSidebar();
    setWidth(DEFAULT_WINDOW_WIDTH);
    expect(sidebar.isCollapsed.value).toBe(false);

    sidebar.toggle(); // collapse
    expect(sidebar.isCollapsed.value).toBe(true);

    sidebar.toggle(); // re-expand
    expect(sidebar.isCollapsed.value).toBe(false);

    setWidth(DEFAULT_WINDOW_WIDTH);
    expect(sidebar.isCollapsed.value).toBe(false);
  });

  it('still folds on a genuinely narrow window', async () => {
    setWidth(DEFAULT_WINDOW_WIDTH);
    const sidebar = await importFreshSidebar();
    setWidth(600);
    expect(sidebar.isCollapsed.value).toBe(true);
  });

  it('re-expands after crossing back above the restore mark', async () => {
    setWidth(DEFAULT_WINDOW_WIDTH);
    const sidebar = await importFreshSidebar();
    setWidth(600);
    expect(sidebar.isCollapsed.value).toBe(true);

    setWidth(1100);
    expect(sidebar.isCollapsed.value).toBe(false);
  });
});
