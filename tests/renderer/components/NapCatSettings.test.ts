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

const emptyHeartbeat = {
  lastReceivedAt: null,
  intervalMs: null,
  ageMs: null,
  online: null,
  good: null,
  stale: null,
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
      bridges: {
        napcat: {
          state: 'disconnected',
          activeConnectionCount: 0,
          lastConnectedAt: null,
          lastDisconnectedAt: null,
          heartbeat: emptyHeartbeat,
        },
      },
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
        bridges: {
          napcat: {
            state: 'disconnected',
            activeConnectionCount: 0,
            lastConnectedAt: null,
            lastDisconnectedAt: null,
            heartbeat: emptyHeartbeat,
          },
        },
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
    store.config.bridges.napcat.enabled = true;

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
    expect(card.text()).toContain('[daemon/napcat]');
    expect(card.text()).toContain('napcat.message.received');
    expect(card.text()).toContain('20002');
    expect(card.text()).toContain('30003');
    expect(card.text()).toContain('reply_eligible');
    expect(card.text()).toContain('Recent QQ Messages');

    wrapper.unmount();
  });

  it('shows daemon health separately from live NapCat bridge connectivity', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);

    const store = useConfigStore();
    store.config = createDefaultAppConfig();
    store.config.bridges.napcat.enabled = true;

    const wrapper = mount(NapCatSettings, {
      props: {
        active: true,
      },
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();

    const card = findCardByTitle(wrapper, 'Runtime Status');

    expect(card.text()).toContain('Daemon');
    expect(card.text()).toContain('Online');
    expect(card.text()).toContain('Reverse WebSocket');
    expect(card.text()).toContain('Waiting for NapCat');
    expect(card.text()).toContain('Heartbeat');
    expect(card.text()).toContain('Waiting for transport');
    expect(card.text()).toContain('Active Connections');
    expect(card.text()).toContain('0');
    expect(card.text()).toContain('Last Connected');
    expect(card.text()).toContain('No successful session yet');
    expect(card.text()).toContain('Last Disconnected');
    expect(card.text()).toContain('No disconnect observed yet');
    expect(card.text()).toContain('Last Heartbeat');
    expect(card.text()).toContain('Not received yet');
    expect(card.text()).toContain('Diagnosis');
    expect(card.text()).toContain('Daemon is healthy; waiting for NapCat reverse WebSocket transport');
    expect(card.text()).toContain('Daemon is reachable, but NapCat has not opened a reverse WebSocket yet.');
    expect(card.text()).toContain(
      'Heartbeat data is unavailable until NapCat opens a reverse WebSocket session.'
    );

    wrapper.unmount();
  });

  it('surfaces daemon-down as the root cause of bridge unavailability', async () => {
    getDaemonStatusMock.mockResolvedValueOnce({
      online: false,
      host: '127.0.0.1',
      port: 6127,
      status: 'offline',
      source: 'recorded',
      uptimeSeconds: null,
      error: 'connect ECONNREFUSED 127.0.0.1:6127',
      bridges: {
        napcat: {
          state: 'unknown',
          activeConnectionCount: null,
          lastConnectedAt: null,
          lastDisconnectedAt: null,
          heartbeat: emptyHeartbeat,
        },
      },
    });

    const pinia = createPinia();
    setActivePinia(pinia);

    const store = useConfigStore();
    store.config = createDefaultAppConfig();
    store.config.bridges.napcat.enabled = true;

    const wrapper = mount(NapCatSettings, {
      props: {
        active: true,
      },
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();

    const card = findCardByTitle(wrapper, 'Runtime Status');

    expect(card.text()).toContain('Offline');
    expect(card.text()).toContain('Blocked by Daemon');
    expect(card.text()).toContain('Daemon is down or unreachable');
    expect(card.text()).toContain('Daemon is unreachable: connect ECONNREFUSED 127.0.0.1:6127');
    expect(card.text()).toContain(
      'Reverse WebSocket transport cannot connect because the daemon is offline or not listening on the configured port.'
    );
    expect(card.text()).toContain(
      'Heartbeat liveness is unavailable because the daemon is offline or unreachable.'
    );

    wrapper.unmount();
  });

  it('keeps the status card internally consistent when an older main process omits bridge runtime', async () => {
    getDaemonStatusMock.mockResolvedValueOnce({
      online: true,
      host: '127.0.0.1',
      port: 6127,
      status: 'ok',
      source: 'health',
      uptimeSeconds: 42,
    } as never);

    const pinia = createPinia();
    setActivePinia(pinia);

    const store = useConfigStore();
    store.config = createDefaultAppConfig();
    store.config.bridges.napcat.enabled = true;

    const wrapper = mount(NapCatSettings, {
      props: {
        active: true,
      },
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();

    const card = findCardByTitle(wrapper, 'Runtime Status');

    expect(card.text()).toContain('Reverse WebSocket');
    expect(card.text()).toContain('Unavailable');
    expect(card.text()).toContain('Heartbeat');
    expect(card.text()).toContain('Diagnosis');
    expect(card.text()).toContain('Daemon is online, but bridge runtime was not reported');
    expect(card.text()).toContain(
      'Daemon is online, but it did not report reverse WebSocket transport state.'
    );
    expect(card.text()).toContain('Daemon is online, but it did not report heartbeat runtime.');

    wrapper.unmount();
  });

  it('treats recent healthy heartbeat as the end-to-end availability signal', async () => {
    getDaemonStatusMock.mockResolvedValueOnce({
      online: true,
      host: '127.0.0.1',
      port: 6127,
      status: 'ok',
      source: 'health',
      uptimeSeconds: 42,
      bridges: {
        napcat: {
          state: 'connected',
          activeConnectionCount: 1,
          lastConnectedAt: '2026-04-22T00:00:00.000Z',
          lastDisconnectedAt: '2026-04-21T23:59:00.000Z',
          heartbeat: {
            lastReceivedAt: '2026-04-22T00:00:00.000Z',
            intervalMs: 5000,
            ageMs: 1200,
            online: true,
            good: true,
            stale: false,
          },
        },
      },
    });

    const pinia = createPinia();
    setActivePinia(pinia);

    const store = useConfigStore();
    store.config = createDefaultAppConfig();
    store.config.bridges.napcat.enabled = true;

    const wrapper = mount(NapCatSettings, {
      props: {
        active: true,
      },
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();

    const card = findCardByTitle(wrapper, 'Runtime Status');

    expect(card.text()).toContain('Connected');
    expect(card.text()).toContain('Healthy');
    expect(card.text()).toContain('1');
    expect(card.text()).toContain('1.2s ago / 5.0s interval');
    expect(card.text()).toContain('Reverse WebSocket is connected and heartbeat looks healthy');
    expect(card.text()).toContain(
      'A recent healthy NapCat heartbeat confirms the reverse WebSocket session is alive.'
    );

    wrapper.unmount();
  });

  it('does not mark NapCat unavailable when reverse WebSocket is connected but heartbeat is not observed yet', async () => {
    getDaemonStatusMock.mockResolvedValueOnce({
      online: true,
      host: '127.0.0.1',
      port: 6127,
      status: 'ok',
      source: 'health',
      uptimeSeconds: 42,
      bridges: {
        napcat: {
          state: 'connected',
          activeConnectionCount: 1,
          lastConnectedAt: '2026-04-22T00:00:00.000Z',
          lastDisconnectedAt: '2026-04-21T23:59:00.000Z',
          heartbeat: emptyHeartbeat,
        },
      },
    });

    const pinia = createPinia();
    setActivePinia(pinia);

    const store = useConfigStore();
    store.config = createDefaultAppConfig();
    store.config.bridges.napcat.enabled = true;

    const wrapper = mount(NapCatSettings, {
      props: {
        active: true,
      },
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();

    const card = findCardByTitle(wrapper, 'Runtime Status');

    expect(card.text()).toContain('Reverse WebSocket');
    expect(card.text()).toContain('Connected');
    expect(card.text()).toContain('Heartbeat');
    expect(card.text()).toContain('Not observed yet');
    expect(card.text()).toContain('Active Connections');
    expect(card.text()).toContain('1');
    expect(card.text()).toContain(
      'Reverse WebSocket is connected; heartbeat has not been observed yet'
    );
    expect(card.text()).toContain(
      'Reverse WebSocket transport is already connected. No heartbeat has been observed yet'
    );

    wrapper.unmount();
  });

  it('shows recent connection history when NapCat is currently disconnected after previously connecting', async () => {
    vi.setSystemTime(new Date('2026-04-22T00:10:00.000Z'));

    getDaemonStatusMock.mockResolvedValueOnce({
      online: true,
      host: '127.0.0.1',
      port: 6127,
      status: 'ok',
      source: 'health',
      uptimeSeconds: 42,
      bridges: {
        napcat: {
          state: 'disconnected',
          activeConnectionCount: 0,
          lastConnectedAt: '2026-04-22T00:00:00.000Z',
          lastDisconnectedAt: '2026-04-22T00:05:00.000Z',
          heartbeat: emptyHeartbeat,
        },
      },
    });

    const pinia = createPinia();
    setActivePinia(pinia);

    const store = useConfigStore();
    store.config = createDefaultAppConfig();
    store.config.bridges.napcat.enabled = true;

    const wrapper = mount(NapCatSettings, {
      props: {
        active: true,
      },
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();

    const card = findCardByTitle(wrapper, 'Runtime Status');

    expect(card.text()).toContain('Disconnected');
    expect(card.text()).toContain('Last Connected');
    expect(card.text()).toContain('10m ago');
    expect(card.text()).toContain('Last Disconnected');
    expect(card.text()).toContain('5.0m ago');
    expect(card.text()).toContain(
      'Reverse WebSocket is currently disconnected; the last session closed 5.0m ago'
    );
    expect(card.text()).toContain(
      'NapCat reverse WebSocket is currently disconnected. The last session closed 5.0m ago.'
    );

    wrapper.unmount();
  });
});
