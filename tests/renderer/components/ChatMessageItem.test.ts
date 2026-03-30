// @vitest-environment happy-dom

import type { UIMessage } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

import ChatMessageItem from '../../../src/renderer/components/chat/ChatMessageItem.vue';

const createUserMessage = (): UIMessage =>
  ({
    id: 'user_1',
    role: 'user',
    parts: [{ type: 'text', text: 'Need repo help' }],
  }) as unknown as UIMessage;

const mountChatMessageItem = (message = createUserMessage()) =>
  mount(ChatMessageItem, {
    props: {
      message,
      messageIndex: 0,
      activeAssistantMessageId: null,
      streamRenderTick: 0,
      approvalProcessing: () => false,
      getMcpServerLabel: () => '',
    },
    global: {
      stubs: {
        ChatMessageReferences: true,
        ChatMessageParts: {
          template: '<div class="chat-message-parts-stub"></div>',
        },
      },
    },
  });

describe('ChatMessageItem', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders the user hover actions in copy-regenerate-edit-more order', () => {
    const wrapper = mountChatMessageItem();

    const labels = wrapper.findAll('.message-action-btn').map(button => button.attributes('aria-label'));

    expect(labels).toEqual(['Copy', 'Regenerate', 'Edit', 'More']);
  });

  it('copies the user message text and clears the copied state after the timeout', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const wrapper = mountChatMessageItem();
    const copyButton = wrapper.findAll('.message-action-btn')[0];

    await copyButton.trigger('click');

    expect(writeText).toHaveBeenCalledWith('Need repo help');
    expect(copyButton.attributes('data-copied')).toBe('true');

    await vi.advanceTimersByTimeAsync(1200);

    expect(copyButton.attributes('data-copied')).toBeUndefined();
  });

  it('emits regenerate/edit actions and opens the overflow menu', async () => {
    const message = createUserMessage();
    const wrapper = mountChatMessageItem(message);
    const buttons = wrapper.findAll('.message-action-btn');

    await buttons[1].trigger('click');
    await buttons[2].trigger('click');
    await buttons[3].trigger('click');

    expect(wrapper.emitted('regenerate-user-message')).toEqual([[message]]);
    expect(wrapper.emitted('edit-user-message')).toEqual([[message]]);
    expect(wrapper.find('[role="menu"]').exists()).toBe(true);
    expect(wrapper.findAll('[role="menuitem"]').map(item => item.text())).toEqual([
      'Copy',
      'Regenerate',
      'Edit',
    ]);
  });
});
