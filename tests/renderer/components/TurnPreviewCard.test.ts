// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { UIMessage } from 'ai';

import TurnPreviewCard from '../../../packages/desktop/src/renderer/components/chat/TurnPreviewCard.vue';

const createMessage = (role: 'user' | 'assistant', text: string, index: number): UIMessage =>
  ({
    id: `${role}_${index}`,
    role,
    parts: [{ type: 'text', text, state: 'done' }],
  }) as unknown as UIMessage;

const mountCard = (messages: UIMessage[] | null) =>
  mount(TurnPreviewCard, {
    props: {
      anchor: { top: 40, left: 220 },
      messages,
    },
    attachTo: document.body,
  });

const queryCard = (): HTMLElement | null =>
  document.body.querySelector<HTMLElement>('.turn-preview-card');

describe('TurnPreviewCard', () => {
  it('renders turn messages with role labels and clamped snippets', () => {
    const wrapper = mountCard([
      createMessage('user', '日志给你了。Commit 429759d 写吧', 0),
      createMessage('assistant', '我已核对平台页面与三份日志：这次对应的是 LLM-A4 / long_output。', 1),
    ]);

    const card = queryCard();
    expect(card).not.toBeNull();
    expect(card!.querySelector('.turn-preview-title')).toBeNull();
    const messages = card!.querySelectorAll('.turn-preview-message');
    expect(messages).toHaveLength(2);
    expect(messages[0]!.querySelector('.turn-preview-role--user')).not.toBeNull();
    expect(messages[1]!.querySelector('.turn-preview-role--assistant')).not.toBeNull();
    expect(card!.textContent).toContain('Commit 429759d');
    wrapper.unmount();
  });

  it('keeps only the most recent messages', () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      createMessage('user', `message ${index}`, index)
    );
    const wrapper = mountCard(many);

    const messages = queryCard()!.querySelectorAll('.turn-preview-message');
    expect(messages).toHaveLength(6);
    expect(messages[0]!.textContent).toContain('message 2');
    wrapper.unmount();
  });

  it('shows an empty state when there are no renderable messages', () => {
    const wrapper = mountCard(null);

    expect(queryCard()!.querySelector('.turn-preview-empty')).not.toBeNull();
    expect(queryCard()!.querySelectorAll('.turn-preview-message')).toHaveLength(0);
    wrapper.unmount();
  });

  it('emits activate when clicked and stays hidden without an anchor', async () => {
    const wrapper = mountCard([createMessage('user', 'hello', 0)]);

    const card = queryCard()!;
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('activate')).toHaveLength(1);

    wrapper.unmount();
    expect(queryCard()).toBeNull();
  });
});
