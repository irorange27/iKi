// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';

import SettingsSelect from '../../../packages/desktop/src/renderer/components/settings/SettingsSelect.vue';

const usagePeriodOptions = [
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: '90d', label: 'Last 90 Days' },
];

const groupedToolModelOptions = [
  { value: '', label: 'Auto-detect (Recommended)' },
  {
    label: 'DeepSeek',
    options: [
      { value: 'deepseek-chat', label: 'deepseek-chat' },
      { value: 'deepseek-reasoner', label: 'deepseek-reasoner' },
    ],
  },
];

describe('SettingsSelect', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('emits a new value when the user picks an option from the custom panel', async () => {
    const wrapper = mount(SettingsSelect, {
      props: {
        modelValue: '30d',
        options: usagePeriodOptions,
        ariaLabel: 'Usage period',
      },
      attachTo: document.body,
    });

    expect(wrapper.find('.settings-select-trigger').text()).toContain('Last 30 Days');

    await wrapper.find('.settings-select-trigger').trigger('click');

    const option = wrapper
      .findAll('.settings-select-option')
      .find(candidate => candidate.text().includes('Last 90 Days'));

    if (!option) {
      throw new Error('Last 90 Days option not found');
    }

    await option.trigger('click');

    expect(wrapper.emitted('update:modelValue')).toEqual([['90d']]);
    expect(wrapper.emitted('change')).toEqual([['90d']]);
    expect(wrapper.find('.settings-select-panel').exists()).toBe(false);

    wrapper.unmount();
  });

  it('closes the panel when the user clicks outside the dropdown', async () => {
    const wrapper = mount(SettingsSelect, {
      props: {
        modelValue: '30d',
        options: usagePeriodOptions,
        ariaLabel: 'Usage period',
      },
      attachTo: document.body,
    });

    await wrapper.find('.settings-select-trigger').trigger('click');
    expect(wrapper.find('.settings-select-panel').exists()).toBe(true);

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.settings-select-panel').exists()).toBe(false);

    wrapper.unmount();
  });

  it('renders grouped options and selects a value inside a labeled group', async () => {
    const wrapper = mount(SettingsSelect, {
      props: {
        modelValue: '',
        options: groupedToolModelOptions,
        ariaLabel: 'Select Tool Model',
      },
      attachTo: document.body,
    });

    await wrapper.find('.settings-select-trigger').trigger('click');

    expect(wrapper.find('.settings-select-group-label').text()).toContain('DeepSeek');

    const option = wrapper
      .findAll('.settings-select-option')
      .find(candidate => candidate.text().includes('deepseek-chat'));

    if (!option) {
      throw new Error('deepseek-chat option not found');
    }

    await option.trigger('click');

    expect(wrapper.emitted('update:modelValue')).toEqual([['deepseek-chat']]);

    wrapper.unmount();
  });
});
