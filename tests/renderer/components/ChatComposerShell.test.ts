// @vitest-environment happy-dom

import { ref } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ChatComposerShell from '../../../src/renderer/components/ChatComposerShell.vue';

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
    expect(wrapper.find('.chat-input-field').element).toBe(inputRef.value);
    expect(wrapper.find('.chat-input-field').element.tagName).toBe('TEXTAREA');
    expect(wrapper.find('.composer-toolbar-slot-left').exists()).toBe(true);
    expect(wrapper.find('.composer-toolbar-slot-right').exists()).toBe(true);
    expect(wrapper.find('.composer-feedback').text()).toBe('Provider verification failed.');
  });

  it('re-emits input and composition events without owning draft state', async () => {
    const { wrapper } = mountComponent();

    const input = wrapper.find('.chat-input-field');
    await input.setValue('Use the focused shell seam');
    await input.trigger('keydown.enter', { key: 'Enter' });
    await input.trigger('compositionstart');
    await input.trigger('compositionend');

    expect(wrapper.emitted('update:modelValue')).toEqual([['Use the focused shell seam']]);
    expect(wrapper.emitted('keydownEnter')).toHaveLength(1);
    expect(wrapper.emitted('compositionStart')).toHaveLength(1);
    expect(wrapper.emitted('compositionEnd')).toHaveLength(1);
  });

  it('hides feedback when the shell has nothing to report', () => {
    const { wrapper } = mountComponent();

    expect(wrapper.find('.composer-feedback').exists()).toBe(false);
  });
});
