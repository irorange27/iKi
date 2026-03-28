// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import ProviderModelOptionsModal from '../../../src/renderer/components/settings/providers/ProviderModelOptionsModal.vue';

describe('ProviderModelOptionsModal', () => {
  it('emits normalized model options when the form is saved', async () => {
    const wrapper = mount(ProviderModelOptionsModal, {
      props: {
        providerId: 'openai_1',
        modelId: 'gpt-5.4',
        modelOptions: null,
      },
    });

    const displayNameInput = wrapper.find('input[type="text"]');
    await displayNameInput.setValue('GPT-5.4 Gateway');

    const contextWindowInput = wrapper.findAll('input[type="number"]')[0];
    await contextWindowInput?.setValue('400000');

    await wrapper.find('.primary-btn').trigger('click');
    await flushPromises();

    expect(wrapper.emitted('save')).toEqual([
      [
        {
          providerId: 'openai_1',
          modelId: 'gpt-5.4',
          options: {
            contextWindow: 400000,
            displayName: 'GPT-5.4 Gateway',
          },
        },
      ],
    ]);
  });

  it('shows an inline error instead of emitting save for invalid provider options JSON', async () => {
    const wrapper = mount(ProviderModelOptionsModal, {
      props: {
        providerId: 'openai_1',
        modelId: 'gpt-5.4',
        modelOptions: null,
      },
    });

    await wrapper.find('textarea').setValue('{"broken"');
    await wrapper.find('.primary-btn').trigger('click');
    await flushPromises();

    expect(wrapper.emitted('save')).toBeUndefined();
    expect(wrapper.text()).toContain('Provider options must be valid JSON.');
  });
});
