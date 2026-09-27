// @vitest-environment happy-dom

import { ref } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import ChatComposerShell from '../../../packages/desktop/src/renderer/components/ChatComposerShell.vue';

const mountComponent = (overrides?: Record<string, unknown>) => {
  const inputRef = ref<HTMLTextAreaElement | null>(null);
  const wrapper = mount(ChatComposerShell, {
    props: {
      modelValue: '',
      placeholder: 'Type a message',
      feedback: '',
      setInputRef: (element: HTMLTextAreaElement | null) => {
        inputRef.value = element;
      },
      ...(overrides ?? {}),
    },
    slots: {
      'input-context': '<div class="input-context-slot">context</div>',
      'input-overlay': '<div class="input-overlay-slot">overlay</div>',
      'toolbar-left': '<div class="toolbar-left-slot">left</div>',
      'toolbar-right': '<div class="toolbar-right-slot">right</div>',
    },
  });

  return { wrapper, inputRef };
};

describe('ChatComposerShell', () => {
  it('renders slot-owned toolbar content and assigns the native input ref', () => {
    const { wrapper, inputRef } = mountComponent({
      modelValue: 'Investigate the renderer',
      feedback: 'Provider verification failed.',
    });

    expect(wrapper.find('.toolbar-left-slot').text()).toBe('left');
    expect(wrapper.find('.toolbar-right-slot').text()).toBe('right');
    expect(wrapper.find('.input-context-slot').text()).toBe('context');
    expect(wrapper.find('.input-overlay-slot').text()).toBe('overlay');
    expect(wrapper.find('.chat-input-field').element).toBe(inputRef.value);
    expect(wrapper.find('.chat-input-field').element.tagName).toBe('TEXTAREA');
    expect(wrapper.find('.composer-toolbar-slot-left').exists()).toBe(true);
    expect(wrapper.find('.composer-toolbar-slot-right').exists()).toBe(true);
    expect(wrapper.find('.composer-feedback-message').text()).toBe('Provider verification failed.');
    expect(wrapper.find('.chat-input-container .composer-feedback').exists()).toBe(true);
    expect(wrapper.find('.composer-feedback-dismiss').exists()).toBe(true);
  });

  it('re-emits input and composition events without owning draft state', async () => {
    const { wrapper } = mountComponent();

    const input = wrapper.find('.chat-input-field');
    await input.setValue('Use the focused shell seam');
    await input.trigger('keydown.enter', { key: 'Enter' });
    await input.trigger('keydown', { key: 'ArrowDown' });
    await input.trigger('compositionstart');
    await input.trigger('compositionend');

    expect(wrapper.emitted('update:modelValue')).toEqual([['Use the focused shell seam']]);
    expect(wrapper.emitted('keydown')).toHaveLength(2);
    expect(wrapper.emitted('keydownEnter')).toHaveLength(1);
    expect(wrapper.emitted('compositionStart')).toHaveLength(1);
    expect(wrapper.emitted('compositionEnd')).toHaveLength(1);
  });

  it('hides feedback when the shell has nothing to report', () => {
    const { wrapper } = mountComponent();

    expect(wrapper.find('.composer-feedback').exists()).toBe(false);
  });

  it('re-emits feedback dismissal so the owner can close the banner', async () => {
    const { wrapper } = mountComponent({
      feedback: 'Provider verification failed.',
    });

    await wrapper.find('.composer-feedback-dismiss').trigger('click');

    expect(wrapper.emitted('dismissFeedback')).toEqual([[]]);
  });

  it('keeps the expand toggle hidden for short drafts', () => {
    const { wrapper } = mountComponent({ modelValue: 'short draft' });

    expect(wrapper.find('.composer-expand-toggle').exists()).toBe(false);
  });

  it('offers the expand toggle once the draft passes the length threshold', () => {
    const { wrapper } = mountComponent({ modelValue: 'x'.repeat(220) });

    const toggle = wrapper.find('.composer-input-region .composer-expand-toggle');
    expect(toggle.exists()).toBe(true);
    expect(toggle.attributes('aria-pressed')).toBe('false');
  });

  it('expands the field into a taller editing surface and back', async () => {
    const { wrapper, inputRef } = mountComponent({ modelValue: 'x'.repeat(220) });
    const focusSpy = vi.spyOn(inputRef.value!, 'focus');
    const toggle = wrapper.find('.composer-expand-toggle');

    await toggle.trigger('click');
    await wrapper.vm.$nextTick();

    const field = wrapper.find('.chat-input-field');
    const style = field.attributes('style') ?? '';
    const height = Number.parseFloat(/height:\s*([\d.]+)px/.exec(style)?.[1] ?? '0');
    expect(toggle.attributes('aria-pressed')).toBe('true');
    expect(field.classes()).toContain('is-expanded');
    expect(height).toBeGreaterThan(220);
    expect(style).toContain('overflow-y: auto');
    expect(focusSpy).toHaveBeenCalled();

    await toggle.trigger('click');
    await wrapper.vm.$nextTick();

    const collapsedStyle = field.attributes('style') ?? '';
    const collapsedHeight = Number.parseFloat(
      /height:\s*([\d.]+)px/.exec(collapsedStyle)?.[1] ?? '0'
    );
    expect(toggle.attributes('aria-pressed')).toBe('false');
    expect(collapsedHeight).toBeLessThanOrEqual(220);
    expect(collapsedStyle).toContain('overflow-y: hidden');
  });

  it('collapses automatically when the draft is cleared', async () => {
    const { wrapper } = mountComponent({ modelValue: 'x'.repeat(220) });

    await wrapper.find('.composer-expand-toggle').trigger('click');
    await wrapper.setProps({ modelValue: '' });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.composer-expand-toggle').exists()).toBe(false);
    expect(wrapper.find('.chat-input-field').classes()).not.toContain('is-expanded');
  });
});
