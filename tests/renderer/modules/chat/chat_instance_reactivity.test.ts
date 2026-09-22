// @vitest-environment happy-dom

import type { UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';

import { createReactiveChatState } from '../../../../packages/desktop/src/renderer/modules/chat/chat_instance';

// Reproduces the AI SDK's write pattern: it accumulates one raw message object
// off-proxy, mutates parts on that raw object, and calls replaceMessage with
// the SAME reference for every chunk. A prop-driven child component must still
// re-render per write; splicing the identical reference back in leaves the
// child's props shallow-equal and its computeds stale (empty chat bubbles).
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

  it('invalidates prop-driven children when the SDK rewrites the same message object', async () => {
    const { state, messagesArray } = createReactiveChatState(() => undefined);
    const sdkMessage: UIMessage = {
      id: 'assistant_1',
      role: 'assistant',
      parts: [],
    };
    state.pushMessage(sdkMessage);

    const wrapper = mount(MessageList, { props: { messages: messagesArray } });
    expect(wrapper.find('.count').text()).toBe('0');

    // SDK-style off-proxy mutation + same-reference write.
    (sdkMessage.parts as unknown[]).push({ type: 'text', text: 'hello' });
    state.replaceMessage(0, sdkMessage);
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.count').text()).toBe('1');
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
