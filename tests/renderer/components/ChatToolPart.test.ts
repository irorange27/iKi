// @vitest-environment happy-dom

import { describe, expect, it, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import type { UIMessage } from 'ai';

import ChatToolPart from '../../../src/renderer/components/chat/ChatToolPart.vue';
import {
  resetToolUiStateMap,
  updateToolUiState,
} from '../../../src/renderer/modules/chat/tool_ui_state';

const createMessage = (): UIMessage =>
  ({
    id: 'msg_1',
    role: 'assistant',
    parts: [],
  }) as unknown as UIMessage;

describe('ChatToolPart', () => {
  afterEach(() => {
    resetToolUiStateMap();
  });

  it('emits approval decisions with the current message and part payload', async () => {
    const message = createMessage();
    const part = {
      type: 'tool-approval-request',
      approvalId: 'approval_1',
      toolCallId: 'call_1',
      toolName: 'shell',
      input: {
        command: 'pwd',
      },
    };

    const wrapper = mount(ChatToolPart, {
      props: {
        approvalProcessing: false,
        mcpServerLabel: '',
        message,
        part,
      },
    });

    await wrapper.find('.approve-btn').trigger('click');
    await wrapper.find('.reject-btn').trigger('click');

    expect(wrapper.emitted('approve-tool')).toEqual([
      [{ approved: true, message, part }],
      [{ approved: false, message, part }],
    ]);
  });

  it('starts completed tool results collapsed and toggles details on demand', async () => {
    const wrapper = mount(ChatToolPart, {
      props: {
        approvalProcessing: false,
        mcpServerLabel: '',
        message: createMessage(),
        part: {
          type: 'tool-result',
          toolCallId: 'call_2',
          toolName: 'shell',
          state: 'output-available',
          input: {
            command: 'pwd',
            cwd: '/tmp/demo',
            timeout: 1200,
          },
          output: {
            stdout: '/tmp/demo\n',
          },
          startedAt: 1_000,
          endedAt: 2_500,
        },
      },
    });

    expect(wrapper.find('.tool-result-content').classes()).toContain('tool-card-collapsed');
    expect(wrapper.find('.tool-card-section').exists()).toBe(false);
    expect(wrapper.find('.tool-collapse-btn').attributes('aria-label')).toBe(
      'Expand tool details'
    );

    await wrapper.find('.tool-collapse-btn').trigger('click');

    expect(wrapper.find('.tool-result-content').classes()).not.toContain('tool-card-collapsed');
    expect(wrapper.find('.tool-card-section').text()).toContain('Command');
    expect(wrapper.text()).toContain('pwd');
    expect(wrapper.text()).toContain('cwd: /tmp/demo');
    expect(wrapper.text()).toContain('1.5 s');
    expect(wrapper.find('.tool-call-id-value').text()).toBe('call_2');

    await wrapper.find('.tool-collapse-btn').trigger('click');

    expect(wrapper.find('.tool-card-section').exists()).toBe(false);
  });

  it('renders deduplicated web citations from tool output when expanded', () => {
    updateToolUiState('call_web', { collapsed: false });

    const wrapper = mount(ChatToolPart, {
      props: {
        approvalProcessing: false,
        mcpServerLabel: 'Docs Server',
        message: createMessage(),
        part: {
          type: 'tool-result',
          toolCallId: 'call_web',
          toolName: 'web',
          state: 'output-available',
          input: {
            query: 'openai docs',
            limit: 5,
          },
          output: {
            results: [
              { title: 'OpenAI Docs', url: 'https://platform.openai.com/docs' },
              { title: 'OpenAI Docs', url: 'https://platform.openai.com/docs' },
              { title: 'API Reference', url: 'https://api.example.com/reference' },
            ],
          },
        },
      },
    });

    const citations = wrapper.findAll('.tool-citation');

    expect(citations).toHaveLength(2);
    expect(citations[0].text()).toContain('OpenAI Docs');
    expect(citations[0].text()).toContain('platform.openai.com');
    expect(citations[1].text()).toContain('API Reference');
    expect(wrapper.text()).toContain('MCP Server: Docs Server');
  });

  it('renders todo results as a dedicated execution-plan UI and keeps them expanded by default', () => {
    const wrapper = mount(ChatToolPart, {
      props: {
        approvalProcessing: false,
        mcpServerLabel: '',
        message: createMessage(),
        part: {
          type: 'tool-result',
          toolCallId: 'call_todo',
          toolName: 'todo',
          state: 'output-available',
          input: {
            items: [
              { id: '1', text: 'Inspect current code', status: 'completed' },
              { id: '2', text: 'Implement fix', status: 'in_progress' },
              { id: '3', text: 'Run tests', status: 'pending' },
            ],
          },
          output: {
            items: [
              { id: '1', text: 'Inspect current code', status: 'completed' },
              { id: '2', text: 'Implement fix', status: 'in_progress' },
              { id: '3', text: 'Run tests', status: 'pending' },
            ],
            totalCount: 3,
            completedCount: 1,
            inProgressCount: 1,
            pendingCount: 1,
          },
        },
      },
    });

    expect(wrapper.find('.tool-result-content').classes()).not.toContain('tool-card-collapsed');
    expect(wrapper.find('.todo-plan').exists()).toBe(true);
    expect(wrapper.text()).toContain('Execution Plan');
    expect(wrapper.text()).toContain('1 / 3 completed');
    expect(wrapper.text()).toContain('Implement fix');
    expect(wrapper.text()).toContain('#2');
    expect(wrapper.find('.tool-json-output').exists()).toBe(false);
  });
});
