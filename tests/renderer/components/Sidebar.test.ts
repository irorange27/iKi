// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import { createSidebar } from '../../../src/renderer/composables/useSidebar';

const setElectronApi = (api: unknown) => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: api,
  });
};

const mountSidebar = async (options?: {
  threads?: Array<Record<string, unknown>>;
}) => {
  const list = vi.fn(async () => options?.threads ?? []);
  const del = vi.fn(async () => ({ success: true }));
  const openSettings = vi.fn();

  setElectronApi({
    chat: {
      threads: {
        list,
        delete: del,
      },
    },
    openSettings,
  });

  const sidebarState = createSidebar();
  sidebarState.expand();
  sidebarState.setWidth(240);

  const Sidebar = (await import('../../../src/renderer/components/Sidebar.vue')).default;
  const wrapper = mount(Sidebar, {
    global: {
      stubs: {
        PanelLeftDashed: true,
        Search: true,
        SquarePen: true,
        Trash2: true,
      },
    },
  });

  await flushPromises();

  return {
    wrapper,
    list,
    del,
    openSettings,
    sidebarState,
  };
};

describe('Sidebar', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      value: vi.fn(() => true),
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    Reflect.deleteProperty(window, 'confirm');
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('loads only desktop main-ui threads and emits selection for visible items', async () => {
    const visibleThread = {
      id: 'thread_desktop',
      title: 'Desktop Thread',
      updated_at: '2026-03-22T00:00:00.000Z',
      client_id: 'client_desktop',
      metadata: '{}',
    };

    const { wrapper, list } = await mountSidebar({
      threads: [
        visibleThread,
        {
          id: 'napcat_thread_1',
          title: 'NapCat Prefix',
          updated_at: '2026-03-22T00:00:00.000Z',
          metadata: '{}',
        },
        {
          id: 'thread_napcat_client',
          title: 'NapCat Client',
          updated_at: '2026-03-22T00:00:00.000Z',
          client_id: 'client_napcat',
          metadata: '{}',
        },
        {
          id: 'thread_napcat_source',
          title: 'NapCat Source',
          updated_at: '2026-03-22T00:00:00.000Z',
          metadata: JSON.stringify({ source: 'napcat' }),
        },
      ],
    });

    expect(list).toHaveBeenCalledTimes(1);

    const chatButtons = wrapper.findAll('.chat-item');
    expect(chatButtons).toHaveLength(1);
    expect(chatButtons[0].text()).toContain('Desktop Thread');

    await chatButtons[0].trigger('click');

    expect(wrapper.emitted('thread-selected')).toEqual([['thread_desktop']]);
  });

  it('deletes the confirmed thread, removes it locally, and emits thread-deleted', async () => {
    const { wrapper, del } = await mountSidebar({
      threads: [
        {
          id: 'thread_delete',
          title: 'Delete Me',
          updated_at: '2026-03-22T00:00:00.000Z',
          metadata: '{}',
        },
      ],
    });

    await wrapper.find('.chat-item').trigger('click');
    await wrapper.find('.chat-delete-btn').trigger('click');
    await flushPromises();

    expect(window.confirm).toHaveBeenCalledWith('Delete "Delete Me"?\nThis cannot be undone.');
    expect(del).toHaveBeenCalledWith('thread_delete');
    expect(wrapper.emitted('thread-deleted')).toEqual([['thread_delete']]);
    expect(wrapper.findAll('.chat-item')).toHaveLength(0);
  });

  it('opens settings from the footer action', async () => {
    const { wrapper, openSettings } = await mountSidebar({
      threads: [],
    });

    await wrapper.find('.sidebar-settings-btn').trigger('click');

    expect(openSettings).toHaveBeenCalledTimes(1);
  });
});
