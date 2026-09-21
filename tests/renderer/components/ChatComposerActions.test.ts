// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';

import ChatComposerActions from '../../../packages/desktop/src/renderer/components/ChatComposerActions.vue';

const mountComponent = (overrides?: Record<string, unknown>) =>
  mount(ChatComposerActions, {
    props: {
      isIncognito: false,
      isPreparingSend: false,
      isLoading: false,
      isStopping: false,
      isRecording: false,
      isTranscribing: false,
      speechEngineAvailable: true,
      showWaveform: false,
      waveformBars: [],
      speechStatusLabel: '',
      speechStatusToneClass: '',
      ...(overrides ?? {}),
    },
  });

describe('ChatComposerActions', () => {
  it('renders no context indicator and emits explicit incognito toggle intent', async () => {
    const wrapper = mountComponent();

    expect(wrapper.find('.composer-context-indicator').exists()).toBe(false);

    const button = wrapper.find('.composer-mode-btn');
    expect(button.attributes('aria-pressed')).toBe('false');
    expect(button.attributes('title')).toContain('Memory is enabled');

    await button.trigger('click');

    expect(wrapper.emitted('toggle-incognito')).toEqual([[]]);
  });

  it('switches the primary action between send and stop based on loading state', async () => {
    const wrapper = mountComponent();

    await wrapper.find('.send-btn').trigger('click');
    expect(wrapper.emitted('send-message')).toEqual([[]]);
    expect(wrapper.emitted('stop-streaming')).toBeUndefined();
    expect(wrapper.find('.send-btn').attributes('title')).toContain('Send message');

    await wrapper.setProps({ isLoading: true });
    await wrapper.find('.send-btn').trigger('click');

    expect(wrapper.emitted('stop-streaming')).toEqual([[]]);
    expect(wrapper.find('.send-btn').attributes('aria-label')).toContain('Stop generation');
    expect(wrapper.find('.send-btn').attributes('title')).toContain('Stop generation');
  });

  it('shows waveform and speech status, and forwards voice-toggle intent', async () => {
    const wrapper = mountComponent({
      showWaveform: true,
      waveformBars: [0.2, 0.5, 0.8],
      speechStatusLabel: 'Listening',
      speechStatusToneClass: 'ui-text-accent',
    });

    expect(wrapper.findAll('.speech-waveform-bar')).toHaveLength(3);
    expect(wrapper.text()).toContain('Listening');
    expect(wrapper.find('.speech-btn').attributes('title')).toContain('Start voice input');

    await wrapper.find('.speech-btn').trigger('click');

    expect(wrapper.emitted('toggle-voice-input')).toEqual([[]]);
  });

  it('updates the voice button tooltip while recording', async () => {
    const wrapper = mountComponent({ isRecording: true });

    expect(wrapper.find('.speech-btn').attributes('aria-label')).toContain('Stop voice input');
    expect(wrapper.find('.speech-btn').attributes('title')).toContain('Stop voice input');
  });
});
