// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import WelcomeScreen from '../../../packages/desktop/src/renderer/components/WelcomeScreen.vue';

const {
  mockOpenSettingsOverview,
  mockFocusBlankDraft,
  useWelcomeScreenStateMock,
  useI18nMock,
} = vi.hoisted(() => ({
  mockOpenSettingsOverview: vi.fn(),
  mockFocusBlankDraft: vi.fn(),
  useWelcomeScreenStateMock: vi.fn(),
  useI18nMock: vi.fn(() => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'chat.welcome.settings': 'Settings',
        'chat.welcome.prompt.blank': 'Blank start',
        'chat.welcome.prompt.project': 'Look at my project',
        'chat.welcome.prompt.paste': 'Help me organize some text',
      };
      return map[key] ?? key;
    },
  })),
}));

vi.mock('../../../packages/desktop/src/renderer/composables/useWelcomeScreenState', () => ({
  useWelcomeScreenState: useWelcomeScreenStateMock,
}));

vi.mock('../../../packages/desktop/src/renderer/i18n', () => ({
  useI18n: useI18nMock,
}));

describe('WelcomeScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const mountWithState = (overrides: {
    readyContextLabel?: string;
    isReadyToChat?: boolean;
    starterPrompts?: string[];
  } = {}) => {
    useWelcomeScreenStateMock.mockReturnValue({
      focusBlankDraft: mockFocusBlankDraft,
      isReadyToChat: overrides.isReadyToChat ?? false,
      openSettingsOverview: mockOpenSettingsOverview,
      readyContextLabel: overrides.readyContextLabel ?? '',
      starterPrompts: overrides.starterPrompts ?? [],
    });

    const wrapper = mount(WelcomeScreen, {
      props: {
        activeModel: 'gpt-4.1-mini',
        activeProviderId: 'provider-openai',
      },
    });
    return wrapper;
  };

  it('shows the brand name always', () => {
    const wrapper = mountWithState();
    expect(wrapper.find('.welcome-brand').text()).toBe('iKi');
    wrapper.unmount();
  });

  it('shows the ready context label when a provider and model are available', () => {
    const wrapper = mountWithState({
      isReadyToChat: true,
      readyContextLabel: 'OpenAI · gpt-4.1-mini',
      starterPrompts: ['Look at my project', 'Help me organize some text'],
    });

    expect(wrapper.find('.welcome-ready-value').text()).toBe('OpenAI · gpt-4.1-mini');
    expect(wrapper.find('.welcome-actions').exists()).toBe(false);
    expect(wrapper.findAll('.welcome-prompt-btn')).toHaveLength(3); // 2 prompts + blank
    wrapper.unmount();
  });

  it('shows the settings button when no provider is ready', () => {
    const wrapper = mountWithState({ isReadyToChat: false, readyContextLabel: '' });

    expect(wrapper.find('.welcome-ready-strip').exists()).toBe(false);
    expect(wrapper.find('.welcome-actions').exists()).toBe(true);
    expect(wrapper.find('.welcome-secondary-btn').text()).toBe('Settings');
    wrapper.unmount();
  });

  it('opens settings when the settings button is clicked', async () => {
    const wrapper = mountWithState({ isReadyToChat: false });

    await wrapper.find('.welcome-secondary-btn').trigger('click');
    expect(mockOpenSettingsOverview).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('emits compose-starter with the clicked prompt text', async () => {
    const wrapper = mountWithState({
      isReadyToChat: true,
      readyContextLabel: 'OpenAI · gpt-4.1-mini',
      starterPrompts: ['Look at my project', 'Help me organize some text'],
    });

    await wrapper.findAll('.welcome-prompt-btn')[0].trigger('click');
    expect(wrapper.emitted('compose-starter')?.[0]?.[0]).toBe('Look at my project');

    await wrapper.findAll('.welcome-prompt-btn')[1].trigger('click');
    expect(wrapper.emitted('compose-starter')?.[1]?.[0]).toBe('Help me organize some text');

    wrapper.unmount();
  });

  it('calls focusBlankDraft when the blank-start button is clicked', async () => {
    const wrapper = mountWithState({
      isReadyToChat: true,
      readyContextLabel: 'OpenAI · gpt-4.1-mini',
      starterPrompts: ['Look at my project'],
    });

    // The last prompt button is the blank-start button
    const buttons = wrapper.findAll('.welcome-prompt-btn');
    await buttons[buttons.length - 1].trigger('click');

    expect(mockFocusBlankDraft).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });
});
