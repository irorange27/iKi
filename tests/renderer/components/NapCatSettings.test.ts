// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const {
  getRuntimeInfoMock,
  getDaemonStatusMock,
  getDaemonLogsMock,
  controlDaemonMock,
} = vi.hoisted(() => ({
  getRuntimeInfoMock: vi.fn(),
  getDaemonStatusMock: vi.fn(),
  getDaemonLogsMock: vi.fn(),
  controlDaemonMock: vi.fn(),
}));

vi.mock('../../../src/renderer/services/config_service', () => ({
  configService: {
    getRuntimeInfo: getRuntimeInfoMock,
    getDaemonStatus: getDaemonStatusMock,
    getDaemonLogs: getDaemonLogsMock,
    controlDaemon: controlDaemonMock,
  },
}));

import NapCatSettings from '../../../src/renderer/components/settings/NapCatSettings.vue';
import { createDefaultAppConfig } from '../../../src/shared/config/defaults';
import { useConfigStore } from '../../../src/renderer/store/config';

const setElectronApi = (api: unknown) => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: api,
  });
};

const findCardByTitle = (wrapper: VueWrapper, title: string) => {
  const match = wrapper.findAll('.settings-card').find(card => card.find('.card-title').text() === title);
  if (!match) {
    throw new Error(`Card not found: ${title}`);
  }
  return match;
};

describe('NapCatSettings', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    setActivePinia(createPinia());

    setElectronApi({
      providers: {
        list: vi.fn(async () => []),
      },
    });

    getRuntimeInfoMock.mockResolvedValue({
      userDataPath: '/tmp/iki-user-data',
      dbPath: '/tmp/iki-user-data/iKi_v0.db',
      daemon: {
        defaultHost: '127.0.0.1',
        defaultPort: 6127,
        configuredHost: '127.0.0.1',
        configuredPort: 6127,
        napcatWsPath: '/onebot/v11/ws',
        localNapCatWsUrl: 'ws://127.0.0.1:6127/onebot/v11/ws',
        dockerNapCatWsUrl: 'ws://host.docker.internal:6127/onebot/v11/ws',
      },
    });
    getDaemonStatusMock.mockResolvedValue({
      online: true,
      host: '127.0.0.1',
      port: 6127,
      status: 'ok',
      source: 'health',
      uptimeSeconds: 42,
    });
    getDaemonLogsMock.mockResolvedValue({
      filePath: '/tmp/iki-user-data/logs/daemon.log',
      entries: [],
      napcatMessages: [
        {
          receivedAt: '2026-03-22T07:42:08.142Z',
          messageType: 'group',
          userId: '20002',
          groupId: '30003',
          messageId: 'm1',
          textPreview: 'hello from qq',
          mentionedSelf: false,
          replyEligible: false,
        },
      ],
    });
    controlDaemonMock.mockResolvedValue({
      success: true,
      action: 'restart',
      message: 'ok',
      embeddedRunning: true,
      status: {
        online: true,
        host: '127.0.0.1',
        port: 6127,
        status: 'ok',
        source: 'health',
        uptimeSeconds: 42,
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders recent QQ message previews inside the shared Recent Logs panel', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);

    const store = useConfigStore();
    store.config = createDefaultAppConfig();

    const wrapper = mount(NapCatSettings, {
      props: {
        active: true,
      },
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();

    const card = findCardByTitle(wrapper, 'Recent Logs');

    expect(getDaemonLogsMock).toHaveBeenCalledWith(120);
    expect(card.text()).toContain('QQ Messages');
    expect(card.text()).toContain('hello from qq');
    expect(card.text()).toContain('[daemon] [info] [daemon/napcat]');
    expect(card.text()).toContain('napcat.message.received');
    expect(card.text()).toContain('20002');
    expect(card.text()).toContain('30003');
    expect(card.text()).toContain('reply_eligible');
    expect(card.text()).toContain('Recent QQ Messages');

    wrapper.unmount();
  });
});
