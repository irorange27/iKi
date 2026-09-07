// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import { createSidebar } from '../../../packages/desktop/src/renderer/composables/useSidebar';

const setElectronApi = (api: unknown) => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: api,
  });
};

const mountSidebar = async (options?: {
  threads?: Array<Record<string, unknown>>;
  workspaces?: Array<Record<string, unknown>>;
}) => {
  const list = vi.fn(async () => options?.threads ?? []);
  const del = vi.fn(async () => ({ success: true }));
  const openSettings = vi.fn();
  const listWorkspaces = vi.fn(async () => options?.workspaces ?? []);

  setElectronApi({
    chat: {
      threads: {
        list,
        delete: del,
      },
    },
    workspaces: {
      list: listWorkspaces,
    },
    openSettings,
  });

  const sidebarState = createSidebar();
  sidebarState.expand();
  sidebarState.setWidth(240);

  const Sidebar = (await import('../../../packages/desktop/src/renderer/components/Sidebar.vue'))
    .default;
  const wrapper = mount(Sidebar, {
    global: {
      stubs: {
        PanelLeftDashed: true,
        Search: true,
        SquarePen: true,
        Trash2: true,
        MoreHorizontal: true,
        Settings2: true,
        MessageSquareShare: true,
        Check: true,
        X: true,
        ChevronDown: true,
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

const { confirmActionMock } = vi.hoisted(() => ({
  confirmActionMock: vi.fn(),
}));

vi.mock('../../../packages/desktop/src/renderer/composables/useConfirm', () => ({
  confirmAction: confirmActionMock,
}));

describe('Sidebar', () => {
  const queryMenu = () => document.body.querySelector('.sidebar-menu');

  beforeEach(() => {
    confirmActionMock.mockImplementation(async () => true);
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    localStorage.clear();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps external bridge threads out of the default desktop list and emits selection for visible items', async () => {
    const visibleThread = {
      id: 'thread_desktop',
      title: 'Desktop Thread',
      updated_at: '2026-03-22T00:00:00.000Z',
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

  it('reveals external chats from the footer menu in a dedicated section', async () => {
    const externalThread = {
      id: 'napcat_10001_group_30003',
      title: 'QQ Group 30003',
      updated_at: '2026-03-22T00:00:00.000Z',
      client_id: 'client_napcat',
      metadata: JSON.stringify({ source: 'napcat', message_type: 'group' }),
    };

    const { wrapper } = await mountSidebar({
      threads: [
        {
          id: 'thread_desktop',
          title: 'Desktop Thread',
          updated_at: '2026-03-22T00:00:00.000Z',
          metadata: '{}',
        },
        externalThread,
      ],
    });

    expect(wrapper.text()).not.toContain('External Chats');
    expect(wrapper.findAll('.chat-item-external')).toHaveLength(0);

    await wrapper.find('.sidebar-menu-btn').trigger('click');
    const externalToggle = document.body.querySelector('[role="menuitemcheckbox"]');
    expect(externalToggle).not.toBeNull();
    (externalToggle as HTMLButtonElement).click();
    await flushPromises();

    expect(wrapper.text()).toContain('External Chats');
    expect(wrapper.text()).toContain('QQ Group 30003');
    expect(wrapper.text()).toContain('NapCat');
    expect(wrapper.text()).toContain('QQ group');

    const externalButton = wrapper.find('.chat-item-external');
    expect(externalButton.exists()).toBe(true);

    await externalButton.trigger('click');

    expect(wrapper.emitted('thread-selected')).toEqual([['napcat_10001_group_30003']]);
  });

  it('opens the footer menu on hover', async () => {
    const { wrapper } = await mountSidebar({
      threads: [],
    });

    expect(queryMenu()).toBeNull();

    await wrapper.find('.sidebar-menu-btn').trigger('click');
    await flushPromises();

    expect(queryMenu()).not.toBeNull();
    expect(queryMenu()?.textContent ?? '').toContain('Show External Chats');
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

    expect(confirmActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Delete "Delete Me"?\nThis cannot be undone.',
        danger: true,
      })
    );
    expect(del).toHaveBeenCalledWith('thread_delete');
    expect(wrapper.emitted('thread-deleted')).toEqual([['thread_delete']]);
    expect(wrapper.findAll('.chat-item')).toHaveLength(0);
  });

  it('opens settings from the footer action', async () => {
    const { wrapper, openSettings } = await mountSidebar({
      threads: [],
    });

    await wrapper.find('.sidebar-menu-btn').trigger('click');
    const settingsButton = document.body.querySelector('[role="menuitem"]');
    expect(settingsButton).not.toBeNull();
    (settingsButton as HTMLButtonElement).click();

    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('filters threads by title from the search box and restores the list on close', async () => {
    const { wrapper } = await mountSidebar({
      threads: [
        {
          id: 'thread_refactor',
          title: 'Refactor backend loop',
          updated_at: '2026-03-22T00:00:00.000Z',
          metadata: '{}',
        },
        {
          id: 'thread_design',
          title: 'Design review',
          updated_at: '2026-03-22T00:00:00.000Z',
          metadata: '{}',
        },
      ],
    });

    const searchButton = wrapper
      .findAll('.sidebar-action-item')
      .find(button => button.text() === 'Search');
    expect(searchButton).toBeDefined();
    await searchButton!.trigger('click');

    const input = wrapper.find('.sidebar-search-input');
    expect(input.exists()).toBe(true);
    await input.setValue('refactor');

    const items = wrapper.findAll('.chat-item');
    expect(items).toHaveLength(1);
    expect(items[0].text()).toContain('Refactor backend loop');

    await input.setValue('nothing-matches');
    expect(wrapper.findAll('.chat-item')).toHaveLength(0);
    expect(wrapper.text()).toContain('No matching chats');

    await input.trigger('keydown.escape');
    expect(wrapper.find('.sidebar-search-input').exists()).toBe(false);
    expect(wrapper.findAll('.chat-item')).toHaveLength(2);
  });

  it('clears the query from the inline clear button without closing the search box', async () => {
    const { wrapper } = await mountSidebar({
      threads: [
        {
          id: 'thread_keep',
          title: 'Keep me visible',
          updated_at: '2026-03-22T00:00:00.000Z',
          metadata: '{}',
        },
      ],
    });

    const searchAction = wrapper
      .findAll('.sidebar-action-item')
      .find(button => button.text() === 'Search');
    await searchAction!.trigger('click');
    await wrapper.find('.sidebar-search-input').setValue('hidden-query');
    expect(wrapper.findAll('.chat-item')).toHaveLength(0);

    await wrapper.find('.sidebar-search-clear').trigger('click');

    expect((wrapper.find('.sidebar-search-input').element as HTMLInputElement).value).toBe('');
    expect(wrapper.findAll('.chat-item')).toHaveLength(1);
    expect(wrapper.find('.sidebar-search-input').exists()).toBe(true);
  });

  it('groups desktop threads under collapsible workspace sections', async () => {
    const { wrapper } = await mountSidebar({
      threads: [
        {
          id: 'thread_loose',
          title: 'Loose thread',
          updated_at: '2026-03-22T00:00:00.000Z',
          metadata: '{}',
        },
        {
          id: 'thread_iki_a',
          title: 'iKi fix sidebar',
          updated_at: '2026-03-22T00:00:00.000Z',
          workspace_id: 'ws_iki',
          metadata: '{}',
        },
        {
          id: 'thread_iki_b',
          title: 'iKi refactor loop',
          updated_at: '2026-03-22T00:00:00.000Z',
          workspace_id: 'ws_iki',
          metadata: '{}',
        },
        {
          id: 'thread_alpha',
          title: 'Alpha task',
          updated_at: '2026-03-22T00:00:00.000Z',
          workspace_id: 'ws_alpha',
          metadata: '{}',
        },
      ],
      workspaces: [
        { id: 'ws_iki', name: 'iKi', path: '/dev/iki' },
        { id: 'ws_alpha', name: 'Alpha', path: '/dev/alpha' },
      ],
    });

    const projectsTab = wrapper
      .findAll('.sidebar-group-tab')
      .find(button => button.text().includes('Projects'));
    await projectsTab!.trigger('click');

    const headers = wrapper.findAll('.sidebar-section-toggle');
    expect(headers.map(header => header.find('.sidebar-section-toggle-lead').text())).toEqual([
      'Alpha',
      'iKi',
    ]);
    expect(headers.map(header => header.attributes('aria-expanded'))).toEqual([
      'true',
      'true',
    ]);
    // Projects view hides plain chats — loose threads live in the recent view.
    expect(wrapper.findAll('.chat-item')).toHaveLength(3);
    expect(wrapper.text()).not.toContain('Loose thread');

    await headers[1]!.trigger('click');
    const itemsAfterCollapse = wrapper.findAll('.chat-item');
    expect(itemsAfterCollapse).toHaveLength(1);
    expect(wrapper.text()).not.toContain('iKi fix sidebar');

    const collapsedHeader = wrapper.findAll('.sidebar-section-toggle')[1]!;
    expect(collapsedHeader.attributes('aria-expanded')).toBe('false');
    await collapsedHeader.trigger('click');
    expect(wrapper.findAll('.chat-item')).toHaveLength(3);
  });

  it('shows relative timestamps and caps the default list with a show-more toggle', async () => {
    const now = Date.now();
    const threads = Array.from({ length: 12 }, (_, index) => ({
      id: `thread_${index}`,
      title: `Thread ${index}`,
      updated_at: new Date(now - index * 60_000).toISOString(),
      metadata: '{}',
    }));

    const { wrapper } = await mountSidebar({ threads });

    expect(wrapper.findAll('.chat-item-time')).toHaveLength(10);
    expect(wrapper.text()).toContain('Just now');
    expect(wrapper.text()).toContain('1m ago');

    const showMore = wrapper.find('.sidebar-show-more');
    expect(showMore.text()).toBe('Show more (2)');

    await showMore.trigger('click');
    expect(wrapper.findAll('.chat-item')).toHaveLength(12);
    expect(wrapper.find('.sidebar-show-more').text()).toBe('Show less');
  });

  it('switches between the recent flat list and the projects-only view', async () => {
    const workThread = {
      id: 'thread_work',
      title: 'Work thread',
      updated_at: '2026-03-22T00:00:00.000Z',
      workspace_id: 'ws_iki',
      metadata: '{"mode":"work"}',
    };
    const chatThread = {
      id: 'thread_chat',
      title: 'Plain chat',
      updated_at: '2026-03-22T00:00:00.000Z',
      metadata: '{}',
    };

    const { wrapper } = await mountSidebar({
      threads: [workThread, chatThread],
      workspaces: [{ id: 'ws_iki', name: 'iKi', path: '/dev/iki', is_temporary: 0 }],
    });

    // Default recent mode: everything flat, no project headers.
    expect(wrapper.findAll('.chat-item')).toHaveLength(2);
    expect(wrapper.find('.sidebar-section-toggle').exists()).toBe(false);

    const projectsTab = wrapper
      .findAll('.sidebar-group-tab')
      .find(button => button.text().includes('Projects'));
    expect(projectsTab).toBeDefined();
    await projectsTab!.trigger('click');

    // Projects mode: work thread grouped under iKi, plain chat hidden.
    expect(wrapper.findAll('.sidebar-section-toggle')).toHaveLength(1);
    expect(wrapper.text()).toContain('Work thread');
    expect(wrapper.text()).not.toContain('Plain chat');

    const recentTab = wrapper
      .findAll('.sidebar-group-tab')
      .find(button => button.text().includes('Recent'));
    await recentTab!.trigger('click');
    expect(wrapper.findAll('.chat-item')).toHaveLength(2);
  });
});
