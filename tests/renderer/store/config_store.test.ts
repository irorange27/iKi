// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../../../src/renderer/services/config_service', () => ({
  configService: {
    get: vi.fn(),
    set: vi.fn(),
    onUpdated: vi.fn(() => () => undefined),
  },
}));

import { createDefaultAppConfig } from '../../../src/shared/config/defaults';
import { useConfigStore } from '../../../src/renderer/store/config';

describe('config store settings write actions', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('centralizes settings writes behind store actions', () => {
    const store = useConfigStore();
    store.config = createDefaultAppConfig();

    store.setToolModel({
      providerType: 'deepseek',
      model: 'deepseek-chat',
    });
    store.updateToolExecution('shellApprovalMode', 'always');
    store.updateNetworkProxy('type', 'socks5');
    store.updateNetworkProxy('host', '127.0.0.1');
    store.updateNetworkProxy('port', 1080);
    store.updateNetwork('timeout', 15000);
    store.updateNetwork('retryAttempts', 5);
    store.updateSecurity('logLevel', 'debug');
    store.updateAdvanced('developerMode', true);
    store.updateKeybinding('sendMessage', 'Ctrl+Enter');

    expect(store.config.toolModel).toEqual({
      providerType: 'deepseek',
      model: 'deepseek-chat',
    });
    expect(store.config.toolExecution.shellApprovalMode).toBe('always');
    expect(store.config.network).toMatchObject({
      timeout: 15000,
      retryAttempts: 5,
      proxy: {
        enable: false,
        type: 'socks5',
        host: '127.0.0.1',
        port: 1080,
      },
    });
    expect(store.config.security.logLevel).toBe('debug');
    expect(store.config.advanced.developerMode).toBe(true);
    expect(store.config.keybindings.sendMessage).toBe('Ctrl+Enter');
  });

  it('replaces the tool model atomically when clearing auto-detect state', () => {
    const store = useConfigStore();
    store.config = createDefaultAppConfig();
    store.config.toolModel = {
      providerType: 'openai',
      model: 'gpt-4o-mini',
    };

    store.setToolModel({
      providerType: '',
      model: '',
    });

    expect(store.config.toolModel).toEqual({
      providerType: '',
      model: '',
    });
  });
});
