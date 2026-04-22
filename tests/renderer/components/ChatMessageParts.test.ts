// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { UIMessage } from 'ai';

import ChatMessageParts from '../../../src/renderer/components/chat/ChatMessageParts.vue';

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
});
