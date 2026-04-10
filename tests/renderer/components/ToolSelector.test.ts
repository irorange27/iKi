// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import ToolSelector from '../../../src/renderer/components/ToolSelector.vue';

const setElectronApi = (api: unknown) => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: api,
  });
};

const findButtonByText = (wrapper: ReturnType<typeof mount>, text: string) => {
  const match = wrapper
    .findAll('button')
    .find(button => button.text().replace(/\s+/g, ' ').includes(text));

  if (!match) {
    throw new Error(`Button not found: ${text}`);
  }

  return match;
};

describe('ToolSelector', () => {
  beforeEach(() => {
    setElectronApi({
      tools: {
        list: vi.fn(async () => [
          {
            name: 'web',
            displayName: 'Web Search',
            description: 'Search the web',
            source: { kind: 'builtin' },
          },
          {
            name: 'mcp_lookup',
            displayName: 'Lookup',
            description: 'Query MCP server',
            source: { kind: 'mcp', id: 'server_1', name: 'Docs Server' },
          },
        ]),
      },
      mcp: {
        list: vi.fn(async () => [
          {
            id: 'server_1',
            name: 'Docs Server',
            enabled: true,
            status: {
              state: 'connected',
              toolCount: 1,
            },
          },
        ]),
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
  });

  it('emits manual built-in tool selection from the rendered panel', async () => {
    const wrapper = mount(ToolSelector, {
      props: {
        tools: [],
        mcpServerIds: [],
        mode: 'manual',
      },
    });

    await flushPromises();
    expect(wrapper.find('.composer-selector-trigger').attributes('title')).toBe('Choose tools');
    await wrapper.find('.composer-selector-trigger').trigger('click');
    await flushPromises();

    await findButtonByText(wrapper, 'Web Search').trigger('click');

    expect(wrapper.emitted('update:mcpServerIds')).toEqual([[[]]]);
    expect(wrapper.emitted('update:tools')).toEqual([[['web']]]);
  });

  it('composes MCP tool names when a server is enabled for the conversation', async () => {
    const wrapper = mount(ToolSelector, {
      props: {
        tools: ['web'],
        mcpServerIds: [],
        mode: 'manual',
      },
    });

    await flushPromises();
    await wrapper.find('.composer-selector-trigger').trigger('click');
    await flushPromises();

    await wrapper.find('.selector-section-toggle').trigger('click');
    await flushPromises();
    await findButtonByText(wrapper, 'Docs Server').trigger('click');

    expect(wrapper.emitted('update:mcpServerIds')).toEqual([[['server_1']]]);
    expect(wrapper.emitted('update:tools')).toEqual([[['web', 'mcp_lookup']]]);
  });

  it('exposes trigger tooltip state for auto mode and selected counts', async () => {
    const autoWrapper = mount(ToolSelector, {
      props: {
        tools: [],
        mcpServerIds: [],
        mode: 'auto',
      },
    });

    await flushPromises();
    expect(autoWrapper.find('.composer-selector-trigger').attributes('title')).toBe('Tools: auto');

    const selectedWrapper = mount(ToolSelector, {
      props: {
        tools: ['web'],
        mcpServerIds: ['server_1'],
        mode: 'manual',
      },
    });

    await flushPromises();
    expect(selectedWrapper.find('.composer-selector-trigger').attributes('title')).toBe(
      'Tools: 2 selected'
    );
  });
});
