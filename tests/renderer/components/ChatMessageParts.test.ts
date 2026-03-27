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
  it('hides affect reference parts from the rendered message body', () => {
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
    expect(wrapper.text()).not.toContain('affect-signal');
    expect(wrapper.text()).not.toContain('sadness');
    expect(wrapper.find('.tool-fallback-content').exists()).toBe(false);
  });
});
