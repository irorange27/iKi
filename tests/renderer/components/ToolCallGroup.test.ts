// @vitest-environment happy-dom

import { describe, expect, it, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import type { UIMessage } from 'ai';

import ToolCallGroup from '../../../packages/desktop/src/renderer/components/chat/ToolCallGroup.vue';
import {
  resetToolUiStateMap,
  updateToolUiState,
} from '../../../packages/desktop/src/renderer/modules/chat/tool_ui_state';

const createMessage = (): UIMessage =>
  ({
    id: 'msg_1',
    role: 'assistant',
    parts: [],
  }) as unknown as UIMessage;

const readCall = (toolCallId: string, overrides: Record<string, unknown> = {}) => ({
  type: 'dynamic-tool',
  toolName: 'read_file',
  toolCallId,
  state: 'output-available',
  input: { path: 'packages/app/src/main.ts' },
  output: 'contents',
  ...overrides,
});

const mountGroup = (parts: unknown[], groupKey = 'msg_1-tool-call-group-0') =>
  mount(ToolCallGroup, {
    props: {
      groupKey,
      message: createMessage(),
      parts,
      approvalProcessingFor: () => false,
      getMcpServerLabel: () => '',
    },
  });

describe('ToolCallGroup', () => {
  afterEach(() => {
    resetToolUiStateMap();
  });

  it('keeps a fully settled group collapsed until the summary is clicked', async () => {
    const wrapper = mountGroup([readCall('call_1'), readCall('call_2')]);

    expect(wrapper.find('.tool-call-group-summary').exists()).toBe(true);
    expect(wrapper.find('.tool-call-group-rows').exists()).toBe(false);

    await wrapper.find('.tool-call-group-summary').trigger('click');

    expect(wrapper.find('.tool-call-group-rows').exists()).toBe(true);
    expect(wrapper.findAll('.tool-call-row')).toHaveLength(2);
  });

  it('auto-opens while a call is still running', () => {
    const wrapper = mountGroup([
      readCall('call_1'),
      readCall('call_2', { state: 'input-streaming', output: undefined }),
    ]);

    expect(wrapper.find('.tool-call-group-rows').exists()).toBe(true);
    expect(wrapper.findAll('.tool-call-row')).toHaveLength(2);
  });

  it('renders verb, badge, title, and path on a child row', async () => {
    // A persisted open-override keeps the group open across re-renders.
    updateToolUiState('msg_1-tool-call-group-7', { collapsed: false });
    const wrapper = mountGroup([readCall('call_1')], 'msg_1-tool-call-group-7');
    await nextTick();

    // Single-call groups still show the summary line (consistent affordance).
    expect(wrapper.find('.tool-call-group-summary').exists()).toBe(true);
    const row = wrapper.find('.tool-call-row-main');
    expect(row.exists()).toBe(true);
    expect(row.text()).toContain('Read');
    expect(row.find('.tool-call-row-badge').text()).toBe('TS');
    expect(row.find('.tool-call-row-title').text()).toBe('main.ts');
    expect(row.find('.tool-call-row-path').text()).toContain('packages/app/src/');
  });

  it('expands the embedded tool detail when a row is clicked', async () => {
    updateToolUiState('msg_1-tool-call-group-3', { collapsed: false });
    const wrapper = mountGroup([readCall('call_1')], 'msg_1-tool-call-group-3');
    await nextTick();

    // A settled call starts with its detail quiet...
    expect(wrapper.find('.tool-call-row-detail-body').exists()).toBe(false);

    const row = wrapper.find('.tool-call-row-main');
    await row.trigger('click');
    expect(wrapper.find('.tool-call-row-detail-body').exists()).toBe(true);
    expect(wrapper.find('.tool-call-row-detail-body').find('.tool-card-section').exists()).toBe(
      true
    );

    // ...and clicking again collapses it.
    await row.trigger('click');
    expect(wrapper.find('.tool-call-row-detail-body').exists()).toBe(false);
  });

  it('always opens groups containing an errored call', () => {
    const wrapper = mountGroup([
      readCall('call_1', { state: 'output-error', output: undefined, error: 'boom' }),
    ]);

    expect(wrapper.find('.tool-call-group-rows').exists()).toBe(true);
  });
});
