// @vitest-environment happy-dom

import type { ChatUiMessage as UIMessage } from '@iki/backend/message/message_parts';
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';

import { createReactiveChatState } from '../../../../packages/desktop/src/renderer/modules/chat/chat_instance';

describe('createReactiveChatState replaceMessage reactivity', () => {
  const SegmentChild = defineComponent({
    name: 'SegmentChild',
    props: { message: { type: Object, required: true } },
    computed: {
      textCount() {
        return ((this.message as UIMessage).parts ?? []).filter(
          part => part.type === 'text'
        ).length;
      },
    },
    template: '<div class="count">{{ textCount }}</div>',
  });

  const MessageList = defineComponent({
    name: 'MessageList',
    components: { SegmentChild },
    props: { messages: { type: Array, required: true } },
    template:
      '<div><SegmentChild v-for="(m, i) in messages" :key="m.id" :message="messages[i]" /></div>',
  });

  it('keeps the written parts in sync with the SDK object across writes', () => {
    const { state } = createReactiveChatState(() => undefined);
    const sdkMessage: UIMessage = { id: 'assistant_2', role: 'assistant', parts: [] };
    state.pushMessage(sdkMessage);
    (sdkMessage.parts as unknown[]).push({ type: 'text', text: 'x' });
    state.replaceMessage(0, sdkMessage);

    const previous = state.messages[0];
    (sdkMessage.parts as unknown[]).push({ type: 'text', text: 'y' });
    state.replaceMessage(0, sdkMessage);

    expect(state.messages[0]).not.toBe(previous);
    expect((state.messages[0] as UIMessage).parts).toHaveLength(2);
  });
});
