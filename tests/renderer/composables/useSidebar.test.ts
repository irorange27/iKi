// @vitest-environment happy-dom

/**
 * The sidebar's responsive fold must not fire at the window size iKi actually
 * opens with.
 *
 * Live defect this pins: `AUTO_COLLAPSE_BELOW` was borrowed from another app's
 * 1024px mark while the main window opens at 900px, so EVERY fresh launch folded
 * the sidebar — and expanding it folded straight back, because the window never
 * reached the restore mark either. The thread list renders no rows while
 * collapsed, so the sidebar (projects, threads, settings) was unreachable at the
 * default size. Nothing guarded this: the threshold had no test at all.
 */
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
    // The first assessment counts as a crossing, so boot decides the state.
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
    // Regression: with the borrowed 1024px threshold the responsive pass folded
    // it straight back at 900px, which read as "the expand button does nothing".
    expect(sidebar.isCollapsed.value).toBe(false);

    // A resize that stays inside the same band must not yank it shut either.
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
