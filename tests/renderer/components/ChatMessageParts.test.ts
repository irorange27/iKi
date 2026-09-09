// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { UIMessage } from 'ai';

import ChatMessageParts from '../../../packages/desktop/src/renderer/components/chat/ChatMessageParts.vue';

const createMessage = (): UIMessage =>
  ({
    id: 'assistant_1',
    role: 'assistant',
    parts: [
      {
        type: 'data-token-usage',
        data: {
          inputTokens: 640,
          maxInputTokens: 128000,
        },
      },
      {
        type: 'data-affect-signal',
        data: {
          source: 'realtime',
          label: 'sadness',
          confidence: 0.85,
          guardActive: false,
        },
      },
      {
        type: 'text',
        text: 'Reply text should stay visible.',
      },
    ],
  }) as unknown as UIMessage;

const createReasoningMessage = (state: string): UIMessage =>
  ({
    id: 'assistant_reasoning',
    role: 'assistant',
    parts: [
      {
        type: 'reasoning',
        state,
        text: 'We need answer in Chinese. User asks about safety in Northern Italy.\nSecond line has more detail.',
      },
      {
        type: 'text',
        text: 'Answer body.',
      },
    ],
  }) as unknown as UIMessage;

describe('ChatMessageParts', () => {
  it('hides data parts from the rendered message body', () => {
    const wrapper = mount(ChatMessageParts, {
      props: {
        message: createMessage(),
        messageIndex: 0,
        activeAssistantMessageId: null,
        streamRenderTick: 0,
        approvalProcessing: () => false,
        getMcpServerLabel: () => '',
      },
    });

    expect(wrapper.text()).toContain('Reply text should stay visible.');
    expect(wrapper.findAll('.message-part')).toHaveLength(1);
    expect(wrapper.text()).not.toContain('640');
    expect(wrapper.text()).not.toContain('token-usage');
    expect(wrapper.text()).not.toContain('affect-signal');
    expect(wrapper.text()).not.toContain('sadness');
    expect(wrapper.find('.tool-fallback-content').exists()).toBe(false);
  });

  it('collapses consecutive tool calls into one quiet group', () => {
    const wrapper = mount(ChatMessageParts, {
      props: {
        message: {
          id: 'assistant_tools',
          role: 'assistant',
          parts: [
            {
              type: 'dynamic-tool',
              toolName: 'read_file',
              toolCallId: 'call_1',
              state: 'output-available',
              input: { path: 'src/a.ts' },
              output: 'a',
            },
            {
              type: 'dynamic-tool',
              toolName: 'read_file',
              toolCallId: 'call_2',
              state: 'output-available',
              input: { path: 'src/b.ts' },
              output: 'b',
            },
            { type: 'text', text: 'Both files read.' },
          ],
        } as unknown as UIMessage,
        messageIndex: 0,
        activeAssistantMessageId: null,
        streamRenderTick: 0,
        approvalProcessing: () => false,
        getMcpServerLabel: () => '',
      },
    });

    // Settled tool calls group into a single summary; no per-call cards.
    expect(wrapper.findAll('.tool-call-group')).toHaveLength(1);
    expect(wrapper.find('.tool-call-group-rows').exists()).toBe(false);
    expect(wrapper.find('.tool-result-content').exists()).toBe(false);
    expect(wrapper.find('.tool-call-content').exists()).toBe(false);
    expect(wrapper.text()).toContain('Both files read.');
  });

  it('renders composer invocation tokens inside the message body', () => {
    const wrapper = mount(ChatMessageParts, {
      props: {
        message: {
          id: 'user_1',
          role: 'user',
          parts: [
            {
              type: 'data-composer-invocation',
              data: {
                tokens: [
                  {
                    id: 'skill:codex:frontend-dev',
                    kind: 'skill',
                    prefix: '$',
                    label: 'frontend-dev',
                  },
                  {
                    id: 'prompt_music',
                    kind: 'prompt-app',
                    prefix: '',
                    label: 'music',
                  },
                ],
              },
            },
            {
              type: 'text',
              text: 'Build a landing page and matching soundtrack.',
            },
          ],
        } as unknown as UIMessage,
        messageIndex: 0,
        activeAssistantMessageId: null,
        streamRenderTick: 0,
        approvalProcessing: () => false,
        getMcpServerLabel: () => '',
      },
    });

    expect(wrapper.text()).toContain('$frontend-dev');
    expect(wrapper.text()).toContain('music');
    expect(wrapper.text()).toContain('Build a landing page and matching soundtrack.');
    expect(wrapper.findAll('.message-part')).toHaveLength(2);
  });

  it('collapses finished reasoning behind a one-line preview and expands on click', async () => {
    const wrapper = mount(ChatMessageParts, {
      props: {
        message: createReasoningMessage('done'),
        messageIndex: 0,
        activeAssistantMessageId: null,
        approvalProcessing: () => false,
        getMcpServerLabel: () => '',
      },
    });

    const reasoning = wrapper.find('details.message-reasoning');
    expect(reasoning.attributes('open')).toBeUndefined();
    expect(wrapper.find('.message-reasoning-preview').text()).toContain(
      'We need answer in Chinese'
    );
    expect(wrapper.find('.message-reasoning-preview').text()).not.toContain('Second line');
    expect(wrapper.find('.message-reasoning-body').text()).toContain('Second line has more detail.');

    await wrapper.find('.message-reasoning-summary').trigger('click');

    expect(wrapper.find('details.message-reasoning').attributes('open')).toBeDefined();
    expect(wrapper.find('.message-reasoning-preview').exists()).toBe(false);
  });

  it('keeps a streaming reasoning part expanded by default', () => {
    const wrapper = mount(ChatMessageParts, {
      props: {
        message: createReasoningMessage('streaming'),
        messageIndex: 0,
        activeAssistantMessageId: 'assistant_reasoning',
        approvalProcessing: () => false,
        getMcpServerLabel: () => '',
      },
    });

    expect(wrapper.find('details.message-reasoning').attributes('open')).toBeDefined();
    expect(wrapper.find('.message-reasoning-preview').exists()).toBe(false);
    expect(wrapper.text()).toContain('Second line has more detail.');
  });
});
