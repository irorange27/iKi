// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import McpSettings from '../../../packages/desktop/src/renderer/components/settings/McpSettings.vue';
import { useConfigStore } from '../../../packages/desktop/src/renderer/store/config';
import { createDefaultAppConfig } from '@iki/backend/config/defaults';
import type { McpServerSummary } from '@iki/backend/types/mcp';

const setElectronApi = (api: unknown) => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: api,
  });
};

const findButtonByText = (wrapper: VueWrapper, text: string) => {
  const match = wrapper
    .findAll('button')
    .find(button => button.text().replace(/\s+/g, ' ').includes(text));

  if (!match) {
    throw new Error(`Button not found: ${text}`);
  }

  return match;
};

const findLabelByText = (wrapper: VueWrapper, text: string) => {
  const match = wrapper
    .findAll('label')
    .find(label => label.text().replace(/\s+/g, ' ').includes(text));

  if (!match) {
    throw new Error(`Label not found: ${text}`);
  }

  return match;
};

const selectSettingsOption = async (wrapper: VueWrapper, labelText: string, optionText: string) => {
  const label = findLabelByText(wrapper, labelText);
  await label.find('.settings-select-trigger').trigger('click');
  await flushPromises();

  const option = label
    .findAll('.settings-select-option')
    .find(candidate => candidate.text().replace(/\s+/g, ' ').includes(optionText));

  if (!option) {
    throw new Error(`Option not found for "${labelText}": ${optionText}`);
  }

  await option.trigger('click');
  await flushPromises();
};

const mountMcpSettings = async (options?: {
  servers?: McpServerSummary[];
}) => {
  const pinia = createPinia();
  setActivePinia(pinia);

  const list = vi.fn(async () => options?.servers ?? []);
  const add = vi.fn(async () => ({ id: 'server_new' }));
  const update = vi.fn(async () => ({ id: 'server_new' }));

  setElectronApi({
    mcp: {
      list,
      add,
      update,
      delete: vi.fn(async () => ({ success: true })),
      connect: vi.fn(async () => ({ success: true })),
      disconnect: vi.fn(async () => ({ success: true })),
      refreshTools: vi.fn(async () => ({ success: true })),
    },
  });

  const store = useConfigStore();
  store.config = createDefaultAppConfig();

  const wrapper = mount(McpSettings, {
    global: {
      plugins: [pinia],
      stubs: {
        RefreshCw: true,
      },
    },
  });

  await flushPromises();

  return { wrapper, store, list, add, update };
};

describe('McpSettings', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
  });

  it('updates MCP config and emits a config-change event for remote server opt-in', async () => {
    const { wrapper, store } = await mountMcpSettings();

    expect(wrapper.text()).toContain('Remote servers are blocked unless you enable this toggle.');

    await findLabelByText(wrapper, 'Allow remote MCP servers').find('input').setValue(true);
    await flushPromises();

    expect(store.config.mcp.allowRemoteServers).toBe(true);
    expect(wrapper.emitted('config-change')).toHaveLength(1);
    expect(wrapper.text()).not.toContain('Remote servers are blocked unless you enable this toggle.');
  });

  it('normalizes stdio server form fields before saving a new MCP server', async () => {
    const { wrapper, add } = await mountMcpSettings();

    await findButtonByText(wrapper, 'Add Server').trigger('click');
    await flushPromises();

    const cards = wrapper.findAll('.settings-card');
    const formCard = cards[cards.length - 1];

    await formCard.find('input[placeholder="Local tools"]').setValue('Local Tools');
    await findLabelByText(formCard, 'Enabled').find('input').setValue(true);
    await selectSettingsOption(formCard, 'Approval mode override', 'Always require approval');
    await findLabelByText(formCard, 'Tool allowlist').find('textarea').setValue('web\nfetch');
    await findLabelByText(formCard, 'Command').find('input').setValue('node');
    await findLabelByText(formCard, 'Working directory').find('input').setValue('/tmp/mcp-demo');
    await findLabelByText(formCard, 'Args').find('textarea').setValue('server.js\n--port=7000');
    await findLabelByText(formCard, 'Environment').find('textarea').setValue(
      'API_KEY=abc123\nDEBUG=1'
    );

    await findButtonByText(formCard, 'Save Server').trigger('click');
    await flushPromises();

    expect(add).toHaveBeenCalledWith({
      name: 'Local Tools',
      transport: 'stdio',
      enabled: true,
      approval_mode: 'always',
      tool_allowlist: ['web', 'fetch'],
      command: 'node',
      args: ['server.js', '--port=7000'],
      cwd: '/tmp/mcp-demo',
      env: {
        API_KEY: 'abc123',
        DEBUG: '1',
      },
    });
    expect(wrapper.text()).not.toContain('Command is required for stdio servers.');
  });

  it('surfaces remote server header validation errors instead of calling the save API', async () => {
    const { wrapper, add } = await mountMcpSettings();

    await findButtonByText(wrapper, 'Add Server').trigger('click');
    await flushPromises();

    const cards = wrapper.findAll('.settings-card');
    const formCard = cards[cards.length - 1];

    await formCard.find('input[placeholder="Local tools"]').setValue('Remote Docs');
    await selectSettingsOption(formCard, 'Transport', 'Streamable HTTP (Recommended)');
    await findLabelByText(formCard, 'Base URL').find('input').setValue('https://docs.example.com');
    await findLabelByText(formCard, 'Headers').find('textarea').setValue('bad header');

    await findButtonByText(formCard, 'Save Server').trigger('click');
    await flushPromises();

    expect(add).not.toHaveBeenCalled();
    expect(formCard.text()).toContain('Use JSON or key=value lines.');
  });
});
