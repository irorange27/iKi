// @vitest-environment happy-dom

import type { UIMessage } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

import ChatMessageItem from '../../../packages/desktop/src/renderer/components/chat/ChatMessageItem.vue';

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

  it('renders the user actions in copy-regenerate-edit-more order with hover labels', () => {
    const wrapper = mountChatMessageItem();
    const buttons = wrapper.findAll('.message-action-btn');

    const labels = buttons.map(button => button.attributes('aria-label'));
    const titles = buttons.map(button => button.attributes('title'));

    expect(labels).toEqual(['Copy', 'Regenerate', 'Edit', 'More']);
    expect(titles).toEqual(['Copy', 'Regenerate', 'Edit', 'More']);
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

  it('keeps the action bar visible while the pointer moves from the bubble to the action bar', async () => {
    const wrapper = mountChatMessageItem();
    const shell = wrapper.find('.message-shell');
    const actions = wrapper.find('.message-actions');

    await shell.trigger('mouseenter');
    expect(actions.classes()).toContain('actions-visible');

    await shell.trigger('mouseleave');
    await vi.advanceTimersByTimeAsync(80);
    expect(actions.classes()).toContain('actions-visible');

    await actions.trigger('mouseenter');
    await vi.advanceTimersByTimeAsync(200);
    expect(actions.classes()).toContain('actions-visible');

    await actions.trigger('mouseleave');
    await vi.advanceTimersByTimeAsync(400);
    expect(actions.classes()).not.toContain('actions-visible');
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
    expect(wrapper.findAll('[role="menuitem"]').map(item => item.attributes('title'))).toEqual([
      'Copy',
      'Regenerate',
      'Edit',
    ]);
  });

  it('keeps actions visible while focus remains inside the message shell', async () => {
    const wrapper = mountChatMessageItem();
    const shell = wrapper.find('.message-shell');
    const actions = wrapper.find('.message-actions');
    const nextTarget = document.createElement('button');
    shell.element.appendChild(nextTarget);

    await shell.trigger('focusin');
    expect(actions.classes()).toContain('actions-visible');

    await shell.trigger('focusout', { relatedTarget: nextTarget });
    await vi.advanceTimersByTimeAsync(400);
    expect(actions.classes()).toContain('actions-visible');

    await shell.trigger('focusout', { relatedTarget: document.body });
    await vi.advanceTimersByTimeAsync(400);
    expect(actions.classes()).not.toContain('actions-visible');
  });
});
